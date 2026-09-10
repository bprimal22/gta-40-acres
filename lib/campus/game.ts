import { gameTilesConfig } from './visitor-cesium';
import * as THREE from 'three';
import { PERSONAL_CHARACTER_URL } from './character-asset';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Terrain } from './terrain';
import { CampusWorld } from './world';
import { materials } from './materials';
import { FrameProfiler } from './profiler';
import type { PhotorealCampus, TilesConfig } from './photoreal';
import {applyMainBuildingMaterials} from './main-building-materials';
import { buildTower } from './landmarks';
import { buildOfflineTowerBase } from './tower-offline-base';
import { buildMainBuildingEnvelope } from './main-building-envelope';
import { loadOfflineTerrain } from './offline-terrain-loader';
import { loadLocalSurfaces } from './local-surfaces';
import { SpeedwayWalkway } from './walkway';
import { characterSupported } from './character-support';
import { ContactShadow } from './contact-shadow';
import { createSkyEnvironment } from './sky-environment';
import { setCampusGlassEnvironment } from './campus-glass';
import { POB_GLASS_NAME, POB_GLASS_SKY_INTENSITY } from './pob-glass';
import { CampusLocalReflection } from './local-reflection';
import { CampusAmbientOcclusion } from './ambient-occlusion';
import { mapPoint, mapView, travelCandidates, travelLanding, WALK_SPEED, RUN_SPEED, type MapView } from './map-travel';
import { LocalGroundQuery } from './local-ground-query';
import { ScooterMotion, SCOOTER_TUNING } from './scooter-motion';
import { buildScooterModel } from './scooter-model';
import { createScooterPose } from './scooter-pose';
import { ScooterClearance } from './scooter-clearance';
import type { CampusData, TerrainData, GameStatus, Point } from './types';

export class CampusGame {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  profiler: FrameProfiler;
  skyEnvironment: THREE.WebGLRenderTarget;
  private sky: Sky;
  private localReflection?: CampusLocalReflection;
  camera = new THREE.PerspectiveCamera(55, 1, 0.12, 2100);
  physics!: RAPIER.World;
  world!: CampusWorld;
  photoreal?: PhotorealCampus;
  private mainBorrowedTextures = new Set<THREE.Texture>();
  private mainMaterialFinish?: ReturnType<typeof applyMainBuildingMaterials>['stats'];
  private mainBuildingEnvelope?: ReturnType<typeof buildMainBuildingEnvelope>['stats'];
  private localSurfaces?: Awaited<ReturnType<typeof loadLocalSurfaces>>;
  walkway?: SpeedwayWalkway;
  /** Photographic streaming is default; local assets remain an explicit opt-in. */
  offline = false;
  private offlineTerrain?: Awaited<ReturnType<typeof loadOfflineTerrain>>['stats'];
  contactShadow?: ContactShadow;
  ambientOcclusion: CampusAmbientOcclusion;
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  controller!: RAPIER.KinematicCharacterController;
  avatar = new THREE.Group();
  mixer?: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction> = {};
  action = 'Idle';
  characterName = 'Campus visitor';
  characterAssetUrl = PERSONAL_CHARACTER_URL;
  walkCycleSpeed = 1.46;
  runCycleSpeed = 5.7;
  keys = new Set<string>();
  pressedAt = new Map<string, number>();
  airBones: Record<string, THREE.Object3D> = {};
  // Face west from the MLK/East Mall sidewalk toward Speedway and the Tower.
  yaw = 1.48;
  pitch = 0.08;
  distance = 5.4;
  velocity = new THREE.Vector3();
  private scooterGround = new LocalGroundQuery();
  private riderStationary = 1;
  readonly scooter = new ScooterMotion(RUN_SPEED);
  private scooterVisual?: ReturnType<typeof buildScooterModel>;
  private scooterPose?: ReturnType<typeof createScooterPose>;
  private scooterClearance?: ScooterClearance;
  private scooterSupport: ReturnType<ScooterClearance['resolveMove']> | null = null;
  private scooterDismount?: { start: THREE.Vector3; target: THREE.Vector3; path: {x:number;y:number;z:number}[]; heading: number };
  private scooterParkedUntil = 0;
  private scooterMessage = '';
  private scooterMessageUntil = 0;
  private scooterWarningLatched = false;
  private scooterCollisionReady = true;
  private rideCameraBlend = 0;
  private scooterQueryMs: number[] = [];
  grounded = false;
  vertical = 0;
  jumpQueued = false;
  active = false;
  overview = false;
  overviewDistance = 650;
  mapExpanded = false;
  private drawnMap?: MapView;
  private mapCursor?: Point;
  private travel?: { requested: Point; candidates: Point[]; index: number; started: number; candidateSince: number; lastProbe: number; origin: THREE.Vector3 };
  private travelMessage = '';
  private travelMessageUntil = 0;
  private travelCount = 0;
  private lastTravel?: { requested: Point; arrived: number[]; offsetMeters: number };
  disposed = false;
  ready = false;
  raf = 0;
  signal = new AbortController();
  last = performance.now();
  accumulator = 0;
  previousPosition = new THREE.Vector3();
  sun = new THREE.DirectionalLight(0xfff0d6, 3.3);
  focus = new THREE.Vector3();
  fpsSamples: number[] = [];
  lastHud = 0;
  startedAt = 0;
  frames = 0;
  contacts = 0;
  jumps = 0;
  spawn = new THREE.Vector3(114, 0, 64.4);
  trail: {
    t: number;
    x: number;
    y: number;
    z: number;
    grounded: boolean;
    action: string;
  }[] = [];
  constructor(
    private host: HTMLDivElement,
    private map: HTMLCanvasElement,
    private report: (s: GameStatus) => void,
    private options: { tilesConfig?: TilesConfig } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.profiler = new FrameProfiler(
      this.renderer.getContext() as WebGL2RenderingContext,
    );
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      'aria-label',
      'UT Austin exploration game. WASD to walk, Shift to run, Space to jump. F mounts or dismounts the scooter; W rides, A and D steer, S or Space brakes. Drag mouse to look.',
    );
    this.host.appendChild(this.renderer.domElement);
    this.camera.aspect = host.clientWidth / host.clientHeight;
    this.camera.updateProjectionMatrix();
    this.scene.background = new THREE.Color(0xb5ced9);
    this.scene.fog = new THREE.FogExp2(0xb5ced9, 0.00065);
    const sky = this.sky = new Sky();
    sky.scale.setScalar(10000);
    sky.material.uniforms.turbidity.value = 2.3;
    sky.material.uniforms.rayleigh.value = 1.5;
    sky.material.uniforms.mieCoefficient.value = 0.003;
    sky.material.uniforms.mieDirectionalG.value = 0.8;
    const sunPos = new THREE.Vector3(80, 105, 45);
    sky.material.uniforms.sunPosition.value.copy(sunPos);
    this.scene.add(sky);
    // Preserve daylight exposure while allowing deep entries and window reveals
    // to read darker than stone that receives direct sun.
    // Neutral daylight fill reduces the cyan bias in shaded stone. Preserve
    // fill intensity and sun/exposure; photographic tile colors bypass these lights.
    this.scene.add(new THREE.HemisphereLight(0xdde3e8, 0x665e44, 0.55));
    this.sun.position.copy(sunPos);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -65;
    this.sun.shadow.camera.right = 65;
    this.sun.shadow.camera.top = 65;
    this.sun.shadow.camera.bottom = -65;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);
    this.skyEnvironment = createSkyEnvironment(this.renderer, sky);
    this.scene.environment = this.skyEnvironment.texture;
    this.scene.environmentIntensity = 0.25;
    this.ambientOcclusion = new CampusAmbientOcclusion(this.renderer, this.scene, this.camera);
    this.bindControls();
  }
  async init() {
    const start = performance.now();
    const boot = { stage: 'assets', marks: [] as { stage: string; elapsedMs: number }[] };
    (window as unknown as { __campusBoot: unknown }).__campusBoot = boot;
    const markBoot = (stage: string) => {
      boot.stage = stage;
      boot.marks.push({ stage, elapsedMs: performance.now() - start });
    };
    const query = new URLSearchParams(location.search);
    this.offline = query.get('offline') === '1' || ['local','procedural'].includes(query.get('visual') ?? '');
    const [data, terrain, , gltf, tilesConfig] = await Promise.all([
      fetch('/data/campus.json').then((r) => {
        if (!r.ok) throw Error('Campus data failed to load');
        return r.json() as Promise<CampusData>;
      }),
      fetch('/data/terrain.json').then((r) => r.json() as Promise<TerrainData>),
      RAPIER.init(),
      new GLTFLoader().loadAsync(this.characterAssetUrl),
      this.offline ? Promise.resolve(null) : gameTilesConfig(this.options.tilesConfig),
    ]);
    if (this.disposed) return;
    markBoot('world');
    this.physics = new RAPIER.World({ x: 0, y: -24, z: 0 });
    this.physics.timestep = 1 / 60;
    this.world = new CampusWorld(
      data,
      new Terrain(terrain),
      this.physics,
      () => materials(this.renderer),
      this.renderer,
    );
    // Keep authored pedestrian details over the photographic campus.
    const walkwayMode = query.get('walkway') ?? 'landscape';
    if (this.offline || walkwayMode === 'pilot' || walkwayMode === 'landscape') {
      markBoot('buildings-and-ground');
      this.walkway = new SpeedwayWalkway(
        data,
        this.world.terrain,
        this.physics,
        this.renderer,
        this.offline || walkwayMode === 'landscape',
        this.offline,
      );
      markBoot('landscape-details');
      await this.walkway.loadDetails();
      if (this.disposed) return;
      markBoot(this.offline ? 'offline-campus' : 'imagery');
      this.scene.add(this.walkway.group);
    }
    if (this.disposed) return;
    if (tilesConfig) {
      markBoot('imagery');
      const { PhotorealCampus } = await import('./photoreal');
      if (this.disposed) return;
      this.photoreal = new PhotorealCampus(tilesConfig, data.origin, this.camera,
        this.renderer, this.physics, this.walkway?.volumes, this.walkway?.surfaces);
      this.scene.add(this.photoreal.tiles.group);
      this.scene.fog = new THREE.FogExp2(0xc9d9df, 0.0003);
      const shadowReach = this.walkway ? 28 : 6;
      this.sun.shadow.mapSize.set(this.walkway ? 4096 : 2048, this.walkway ? 4096 : 2048);
      Object.assign(this.sun.shadow.camera, {left:-shadowReach,right:shadowReach,top:shadowReach,bottom:-shadowReach});
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sun.shadow.normalBias = 0.008;
      this.sun.shadow.bias = -0.000015;
    } else {
      if (!this.walkway) throw Error('The local campus scene is missing');
      markBoot('local-terrain');
      const localTerrain = await loadOfflineTerrain(this.world.mat.grass);
      if (this.disposed) { localTerrain.dispose(); return; }
      this.world.group.add(localTerrain.mesh);
      for (const geometry of localTerrain.colliderGeometries) this.world.collider(geometry);
      this.offlineTerrain = localTerrain.stats;
      // Restore the existing local upper Tower now that no scan supplies it.
      // This builder starts above the authored Main Building pedestrian facades.
      buildTower(this.world);
      buildOfflineTowerBase(this.world);
      this.world.flush();
      // Reuse the existing Main facade finishes. Independent clones are owned by
      // the scene cleanup, while the original materials remain walkway-owned.
      const mainMaterial = (name: string) => {
        const material = this.walkway?.materials.find(m => m.name === name);
        if (!material) throw Error(`Missing Main Building material: ${name}`);
        return material.clone();
      };
      const mainEnvelope = buildMainBuildingEnvelope({
        groundHeight: (x, z) => this.world.terrain.height(x, z),
        stone: mainMaterial('Main Building warm limestone'),
        trim: mainMaterial('Main Building pale stone blocks'),
        glass: mainMaterial('Main Building bronze dark glazing'),
        frame: mainMaterial('Main Building bronze sash'),
      });
      const mainStone = this.walkway.materials.find(m => m.name === 'Main east limestone');
      if (!(mainStone instanceof THREE.MeshStandardMaterial) || !mainStone.map)
        throw Error('Main limestone material is missing its local texture');
      this.mainBorrowedTextures.add(mainStone.map);
      this.mainBorrowedTextures.add(this.skyEnvironment.texture);
      this.mainMaterialFinish = applyMainBuildingMaterials(mainEnvelope.meshes, {
        region: 'envelope', limestoneTexture: mainStone.map,
        glassEnvironment: this.skyEnvironment.texture,
      }).stats;
      for (const material of this.walkway.materials) {
        if (material.name === 'Main Building bronze dark glazing' && material instanceof THREE.MeshStandardMaterial) {
          material.envMap = this.skyEnvironment.texture;
          material.envMapIntensity = 1.1;
          material.needsUpdate = true;
        }
      }
      this.world.group.add(...mainEnvelope.meshes);
      for (const geometry of mainEnvelope.colliderGeometries) this.world.collider(geometry);
      this.mainBuildingEnvelope = mainEnvelope.stats;
      this.scene.add(this.world.group);
      markBoot('local-road-finishes');
      const paving = this.walkway?.materials.find(m => m.name === 'Speedway golden brick paving');
      if (!paving) throw Error('Shared Speedway paving material is missing');
      const localSurfaces = await loadLocalSurfaces({ asphalt: this.world.mat.asphalt,
        concrete: this.world.mat.concrete, speedway: paving });
      if (this.disposed) { localSurfaces.dispose(); return; }
      this.localSurfaces = localSurfaces;
      this.scene.add(localSurfaces.group);
      // Keep the authored campus lighting in local mode as well.
      const shadowReach = this.walkway ? 28 : 6;
      this.sun.shadow.mapSize.set(4096, 4096);
      Object.assign(this.sun.shadow.camera, {
        left: -shadowReach, right: shadowReach,
        top: shadowReach, bottom: -shadowReach,
      });
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sun.shadow.normalBias = 0.008;
      this.sun.shadow.bias = -0.000015;
    }
    if (this.disposed) return;
    const model = gltf.scene;
    const rig = model.getObjectByName('UTCampusCivilian');
    if (!rig) throw Error('The civilian character rig is missing.');
    this.characterName = rig.userData.source;
    this.walkCycleSpeed = rig.userData.locomotion.Walk.speedMetersPerSecond;
    this.runCycleSpeed = rig.userData.locomotion.Run.speedMetersPerSecond;
    // Asset conversion already normalizes the rig to meters. Accessories add
    // height; rescaling by their bounds would shrink the body and its stride.
    // Rocketbox's forward direction is +Z, matching avatar.rotation below.
    for (const name of [
      'L_Thigh',
      'R_Thigh',
      'L_Calf',
      'R_Calf',
      'L_UpperArm',
      'R_UpperArm',
    ]) {
      const bone = model.getObjectByName('Bip01_' + name);
      if (bone) this.airBones[name] = bone;
    }
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.avatar.add(model);
    this.scene.add(this.avatar);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations)
      this.actions[clip.name] = this.mixer.clipAction(clip);
    this.actions.Idle?.play();
    this.scooterVisual = buildScooterModel();
    this.scooterVisual.root.visible = false;
    this.scene.add(this.scooterVisual.root);
    this.scooterPose = createScooterPose(model);
    this.avatar.rotation.y = this.yaw + Math.PI;
    const x = this.photoreal || this.walkway ? this.spawn.x : 0,
      z = this.photoreal || this.walkway ? this.spawn.z : 35,
      y = this.world.terrain.height(x, z) + 0.92;
    this.body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    );
    this.collider = this.physics.createCollider(
      RAPIER.ColliderDesc.capsule(0.54, 0.34).setFriction(0),
      this.body,
    );
    if (this.photoreal) {
      this.contactShadow = new ContactShadow((position) =>
        this.photoreal!.shadowMeshes(position),
      );
    }
    this.controller = this.physics.createCharacterController(0.025);
    this.controller.enableAutostep(0.32, 0.2, false);
    this.controller.enableSnapToGround(0.38);
    this.controller.setMaxSlopeClimbAngle(Math.PI * 0.25);
    this.controller.setMinSlopeSlideAngle(Math.PI * 0.28);
    this.scooterClearance = new ScooterClearance({ world: this.physics, controller: this.controller,
      collider: this.collider, renderedGround: (x, z, fromY, distance) => this.scooterGround.sample(x,z,fromY,distance) });
    const [west, north, east, south] = data.bounds;
    for (const [cx, cz, hx, hz] of [
      [west - 1, (north + south) / 2, 1, (south - north) / 2],
      [east + 1, (north + south) / 2, 1, (south - north) / 2],
      [(west + east) / 2, north - 1, (east - west) / 2, 1],
      [(west + east) / 2, south + 1, (east - west) / 2, 1],
    ])
      this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, 150, hz).setTranslation(cx, 0, cz),
      );
    markBoot('physics');
    this.physics.step();
    this.previousPosition.set(x, y, z);
    this.focus.set(x, y + 0.55, z);
    this.camera.position
      .copy(this.focus)
      .add(
        new THREE.Vector3(
          Math.sin(this.yaw) * this.distance,
          2.2,
          Math.cos(this.yaw) * this.distance,
        ),
      );
    this.ready = !this.photoreal;
    if (this.photoreal) {
      this.avatar.visible = false;
      this.camera.position.set(x - 22, y + 45, z + 36);
      this.camera.lookAt(x, y, z);
    }
    if(this.walkway){
      // These named facades borrow the existing sky PMREM; each keeps its
      // local reflection strength without changing the scene's lighting.
      for(const material of this.walkway.materials)
        if(material instanceof THREE.MeshPhysicalMaterial) {
          if(material.name===POB_GLASS_NAME)
            setCampusGlassEnvironment(material,this.skyEnvironment.texture,POB_GLASS_SKY_INTENSITY);
          if(material.name==='NHB blue curtain glazing')
            setCampusGlassEnvironment(material,this.skyEnvironment.texture,2.0);
          if(material.name==='NHB lower recessed window depth')
            setCampusGlassEnvironment(material,this.skyEnvironment.texture,.45);
          if(material.name==='DKR west blue-sky glazing')
            setCampusGlassEnvironment(material,this.skyEnvironment.texture,1.3);
        }
      const names=new Set(['Welch east local reflection glazing','GDC Speedway local reflection glazing']);
      this.localReflection=new CampusLocalReflection(this.renderer,this.scene,this.sky,
        [this.avatar,...(this.photoreal?[this.photoreal.tiles.group]:[])],
        this.walkway.materials.filter(m=>names.has(m.name)),this.ambientOcclusion.materialRenderTarget);
    }
    this.ambientOcclusion.prepareMaterials();
    this.startedAt = performance.now();
    this.last = this.startedAt;
    markBoot('streaming');
    (window as unknown as { __campus: unknown }).__campus = {
      snapshot: (options?: { includeCharacterBounds?: boolean }) => this.disposed ? {ready:false,active:false} : this.snapshot(options),
      // Read-only collision evidence for path replay; never changes movement.
      collisionDetails: () => Array.from({length:this.controller.numComputedCollisions()},(_,i)=>{
        const hit=this.controller.computedCollision(i);
        if(!hit?.collider)return null;
        const collider=hit.collider;
        const entry=[...(this.photoreal?.entries??[])].find(([,e])=>e.colliders?.some(c=>c.handle===collider.handle));
        const owner=entry?'streamed':this.walkway?.colliders.some(c=>c.handle===collider.handle)?'walkway':'other';
        let closest: {distance:number;triangle:number[][]}|null=null;
        if(collider.shapeType()===RAPIER.ShapeType.TriMesh){
          const vertices=collider.vertices(),indices=collider.indices();
          const witness=new THREE.Vector3(hit.witness1.x,hit.witness1.y,hit.witness1.z);
          if(indices)for(let j=0;j<indices.length;j+=3){
            const points=[0,1,2].map(k=>new THREE.Vector3().fromArray(vertices,indices[j+k]*3));
            const distance=new THREE.Triangle(points[0],points[1],points[2]).closestPointToPoint(witness,new THREE.Vector3()).distanceTo(witness);
            if(!closest||distance<closest.distance)closest={distance,triangle:points.map(p=>p.toArray())};
          }
        }
        return{owner,handle:collider.handle,shape:collider.shapeType(),witness:hit.witness1,normal:hit.normal1,applied:hit.translationDeltaApplied,remaining:hit.translationDeltaRemaining,closest,geometricError:entry?.[0].geometricError??null};
      }),
      // Shading-only A/B diagnostic; never moves the player or changes physics.
      reflectionMode: (mode:'local'|'sky') => {
        if(mode!=='local'&&mode!=='sky')throw Error('Unknown reflection mode');
        this.localReflection?.setEnabled(mode==='local');
        return this.localReflection?.snapshot();
      },
      // Read-only inspection of the visible surface beneath a viewport point.
      // This identifies leftover scan fragments without moving the player.
      inspectAt: (u: number, v: number) => {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
        return ray.intersectObject(this.scene, true).filter(hit => {
          for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
            if (!object.visible) return false;
          }
          const tile=hit.object.userData.tile;
          return !tile||!!this.photoreal?.tiles.visibleTiles.has(tile);
        }).slice(0, 8).map(hit => {
          const mesh = hit.object instanceof THREE.Mesh ? hit.object : null;
          return {
          position: hit.point.toArray(), distance: hit.distance, name: hit.object.name,
          source: hit.object.userData.tile ? 'streamed' : 'authored',
          normal: hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).toArray(),
          triangle: hit.face && mesh
            ? [hit.face.a, hit.face.b, hit.face.c].map(index => new THREE.Vector3()
              .fromBufferAttribute(mesh.geometry.attributes.position, index)
              .applyMatrix4(hit.object.matrixWorld).toArray())
            : null,
          };
        });
      },
      // Bounded read-only architectural survey. A streamed hit here is the
      // retained active surface, possibly outside the camera. tileState distinguishes
      // rendered versus resident support. Only ?walkway=scan is uncut.
      rayAt: (origin: [number,number,number], direction: [number,number,number], distance = 100, source: 'all'|'streamed'|'authored' = 'all') => {
        if(this.disposed || ![...origin,...direction,distance].every(Number.isFinite) || distance<=0 || distance>500) return [];
        const d=new THREE.Vector3(...direction);
        if(d.lengthSq()<1e-12)return [];
        const ray=new THREE.Raycaster(new THREE.Vector3(...origin),d.normalize(),0,distance);
        const roots=[this.world.group,...(this.photoreal?[this.photoreal.tiles.group]:[]),...(this.walkway?[this.walkway.surfaces]:[])];
        return ray.intersectObjects(roots,true).filter(hit=>{
          for(let object:THREE.Object3D|null=hit.object;object;object=object.parent)if(!object.visible)return false;
          const streamed=!!hit.object.userData.tile;
          return source==='all'||(source==='streamed'&&streamed)||(source==='authored'&&!streamed);
        }).slice(0,12).map(hit=>({position:hit.point.toArray(),distance:hit.distance,name:hit.object.name,
          source:hit.object.userData.tile?'streamed':'authored',geometricError:hit.object.userData.tile?.geometricError??null,
          tileState:hit.object.userData.tile?{
            active:this.photoreal!.tiles.activeTiles.has(hit.object.userData.tile),
            visible:this.photoreal!.tiles.visibleTiles.has(hit.object.userData.tile),
            prepared:!!this.photoreal!.entries.get(hit.object.userData.tile)?.repaired,
          }:null,
          normal:hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).toArray()}));
      },
      surfaceAt: (x: number, z: number, fromY = 250, distance = 500) => {
        if (this.disposed || ![x, z, fromY, distance].every(Number.isFinite) || distance <= 0 || distance > 500) return null;
        const hit = this.photoreal?.surface(x, z, fromY, distance) ??
          new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 0, distance)
            .intersectObjects([this.world.group, ...(this.walkway ? [this.walkway.surfaces] : [])], true)
            .find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .5);
        if (!hit) return null;
        const tile = hit.object.userData.tile;
        return {
          position: hit.point.toArray(),
          source: tile ? 'streamed' : 'authored',
          geometricError: tile?.geometricError ?? null,
          children: tile?.children?.length ?? 0,
          leaf: tile?.traversal.isLeaf ?? null,
        };
      },
      // Read-only comparison of the actual supporting collider and tile state.
      // Runs only on explicit inspection, never in movement or rendering loops.
      supportWitnessAt: (x:number,z:number,fromY:number,distance=12) => {
        if(this.disposed||![x,z,fromY,distance].every(Number.isFinite)||distance<=0||distance>40)return null;
        const ray=new RAPIER.Ray({x,y:fromY,z},{x:0,y:-1,z:0});
        const hit=this.physics.castRayAndGetNormal(ray,distance,false,undefined,undefined,this.collider,this.body);
        if(!hit)return null;
        const collider=hit.collider,point=ray.pointAt(hit.timeOfImpact);
        const entry=[...(this.photoreal?.entries??[])].find(([,e])=>e.colliders?.some(c=>c.handle===collider.handle));
        let closest:{distance:number;triangle:number[][]}|null=null;
        if(collider.shapeType()===RAPIER.ShapeType.TriMesh){
          const vertices=collider.vertices(),indices=collider.indices(),t=collider.translation(),r=collider.rotation();
          const translation=new THREE.Vector3(t.x,t.y,t.z),rotation=new THREE.Quaternion(r.x,r.y,r.z,r.w);
          const witness=new THREE.Vector3(point.x,point.y,point.z);
          if(indices)for(let i=0;i<indices.length;i+=3){
            const points=[0,1,2].map(k=>new THREE.Vector3().fromArray(vertices,indices[i+k]*3).applyQuaternion(rotation).add(translation));
            const separation=new THREE.Triangle(...points as [THREE.Vector3,THREE.Vector3,THREE.Vector3]).closestPointToPoint(witness,new THREE.Vector3()).distanceTo(witness);
            if(!closest||separation<closest.distance)closest={distance:separation,triangle:points.map(p=>p.toArray())};
          }
        }
        const directMeshes:THREE.Mesh[]=[];
        if(entry&&this.photoreal?.tiles.visibleTiles.has(entry[0]))
          entry[1].scene.traverse(object=>{if(object instanceof THREE.Mesh)directMeshes.push(object);});
        const directRay=new THREE.Raycaster(new THREE.Vector3(x,fromY,z),new THREE.Vector3(0,-1,0),0,distance);
        const directVisible=directRay.intersectObjects(directMeshes,false).filter(h=>{
          for(let o:THREE.Object3D|null=h.object;o;o=o.parent)if(!o.visible)return false;
          return true;
        }).slice(0,3).map(h=>({position:h.point.toArray(),normal:h.face?.normal.clone().transformDirection(h.object.matrixWorld).toArray(),name:h.object.name}));
        return {position:[point.x,point.y,point.z],normal:hit.normal,closest,directVisible,
          owner:entry?'streamed':this.walkway?.colliders.some(c=>c.handle===collider.handle)?'walkway':'other',
          geometricError:entry?.[0].geometricError??null,
          tile:entry?{visible:this.photoreal!.tiles.visibleTiles.has(entry[0]),active:this.photoreal!.tiles.activeTiles.has(entry[0]),sceneVisible:entry[1].scene.visible,used:entry[0].traversal.used,repaired:entry[1].repaired}:null};
      },
      loadMs: performance.now() - start,
    };
    this.report({
      ready: this.ready,
      location: 'Speedway · Gates-Dell',
      speed: 0,
      fps: 0,
      mode: this.ready
        ? this.offline
          ? 'Offline local campus'
          : 'Ready'
        : 'Loading campus imagery',
      offline: this.offline,
      imagery: this.imagerySnapshot(),
    });
    this.raf = requestAnimationFrame(this.tick);
  }
  private imagerySnapshot(): NonNullable<GameStatus['imagery']> {
    return (
      this.photoreal?.snapshot() ?? {
        provider: 'Bundled authored campus',
        loaded: 0,
        visible: 0,
        errors: 0,
        progress: 1,
        aligned: true,
        credits: 'Local campus assets · No Cesium or Google tile streaming',
      }
    );
  }
  play() {
    this.active = true;
    this.renderer.domElement.focus();
  }
  setMapExpanded(open: boolean) {
    if (!this.ready || !this.active) return;
    this.mapExpanded = open;
    this.pauseScooter();
    this.keys.clear(); this.pressedAt.clear(); this.jumpQueued = false;
    this.velocity.set(0, 0, 0);
    if (document.pointerLockElement) document.exitPointerLock();
    const p = this.body.translation();
    this.mapCursor = open ? [p.x, p.z] : undefined;
    this.drawMap();
    if (open) this.map.focus(); else this.renderer.domElement.focus();
    this.lastHud = 0;
  }
  cancelTravel(message = 'Travel cancelled.') {
    if (!this.travel) return;
    this.travel = undefined;
    this.photoreal?.setTravelDestination(null);
    this.focus.copy(this.body.translation()).add(new THREE.Vector3(0, .6, 0));
    this.travelMessage = message; this.travelMessageUntil = performance.now() + 5500;
    this.accumulator = 0; this.lastHud = 0;
    this.renderer.domElement.focus();
  }
  travelTo(requested: Point) {
    if (!this.ready || !this.active || this.travel) return;
    const candidates = travelCandidates(this.world.data, requested);
    if (!candidates.length) {
      this.travelMessage = 'Choose a path or an open area within campus.';
      this.travelMessageUntil = performance.now() + 5500; this.lastHud = 0;
      return;
    }
    this.setMapExpanded(false);
    const p = this.body.translation(), now = performance.now();
    this.travel = { requested, candidates, index: 0, started: now, candidateSince: now, lastProbe: 0,
      origin: new THREE.Vector3(p.x, p.y, p.z) };
    this.travelMessage = 'Loading your destination…';
    this.travelMessageUntil = Infinity;
    this.overview = false;
    this.avatar.visible = false;
    if(this.scooterVisual)this.scooterVisual.root.visible = false;
  }
  private updateTravel(now: number) {
    const travel = this.travel;
    if (!travel) return;
    const point = travel.candidates[travel.index];
    const target = new THREE.Vector3(point[0], this.world.terrain.height(...point) + .905, point[1]);
    this.focus.copy(target).add(new THREE.Vector3(0, .6, 0));
    this.camera.position.copy(this.focus).add(new THREE.Vector3(0, 28, 22));
    this.camera.lookAt(this.focus);
    this.photoreal?.setTravelDestination(target);
    // The normal loading region remains at the departure point until arrival.
    this.photoreal?.update(travel.origin);
    const prepared = !this.photoreal || this.photoreal.syncCollisions(target, travel.origin);
    if (now - travel.lastProbe > 250 && prepared) {
      travel.lastProbe = now;
      const surface = (x: number, z: number, fromY: number, distance: number) => {
        if (this.photoreal) return this.photoreal.surface(x, z, fromY, distance);
        const ray = new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 0, distance);
        return ray
          .intersectObjects([this.world.group, ...(this.walkway ? [this.walkway.surfaces] : [])], true)
          .find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .5) ?? null;
      };
      const landing = travelLanding(this.physics, this.collider, point, target.y - .905, surface);
      if (landing) {
        this.leaveScooter();
        this.body.setTranslation(landing, true); this.body.setNextKinematicTranslation(landing);
        this.previousPosition.copy(landing); this.focus.copy(landing).add(new THREE.Vector3(0, .6, 0));
        this.physics.step(); this.accumulator = 0; this.vertical = 0; this.grounded = true;
        this.velocity.set(0, 0, 0); this.keys.clear(); this.pressedAt.clear(); this.jumpQueued = false;
        const offset = Math.hypot(landing.x - travel.requested[0], landing.z - travel.requested[1]);
        this.lastTravel = { requested: travel.requested, arrived: landing.toArray(), offsetMeters: offset };
        this.travelCount++; this.travel = undefined; this.photoreal?.setTravelDestination(null);
        this.travelMessage = offset > 2 ? 'Arrived at a clear spot nearby.' : 'You’re here. Explore from this spot.';
        this.travelMessageUntil = now + 4500; this.lastHud = 0;
        this.drawMap();
        return;
      }
      if (now - travel.candidateSince > 1800) {
        travel.index++;
        travel.candidateSince = now;
        if (travel.index >= travel.candidates.length) this.cancelTravel('No clear landing here. Try a nearby path.');
      }
    }
    // A clipped district can fail readiness at the exact point (for example a
    // tree occupies it) even though a nearby candidate has usable ground. Give
    // streaming time to settle, then try that neighbor rather than waiting on
    // the same obstructed point for the whole trip deadline.
    if (this.travel && !prepared && now - travel.candidateSince > 6000) {
      travel.index++; travel.candidateSince = now;
      if (travel.index >= travel.candidates.length) this.cancelTravel('No clear landing here. Try a nearby path.');
    }
    if (this.travel && now - travel.started > 45000) this.cancelTravel('That area could not load. You’re still at your original spot.');
  }
  bindControls() {
    const options = { signal: this.signal.signal };
    const canvas = this.renderer.domElement;
    let dragging = false;
    window.addEventListener(
      'keydown',
      (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        if (e.code === 'KeyM' && this.active && !e.repeat) {
          e.preventDefault(); this.setMapExpanded(!this.mapExpanded); return;
        }
        if (e.code === 'Escape') {
          if (this.travel) this.cancelTravel();
          if (this.mapExpanded) this.setMapExpanded(false);
        }
        if (this.travel || this.mapExpanded || e.target === this.map) return;
        if (e.code === 'KeyF' && this.active && !this.overview) {
          e.preventDefault(); if(!e.repeat)this.toggleScooter(); return;
        }
        if (
          [
            'KeyW',
            'KeyA',
            'KeyS',
            'KeyD',
            'Space',
            'ShiftLeft',
            'ShiftRight',
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
          ].includes(e.code)
        ) {
          if (this.active) {
            e.preventDefault();
            this.keys.add(e.code);
            if (!e.repeat) this.pressedAt.set(e.code, performance.now());
            if (e.code === 'Space' && !e.repeat && !this.scooter.mounted) this.jumpQueued = true;
          }
        }
        if (e.code === 'Escape') {
          this.pauseScooter();
          this.keys.clear(); this.pressedAt.clear(); this.jumpQueued = false;
          document.exitPointerLock?.();
        }
        if (e.code === 'KeyV' && this.active && !e.repeat) {
          this.overview = !this.overview; this.pauseScooter();
          this.keys.clear(); this.pressedAt.clear(); this.jumpQueued = false; this.velocity.set(0,0,0);
        }
      },
      options,
    );
    this.map.addEventListener('click', e => {
      if (!this.drawnMap) return;
      const rect = this.map.getBoundingClientRect();
      this.travelTo(mapPoint(this.drawnMap, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height));
    }, options);
    this.map.addEventListener('keydown', e => {
      if (!this.ready || !this.active || !this.drawnMap) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space'].includes(e.code)) {
        e.preventDefault(); e.stopPropagation();
        const p = this.body.translation(); this.mapCursor ??= [p.x, p.z];
        const amount = this.mapExpanded ? 20 : 5;
        if (e.code === 'ArrowLeft') this.mapCursor[0] -= amount;
        if (e.code === 'ArrowRight') this.mapCursor[0] += amount;
        if (e.code === 'ArrowUp') this.mapCursor[1] -= amount;
        if (e.code === 'ArrowDown') this.mapCursor[1] += amount;
        if (e.code === 'Enter' || e.code === 'Space') this.travelTo([...this.mapCursor]);
        this.drawMap();
      }
    }, options);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), options);
    const clear = () => {
      this.pauseScooter();
      this.keys.clear();
      this.pressedAt.clear();
      dragging = false;
      this.jumpQueued = false;
    };
    window.addEventListener('blur', clear, options);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) clear();
        this.last = performance.now();
      },
      options,
    );
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.active || this.mapExpanded || this.travel) return;
        dragging = true;
        canvas.setPointerCapture(e.pointerId);
        canvas.focus();
      },
      options,
    );
    canvas.addEventListener(
      'pointerup',
      () => {
        dragging = false;
      },
      options,
    );
    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (
          !this.active || this.mapExpanded || this.travel ||
          (!dragging && document.pointerLockElement !== canvas)
        )
          return;
        this.yaw -= e.movementX * 0.003;
        this.pitch = THREE.MathUtils.clamp(
          this.pitch + e.movementY * 0.002,
          -0.9,
          1.12,
        );
      },
      options,
    );
    canvas.addEventListener(
      'dblclick',
      () => {
        if (this.active)
          void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
      },
      options,
    );
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.active) {
          e.preventDefault();
          if (this.overview)
            this.overviewDistance = THREE.MathUtils.clamp(
              this.overviewDistance + e.deltaY * 0.25,
              120,
              1400,
            );
          else
            this.distance = THREE.MathUtils.clamp(
              this.distance + e.deltaY * 0.006,
              2.5,
              16,
            );
        }
      },
      { signal: this.signal.signal, passive: false },
    );
    window.addEventListener(
      'resize',
      () => {
        if (this.disposed) return;
        const w = this.host.clientWidth,
          h = this.host.clientHeight;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.ambientOcclusion.resize();
      },
      options,
    );
  }
  private prepareScooterGround() {
    // Active offscreen tiles retain physics and valid world transforms, but
    // TilesRenderer removes them from group.children. Enumerate their scenes
    // explicitly so camera visibility cannot remove nearby riding support.
    const roots: THREE.Object3D[] = this.photoreal
      ? [...this.photoreal.tiles.activeTiles].flatMap(tile => {
          const entry = this.photoreal!.entries.get(tile);
          return entry?.repaired ? [entry.scene] : [];
        })
      : [this.world.group];
    // Authored surfaces are the complete ground source in offline mode and
    // remain the collision source underneath streamed imagery online.
    if (this.walkway) roots.push(this.walkway.surfaces);
    this.scooterGround.prepare(roots, this.body.translation(), mesh => {
      const tile = mesh.userData.tile;
      return !tile || !!(this.photoreal?.entries.get(tile)?.repaired &&
        this.photoreal.tiles.activeTiles.has(tile));
    });
  }
  private notifyRide(message: string) {
    this.scooterMessage = message; this.scooterMessageUntil = performance.now() + 3500; this.lastHud = 0;
  }
  private pauseScooter() {
    this.scooter.stop();
    if(this.scooter.mode === 'mounting')this.leaveScooter();
    else if(this.scooter.mode === 'dismounting') {
      // Every completed substep was physically supported; finish on foot there.
      this.leaveScooter();
    }
    this.velocity.set(0,0,0); this.jumpQueued = false;
  }
  private leaveScooter() {
    this.scooterWarningLatched = false;
    this.scooterPose?.restore(); this.scooter.foot(); this.scooterDismount = undefined;
    this.avatar.rotation.x = 0; this.avatar.rotation.z = 0;
    this.scooterParkedUntil = 0;
    if(this.scooterVisual)this.scooterVisual.root.visible = false;
  }
  private toggleScooter() {
    if(!this.ready || !this.scooterClearance || !this.scooterVisual)return;
    if(this.scooter.mode === 'foot') {
      if(!this.grounded || !this.scooterCollisionReady) { this.notifyRide('Move onto a clear path to ride.'); return; }
      this.prepareScooterGround();
      const support = this.scooterClearance.canMount(this.avatar.rotation.y);
      this.scooterSupport = support;
      if(!support.allowed) { this.notifyRide('Move onto a clear path to ride.'); return; }
      this.scooter.mount(this.avatar.rotation.y); this.riderStationary=1; this.velocity.set(0,0,0); this.jumpQueued = false;
      this.scooterMessage = ''; this.scooterWarningLatched = false; this.scooterParkedUntil = 0;
    } else this.scooter.requestDismount();
    this.lastHud = 0;
  }
  private updateScooterVisual(position: {x:number;y:number;z:number}) {
    const model=this.scooterVisual;
    if(!model)return;
    const dismount=this.scooterDismount;
    if(this.scooter.mounted) {
      const p=dismount?.start ?? position;
      model.root.position.set(p.x,p.y-.905,p.z);
      const rotation=this.scooterSupport?.support?.rotation;
      if(rotation)model.root.quaternion.set(rotation.x,rotation.y,rotation.z,rotation.w);
      else model.root.rotation.set(0,this.scooter.heading,0,'YXZ');
      model.root.rotateZ(this.scooter.lean);
      model.update({steer:this.scooter.steer,distance:this.scooter.distance,parked:!!dismount});
    }
    model.root.visible = !this.travel && (this.scooter.mounted || performance.now()<this.scooterParkedUntil);
  }
  private stepScooter(dt: number, held: (code:string)=>boolean) {
    const motion=this.scooter, clearance=this.scooterClearance!, p=this.body.translation();
    this.prepareScooterGround();
    this.previousPosition.set(p.x,p.y,p.z); this.jumpQueued=false; this.vertical=0;
    if(this.mapExpanded || this.overview || !this.active || !this.scooterCollisionReady)motion.stop();
    const allowInput=!this.mapExpanded && !this.overview && this.active && this.scooterCollisionReady;
    if(motion.pendingDismount && motion.speed<=SCOOTER_TUNING.dismountSpeed) {
      const landing=clearance.findDismount(motion.heading);
      if(landing.allowed && landing.center) {
        this.scooterDismount={start:new THREE.Vector3(p.x,p.y,p.z),target:new THREE.Vector3(landing.center.x,landing.center.y,landing.center.z),path:landing.path,heading:motion.heading};
        motion.beginDismount();
      } else { motion.stop(); this.notifyRide('Move to a clearer spot to get off.'); }
    }
    const beforeHeading=motion.heading;
    const requested=motion.update(dt,{throttle:allowInput&&held('KeyW'),brake:allowInput&&(held('KeyS')||held('Space')),left:allowInput&&held('KeyA'),right:allowInput&&held('KeyD')});
    let movement: {x:number;y:number;z:number} = {x:0,y:0,z:0};
    let supported=false;
    if(this.scooterDismount) {
      const dismount=this.scooterDismount, progress=motion.mode==='foot'?1:motion.transition;
      const cursor=progress*(dismount.path.length-1),i=Math.min(dismount.path.length-2,Math.floor(cursor));
      const waypoint=new THREE.Vector3().copy(dismount.path[i]).lerp(dismount.path[i+1],cursor-i);
      const checked=clearance.traceDismount({x:p.x,y:p.y,z:p.z},{x:waypoint.x-p.x,z:waypoint.z-p.z});
      let accepted=false;
      if(checked.allowed && checked.center) {
        this.controller.computeColliderMovement(this.collider,{x:checked.center.x-p.x,y:checked.center.y-p.y-.0067,z:checked.center.z-p.z});
        const actual=this.controller.computedMovement();
        const actualPath=clearance.traceDismount({x:p.x,y:p.y,z:p.z},{x:actual.x,z:actual.z});
        const center={x:p.x+actual.x,y:p.y+actual.y,z:p.z+actual.z};
        accepted=actualPath.allowed && !!actualPath.center && Math.abs(center.y-actualPath.center.y)<.04 && clearance.canOccupyPerson(center).allowed;
        if(accepted) {movement=actual;supported=true;}
      }
      if(!accepted) {
        this.leaveScooter();this.notifyRide('The path changed. Stopped here on foot.');
      } else if(motion.mode==='foot') {
        this.scooterDismount=undefined;this.scooterParkedUntil=performance.now()+500;
      }
    } else {
      const queryStarted=performance.now();
      const resolved=clearance.resolveMove({displacement:{x:requested.x,z:requested.z},fromHeading:beforeHeading,heading:requested.heading});
      this.scooterQueryMs.push(performance.now()-queryStarted);
      if(this.scooterQueryMs.length>120)this.scooterQueryMs.shift();
      movement=resolved.delta;supported=resolved.grounded;
      motion.reconcile(movement.x,movement.z,dt,resolved.allowedHeading,!!resolved.blockedReason);
      this.scooterSupport=resolved;
      // Small contact-solver reductions on a supported grade are ordinary
      // riding, not a reason to tell the player to take the stairs on foot.
      const warn=resolved.blockedReason && !(resolved.blockedReason==='controller' && resolved.fraction>=.8);
      if(warn && Math.hypot(requested.x,requested.z)>.0001 && !this.scooterWarningLatched) {
        const reason=resolved.blockedReason;
        const message=reason==='unsupported'||reason==='surface-mismatch'
          ? 'Waiting for the path ahead…'
          : reason==='step'||reason==='drop'||reason==='slope'
            ? 'Steps or rough ground ahead.'
            : 'Path blocked. Brake and steer around.';
        this.notifyRide(message);
        this.scooterWarningLatched=true;
      } else if(!warn && Math.hypot(movement.x,movement.z)>.01) {
        // A stopped obstacle should not renew its toast on every physics tick.
        this.scooterWarningLatched=false;
      }
    }
    this.body.setNextKinematicTranslation({x:p.x+movement.x,y:p.y+movement.y,z:p.z+movement.z});
    this.physics.step();this.contacts=this.controller.numComputedCollisions();
    this.grounded=supported;
    this.velocity.set(movement.x/dt,0,movement.z/dt);
    this.avatar.position.set(p.x+movement.x,p.y+movement.y-.905,p.z+movement.z);
    this.avatar.rotation.set(0,motion.heading,motion.lean,'YXZ');
    if(this.action!=='Idle') {this.actions[this.action]?.fadeOut(.18);this.actions.Idle?.reset().fadeIn(.18).play();this.action='Idle';}
    if(this.actions.Idle)this.actions.Idle.timeScale=1;
    this.mixer?.update(dt);
    this.updateScooterVisual(this.body.translation());
    this.avatar.updateMatrixWorld(true);
    this.riderStationary += ((motion.actualSpeed<.15?1:0)-this.riderStationary)*(1-Math.exp(-dt*8));
    if(motion.mounted && this.scooterVisual)this.scooterPose?.apply({targets:this.scooterVisual.targets,weight:motion.weight,stationary:this.riderStationary});
    else { this.scooterPose?.restore();this.avatar.rotation.x=0;this.avatar.rotation.z=0; }
  }
  step(dt: number) {
    this.scooterPose?.restore();
    const held = (code: string) =>
      this.keys.has(code) ||
      performance.now() - (this.pressedAt.get(code) ?? -1000) < 65;
    const forward = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0),
      strafe = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0);
    if (this.keys.has('ArrowLeft')) this.yaw += dt * 1.6;
    if (this.keys.has('ArrowRight')) this.yaw -= dt * 1.6;
    if (this.keys.has('ArrowUp'))
      this.pitch = Math.max(-0.9, this.pitch - dt * 0.8);
    if (this.keys.has('ArrowDown'))
      this.pitch = Math.min(1.12, this.pitch + dt * 0.8);
    if(this.scooter.mounted) { this.stepScooter(dt,held);return; }
    const input = new THREE.Vector3(strafe, 0, -forward);
    if (input.lengthSq() > 0) input.normalize();
    input.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const speed =
      this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
    const alpha = 1 - Math.exp(-dt * (this.grounded ? 13 : 4));
    this.velocity.x = THREE.MathUtils.lerp(
      this.velocity.x,
      input.x * speed,
      alpha,
    );
    this.velocity.z = THREE.MathUtils.lerp(
      this.velocity.z,
      input.z * speed,
      alpha,
    );
    if (this.jumpQueued && this.grounded) {
      this.vertical = 7.2;
      this.grounded = false;
      this.jumps++;
    }
    this.jumpQueued = false;
    this.vertical = Math.max(-35, this.vertical - 24 * dt);
    const p = this.body.translation();
    this.previousPosition.set(p.x, p.y, p.z);
    this.controller.computeColliderMovement(this.collider, {
      x: this.velocity.x * dt,
      y: this.vertical * dt,
      z: this.velocity.z * dt,
    });
    const movement = this.controller.computedMovement();
    this.grounded = characterSupported(this.controller, p.y, this.vertical);
    this.contacts = this.controller.numComputedCollisions();
    if (this.grounded && this.vertical < 0) this.vertical = 0;
    if (this.vertical > 0 && movement.y < this.vertical * dt - 0.01)
      this.vertical = 0;
    this.body.setNextKinematicTranslation({
      x: p.x + movement.x,
      y: p.y + movement.y,
      z: p.z + movement.z,
    });
    this.physics.step();
    // No wall tunneling: rotation and animation use the displacement physics allowed.
    const actualSpeed = Math.hypot(movement.x, movement.z) / dt;
    if (actualSpeed > 0.1) {
      const angle = Math.atan2(movement.x, movement.z);
      this.avatar.rotation.y +=
        (THREE.MathUtils.euclideanModulo(
          angle - this.avatar.rotation.y + Math.PI,
          2 * Math.PI,
        ) -
          Math.PI) *
        (1 - Math.exp(-dt * 14));
    }
    const next = !this.grounded
      ? 'Idle'
      : actualSpeed > 3.3
        ? 'Run'
        : actualSpeed > 0.2
          ? 'Walk'
          : 'Idle';
    if (next !== this.action) {
      this.actions[this.action]?.fadeOut(0.18);
      this.actions[next]?.reset().fadeIn(0.18).play();
      this.action = next;
    }
    if (this.actions[next])
      this.actions[next].timeScale =
        next === 'Run'
          ? actualSpeed / this.runCycleSpeed
          : next === 'Walk'
            ? actualSpeed / this.walkCycleSpeed
            : 1;
    this.mixer?.update(dt);
    if (!this.grounded) {
      const bend = THREE.MathUtils.clamp(
        1 - Math.abs(this.vertical) / 15,
        0.3,
        1,
      );
      for (const [name, bone] of Object.entries(this.airBones)) {
        const amount = name.endsWith('Thigh')
          ? 0.5
          : name.endsWith('Calf')
            ? -0.95
            : 0.2;
        // This rig's limb hinge is local Z. Its matching idle clip resets these
        // rotations each step, preventing procedural airborne pose accumulation.
        bone.rotateZ(amount * bend);
      }
    }
  }
  tick = (now: number) => {
    const cpuFrameStart = performance.now();
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const rawElapsed = Math.max(0, (now - this.last) / 1000),
      elapsed = Math.min(rawElapsed, 0.1);
    this.last = now;
    if (document.hidden) return;
    if (this.travel) {
      this.updateTravel(now);
      this.accumulator = 0;
      this.avatar.visible = false;
      this.walkway?.update(this.camera);
      this.ambientOcclusion.render(false);
      if (now - this.lastHud > 250) {
        this.lastHud = now;
        this.report({ ready: this.ready, location: 'UT Austin', speed: 0, fps: 0,
          mode: 'Travel', mapExpanded: this.mapExpanded, traveling: !!this.travel,
          travelMessage: this.travelMessage, offline: this.offline,
          imagery: this.imagerySnapshot() });
        this.drawMap();
      }
      return;
    }
    if (this.photoreal) {
      const current = this.body.translation();
      const position = new THREE.Vector3(current.x, current.y, current.z);
      this.photoreal.update(position);
      this.walkway?.stitchGround(this.physics, position, (x, z, referenceY) =>
        this.photoreal!.groundEdge(x, z, referenceY),
      );
      if (!this.ready) {
        const { x, z } = this.spawn;
        const anchor = this.photoreal.calibrationAnchor;
        const aligned = this.photoreal.calibrate(
          anchor.x,
          anchor.z,
          this.world.terrain.height(anchor.x, anchor.z),
        );
        const collisions = aligned && this.photoreal.syncCollisions(position);
        if (collisions) {
          const surface = this.photoreal.surface(x, z);
          if (surface) {
            position.set(x, surface.point.y + 0.92, z);
            this.body.setTranslation(position, true);
            this.body.setNextKinematicTranslation(position);
            this.previousPosition.copy(position);
            this.focus.copy(position).add(new THREE.Vector3(0, 0.6, 0));
            this.physics.step();
            this.ready = true;
            this.accumulator = 0;
          }
        }
        if (now - this.lastHud > 250) {
          this.lastHud = now;
          this.report({
            ready: this.ready,
            location: 'MLK memorial · East Mall',
            speed: 0,
            fps: 0,
            mode: this.ready ? 'Ready' : 'Loading campus imagery',
            offline: this.offline,
            imagery: this.imagerySnapshot(),
            ...(this.photoreal.rootFailed
              ? {
                  error:
                    this.photoreal.loadErrorsByKind['HTTP 429']
                      ? 'Campus scenery is temporarily unavailable because downloads are being limited.'
                      : this.options.tilesConfig
                        ? 'Campus imagery could not load. Open Imagery settings to check your token, allowed site address, or Cesium usage.'
                        : 'Campus imagery could not load. Check the connection and Cesium configuration.',
                }
              : {}),
            ...(this.photoreal.preparationFailed
              ? {
                  error:
                    'Campus ground preparation failed. Reload to try again.',
                }
              : {}),
          });
        }
        this.walkway?.update(this.camera);
        this.ambientOcclusion.render(false);
        return;
      }
      const previousChanges = this.photoreal.collisionChanges;
      this.scooterCollisionReady = this.photoreal.syncCollisions(position);
      if (
  (this.grounded || this.scooter.mounted) &&
  previousChanges !== this.photoreal.collisionChanges
) {
  const surface = this.photoreal.surface(
    position.x,
    position.z,
    position.y + 0.7,
    3,
  );
  if (this.scooter.mounted) {
    this.prepareScooterGround();
    const clearance = this.scooterClearance!;
    // A newly installed collider can invalidate a stopped rider even when
    // the preceding frame no longer reported grounded. Avoid the foot-only
    // 40 mm deadband: the capsule has only 25 mm of initial ground clearance.
    if (!clearance.canMount(this.scooter.heading).allowed) {
      const correction = surface ? surface.point.y + 0.905 - position.y : NaN;
      const standing = position.clone();
      let corrected = false;
      if (correction > 0.0001 && correction < 1.5) {
        standing.y += correction;
        // The destination must match visible/physical support and fit the
        // person. Permit exiting initial floor penetration, but sweep upward
        // so recovery cannot pass through an overhead obstacle.
        corrected = clearance.canOccupyPerson(standing).allowed &&
          !this.physics.castShape(
            position, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: correction, z: 0 },
            new RAPIER.Capsule(.54, .34), 0, 1, false,
            RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider,
          );
      }
      this.leaveScooter();
      this.scooterSupport = null;
      this.velocity.set(0, 0, 0); this.vertical = 0;
      this.keys.clear(); this.pressedAt.clear(); this.jumpQueued = false;
      if (corrected) {
        position.copy(standing);
        this.body.setTranslation(position, true);
        this.body.setNextKinematicTranslation(position);
        this.previousPosition.copy(position);
        this.physics.step();
      }
      this.grounded = corrected || clearance.canOccupyPerson(position).allowed;
      this.notifyRide(corrected
        ? 'Ground updated. Press F to ride again.'
        : this.grounded
          ? 'Scenery updated. Continue on foot and mount again in a clear spot.'
          : 'Ground changed here. Choose a clear spot on the map.');
    }
  } else if (surface) {
    // Preserve the existing on-foot recovery threshold and clear-pose test.
    const correction = surface.point.y + 0.905 - position.y;
    if (correction > 0.04 && correction < 1.5) {
      const standing = position.clone(); standing.y += correction;
      const clear = !this.physics.intersectionWithShape(
        standing, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(.54, .34),
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider,
      );
      if (clear) {
        position.y += correction;
        this.body.setTranslation(position, true);
        this.body.setNextKinematicTranslation(position);
        this.previousPosition.copy(position);
        this.physics.step();
      }
    }
  }
}
    }
    if (rawElapsed > 0) this.fpsSamples.push(rawElapsed * 1000);
    if (this.fpsSamples.length > 600) this.fpsSamples.shift();
    this.accumulator += elapsed;
    while (this.accumulator >= 1 / 60) {
      this.step(1 / 60);
      this.accumulator -= 1 / 60;
    }
    const current = this.body.translation(),
      p = this.previousPosition
        .clone()
        .lerp(
          new THREE.Vector3(current.x, current.y, current.z),
          this.accumulator / (1 / 60),
        );
    this.avatar.position.set(p.x, p.y - 0.905, p.z);
    this.updateScooterVisual(p);
    this.focus.lerp(
      new THREE.Vector3(p.x, p.y + 0.6, p.z),
      1 - Math.exp(-elapsed * 12),
    );
    const overviewCamera = this.overview || (!this.active && !!this.photoreal);
    this.rideCameraBlend += ((this.scooter.mounted?1:0)-this.rideCameraBlend)*(1-Math.exp(-elapsed*4));
    const requestedDistance = this.distance + .9*this.rideCameraBlend;
    const fov = 55 + 3*this.rideCameraBlend*Math.min(1,this.scooter.actualSpeed/this.scooter.maxSpeed);
    if(Math.abs(this.camera.fov-fov)>.005) {this.camera.fov=fov;this.camera.updateProjectionMatrix();}
    const viewPitch = overviewCamera ? 0.95 : this.pitch;
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(viewPitch),
      Math.sin(viewPitch),
      Math.cos(this.yaw) * Math.cos(viewPitch),
    );
    const hit = this.physics.castShape(
      this.focus,
      { x: 0, y: 0, z: 0, w: 1 },
      offset,
      new RAPIER.Ball(0.23),
      0.03,
      requestedDistance,
      true,
      undefined,
      undefined,
      this.collider,
    );
    const cameraDistance = overviewCamera
      ? this.active
        ? this.overviewDistance
        : 280
      : hit
        ? Math.max(0.03, hit.time_of_impact - 0.035)
        : requestedDistance;
    this.avatar.visible = cameraDistance > 0.85;
    this.camera.position
      .copy(this.focus)
      .addScaledVector(offset, cameraDistance);
    this.camera.lookAt(this.focus);
    // Follow the player with a small, high-resolution shadow frustum.
    const sx = Math.round(p.x * 16) / 16,
      sz = Math.round(p.z * 16) / 16;
    this.sun.target.position.set(sx, p.y, sz);
    this.sun.position.set(sx + 80, p.y + 105, sz + 45);
    this.sun.target.updateMatrixWorld();
    this.contactShadow?.update(p, now);
    if (!this.photoreal) this.world.update(p.x, p.z);
    this.profiler.begin(this.frames);
    this.walkway?.update(this.camera);
    if(this.active&&!overviewCamera)this.localReflection?.update(p,now);
    this.ambientOcclusion.render(!overviewCamera);
    this.profiler.end(performance.now() - cpuFrameStart);
    this.frames++;
    if (now - this.lastHud > 250) {
      this.lastHud = now;
      let location = 'UT Austin',
        closest = Infinity;
      for (const v of Object.values(this.world.data.landmarks)) {
        const d = Math.hypot(v.position[0] - p.x, v.position[1] - p.z);
        if (d < closest) {
          closest = d;
          location = v.name;
        }
      }
      if (Math.abs(p.x) < 25 && Math.abs(p.z) < 320)
        location = 'Speedway · ' + location;
      const recent = this.fpsSamples.slice(-60),
        fps = 1000 / (recent.reduce((a, b) => a + b, 0) / recent.length);
      this.report({
        ready: true,
        location,
        speed: Math.hypot(this.velocity.x, this.velocity.z),
        fps,
        mode: this.scooter.mounted ? 'Scooter' : this.grounded ? this.action : 'Jump',
        locomotion: this.scooter.mode, scooterSpeed: this.scooter.actualSpeed,
        rideMessage: now<this.scooterMessageUntil ? this.scooterMessage : undefined,
        offline: this.offline,
        imagery: this.imagerySnapshot(),
        ...(this.photoreal?.preparationFailed
          ? { error: 'Campus ground preparation failed. Reload to try again.' }
          : {}),
        overview: this.overview,
        mapExpanded: this.mapExpanded,
        traveling: false,
        travelMessage: now < this.travelMessageUntil ? this.travelMessage : undefined,
        heading: (() => {
          const deg = THREE.MathUtils.euclideanModulo(
            (-this.yaw * 180) / Math.PI,
            360,
          );
          return (
            ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
              Math.round(deg / 45) % 8
            ] +
            ' · ' +
            Math.round(deg) +
            '°'
          );
        })(),
      });
      this.trail.push({
        t: Math.round(now - this.startedAt),
        x: p.x,
        y: p.y,
        z: p.z,
        grounded: this.grounded,
        action: this.action,
      });
      if (this.trail.length > 1200) this.trail.shift();
      this.drawMap();
    }
  };
  drawMap() {
    const ctx = this.map.getContext('2d');
    if (!ctx) return;
    const p = this.body.translation(),
      view = mapView(this.world.data.bounds, p, this.mapExpanded),
      { size, scale } = view;
    this.drawnMap = view;
    if (this.map.width !== size) this.map.width = this.map.height = size;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#27352b';
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(scale, scale);
    ctx.translate(-view.x, -view.z);
    ctx.strokeStyle = '#d2cfb899';
    for (const path of this.world.data.paths) {
      if (
        !path.points.some(
          ([x, z]) => Math.abs(x - view.x) < size / scale && Math.abs(z - view.z) < size / scale,
        )
      )
        continue;
      ctx.lineWidth = Math.max(2, path.width);
      ctx.beginPath();
      path.points.forEach(([x, z], i) =>
        i ? ctx.lineTo(x, z) : ctx.moveTo(x, z),
      );
      ctx.stroke();
    }
    ctx.fillStyle = '#c1bca6';
    for (const b of this.world.data.buildings) {
      if (Math.hypot(b.center[0] - view.x, b.center[1] - view.z) > size / scale) continue;
      ctx.beginPath();
      b.rings.forEach((r) => {
        r.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
        ctx.closePath();
      });
      ctx.fill('evenodd');
    }
    ctx.restore();
    for (const [abbr, l] of Object.entries(this.world.data.landmarks)) {
      const x = (l.position[0] - view.x) * scale + size / 2,
        z = (l.position[1] - view.z) * scale + size / 2;
      if (x < 12 || x > size - 28 || z < 18 || z > size - 8) continue;
      ctx.fillStyle = '#ce702e';
      ctx.beginPath();
      ctx.arc(x, z, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `bold ${this.mapExpanded ? 18 : 13}px Arial`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#203329';
      ctx.strokeText(abbr, x + 7, z + 4);
      ctx.fillStyle = '#fff';
      ctx.fillText(abbr, x + 7, z + 4);
    }
    ctx.save();
    const destination = this.travel?.requested ?? this.mapCursor;
    if (destination) {
      const x = (destination[0] - view.x) * scale + size / 2, z = (destination[1] - view.z) * scale + size / 2;
      ctx.strokeStyle = '#ffb779'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, z, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 14, z); ctx.lineTo(x + 14, z); ctx.moveTo(x, z - 14); ctx.lineTo(x, z + 14); ctx.stroke();
    }
    ctx.translate((p.x - view.x) * scale + size / 2, (p.z - view.z) * scale + size / 2);
    ctx.rotate(-this.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1b2423';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  snapshot({ includeCharacterBounds = false }: { includeCharacterBounds?: boolean } = {}) {
    const p = this.body?.translation(),
      a = [...this.fpsSamples].sort((a, b) => a - b);
    return {
      ready: this.ready,
      active: this.active,
      ambientOcclusion: this.ambientOcclusion.snapshot(),
      localReflection: this.localReflection?.snapshot(),
      localSurfaces: this.localSurfaces?.stats,
      mainMaterialFinish: this.mainMaterialFinish,
      mainBuildingEnvelope: this.mainBuildingEnvelope,
      position: p,
      grounded: this.grounded,
      vertical: this.vertical,
      yaw: this.yaw,
      pitch: this.pitch,
      action: this.action,
      character: {
        assetUrl: this.characterAssetUrl,
        source: this.characterName,
        walkCycleSpeed: this.walkCycleSpeed,
        runCycleSpeed: this.runCycleSpeed,
      },
      contactShadow: this.contactShadow?.stats,
      jumps: this.jumps,
      contacts: this.contacts,
      keys: [...this.keys],
      camera: this.camera.position.toArray(),
      terrain: p ? this.world.terrain.height(p.x, p.z) : null,
      frames: this.frames,
      frameMs: {
        median: a[Math.floor(a.length * 0.5)],
        p95: a[Math.floor(a.length * 0.95)],
        sampleCount: a.length,
      },
      timing: this.profiler.snapshot(),
      render: this.renderer.info.render,
      memory: this.renderer.info.memory,
      // GIS footprint counts do not establish rendered building coverage.
      mappedBuildingFootprints: this.world?.data.buildings.length,
      physicsColliderCount: this.physics?.colliders.len(),
      authoredTreePlacements: this.walkway?.treePlacements.length ?? 0,
      legacyWorldCounts: { colliders: this.world?.colliders, stairs: this.world?.stairCount,
        trees: this.world?.treeCount, mappedTrees: this.world?.mappedTreeCount },
      landscape: this.walkway?.snapshot(),
      offline: this.offline,
      offlineTerrain: this.offlineTerrain,
      imagery: this.imagerySnapshot(),
      overview: this.overview,
      mapExpanded: this.mapExpanded,
      mapView: this.drawnMap,
      travel: { pending: !!this.travel, count: this.travelCount, last: this.lastTravel,
        candidate: this.travel?.candidates[this.travel.index], message: this.travelMessage },
      scooter: {...this.scooter.snapshot(),support:this.scooterSupport,collisionReady:this.scooterCollisionReady,groundQuery:{...this.scooterGround.stats},queryMs:this.scooterQueryMs.length ? {mean:this.scooterQueryMs.reduce((a,b)=>a+b,0)/this.scooterQueryMs.length,max:Math.max(...this.scooterQueryMs)} : null,model:this.scooterVisual?.stats,pose:this.scooterPose?.diagnostics({includeBounds:includeCharacterBounds})},
      movement: { walkSpeed: WALK_SPEED, runSpeed: RUN_SPEED, speed: Math.hypot(this.velocity.x, this.velocity.z) },
      viewport: {
        width: this.host.clientWidth,
        height: this.host.clientHeight,
        pixelRatio: this.renderer.getPixelRatio(),
      },
      renderer: this.renderer
        .getContext()
        .getParameter(this.renderer.getContext().RENDERER),
      trail: this.trail.slice(-20),
    };
  }
  dispose() {
    // React hot reload can invoke cleanup more than once for the same instance.
    // Rapier's world.free() is not idempotent.
    if (this.disposed) return;
    this.disposed = true;
    if (this.world) this.world.disposed = true;
    this.photoreal?.dispose();
    this.contactShadow?.dispose();
    this.ambientOcclusion.dispose();
    // Road finishes borrow textures from both the walkway and world. Dispose
    // only their clones here, then remove them before generic scene cleanup
    // collects textures already owned by those two source systems.
    this.localSurfaces?.group.removeFromParent();
    this.localSurfaces?.dispose();
    if (this.walkway && this.physics) this.walkway.dispose(this.physics);
    cancelAnimationFrame(this.raf);
    this.signal.abort();
    this.localReflection?.dispose();
    this.scooterGround.clear();
    this.scooterPose?.dispose();
    this.scooterVisual?.dispose();
    if (document.pointerLockElement === this.renderer.domElement)
      document.exitPointerLock();
    const geometries = new Set<THREE.BufferGeometry>(),
      mats = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    for (const root of [this.scene, this.world?.group])
      root?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material)
          for (const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]) {
            mats.add(material);
            for (const value of Object.values(material))
              if (value instanceof THREE.Texture) textures.add(value);
          }
        if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
      });
    for (const material of Object.values(this.world?.loadedMaterials ?? {})) {
      mats.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
    geometries.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    for (const texture of this.mainBorrowedTextures) textures.delete(texture);
    this.mainBorrowedTextures.clear();
    textures.forEach((t) => t.dispose());
    this.world?.disposePendingResources();
    this.skyEnvironment.dispose();
    this.profiler.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.physics?.free();
  }
}
