import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TilesRenderer, WGS84_ELLIPSOID } from '3d-tiles-renderer/three';
import type { Tile } from '3d-tiles-renderer/core';
import { CesiumIonAuthPlugin, GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import {
  GLTFExtensionsPlugin,
  LoadRegionPlugin,
  SphereRegion,
} from '3d-tiles-renderer/three/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { CutVolume } from './clip-volume';
import { MeshRepairQueue } from './mesh-repair-queue';
import { resetRateLimitedTiles, TileDownloadRecovery } from './tile-download-recovery';

export interface TilesConfig {
  token: string;
  assetId: number;
  /** Validated Cesium-issued Google endpoint, kept only in browser memory. */
  endpointUrl?: string;
}
type Entry = {
  scene: THREE.Object3D;
  bounds?: THREE.Box3;
  colliders?: RAPIER.Collider[];
  triangles: number;
  repaired?: boolean;
  preparing?: boolean;
  preparationFailed?: boolean;
};

// The GIS source uses X=east, Y=up, Z=south. Tiles use Earth-centered meters.
// Keep the Earth-sized translation in a double-precision matrix, outside vertices.
export function campusFrame(longitude: number, latitude: number) {
  const lat = THREE.MathUtils.degToRad(latitude),
    lon = THREE.MathUtils.degToRad(longitude);
  const enu = WGS84_ELLIPSOID.getEastNorthUpFrame(
    lat,
    lon,
    165,
    new THREE.Matrix4(),
  );
  // Keep a rigid transform: tile screen-error calculations assume uniform scale.
  // The old GIS approximation differs by <0.1%; it now serves only the minimap.
  return new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(enu.invert());
}

export class PhotorealCampus {
  tiles: TilesRenderer;
  draco = new DRACOLoader().setDecoderPath('/draco/').setWorkerLimit(2);
  region = new SphereRegion({
    sphere: new THREE.Sphere(new THREE.Vector3(), 45),
    errorTarget: 0.7,
  });
  // Keep the measured open-road alignment anchor when the arrival moves under
  // East Mall's canopy. A treetop must not define the campus vertical offset.
  readonly calibrationAnchor = new THREE.Vector3(120, 0, -133);
  private calibrationRegion = new SphereRegion({sphere:new THREE.Sphere(new THREE.Vector3(),45),errorTarget:.7});
  private regions = new LoadRegionPlugin();
  private travelRegion?: SphereRegion;
  entries = new Map<Tile, Entry>();
  ray = new THREE.Raycaster();
  aligned = false;
  alignmentOffset = 0;
  errors = 0;
  loadErrorsByKind: Record<string, number> = {};
  rootFailed = false;
  loaded = 0;
  disposed = false;
  stableSince = 0;
  lastGround: number | null = null;
  lastGroundTile: Tile | null = null;
  calibrationProbe: { height: number; error: number } | null = null;
  collisionChanges = 0;
  collisionReady = false;
  private authoredSupportCache?: { position: THREE.Vector3; valid: boolean };
  firstSurfaceMs: number | null = null;
  start = performance.now();
  private materials = new Set<THREE.Material>();
  private repairGeometry = new Set<THREE.BufferGeometry>();
  private repairQueue = new MeshRepairQueue();
  private rateLimitedTiles = new Set<Tile>();
  private downloads = new TileDownloadRecovery(() => {
    resetRateLimitedTiles(this.tiles, this.rateLimitedTiles);
  });
  repairs = { meshes: 0 };
  maxCollisionInstallMs = 0;
  preparationFailed = false;

  constructor(
    config: TilesConfig,
    origin: [number, number],
    private camera: THREE.Camera,
    private renderer: THREE.WebGLRenderer,
    private physics: RAPIER.World,
    private cutVolumes: CutVolume[] = [],
    private authoredSurfaces?: THREE.Object3D,
  ) {
    const t = this.tiles = new TilesRenderer(config.endpointUrl);
    // Google tile bounding volumes can exclude real geometry. At Bellmont,
    // hierarchy traversal missed a visible floor that Rapier and direct mesh
    // rays both hit. Test active mesh bounds for ground/camera/map queries;
    // this supported renderer option does not change visual LOD or streaming.
    t.accelerateRaycast = false;
    t.group.matrixAutoUpdate = false;
    t.group.matrix.copy(campusFrame(...origin));
    t.group.updateMatrixWorld(true);
    t.fetchOptions = { referrerPolicy: 'strict-origin-when-cross-origin' };
    if (config.endpointUrl) {
      // Visitor setup already resolved this endpoint directly with Cesium.
      // Reuse it rather than making a second ion authentication request.
      const endpoint = new URL(config.endpointUrl);
      if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'tile.googleapis.com' ||
        endpoint.pathname !== '/v1/3dtiles/root.json' || !endpoint.searchParams.get('key'))
        throw Error('Unsupported campus imagery endpoint');
      t.registerPlugin(new GoogleCloudAuthPlugin({
        apiToken: endpoint.searchParams.get('key')!, useRecommendedSettings: false,
      }));
    } else {
      t.registerPlugin(new CesiumIonAuthPlugin({
        apiToken: config.token, assetId: String(config.assetId), useRecommendedSettings: false,
      }));
    }
    // Explicit decoder lifecycle avoids the plugin disposing absent optional loaders.
    t.registerPlugin(
      new GLTFExtensionsPlugin({
        dracoLoader: this.draco,
        metadata: false,
        autoDispose: false,
      }),
    );
    const regions = this.regions;
    regions.addRegion(this.region);
    regions.addRegion(this.calibrationRegion);
    t.registerPlugin(regions);
    t.errorTarget = 16;
    t.downloadQueue = this.downloads.queue;
    t.lruCache.maxSize = 2500;
    t.lruCache.minSize = 1800;
    t.lruCache.maxBytesSize = 768 * 1024 * 1024;
    t.lruCache.minBytesSize = 512 * 1024 * 1024;
    t.parseQueue.maxJobs = 3;
    t.setCamera(camera);
    t.addEventListener('load-model', ({ scene, tile }) => {
      this.loaded++;
      this.rateLimitedTiles.delete(tile);
      this.downloads.success();
      // The photographs already contain sunlight and shadows. Preserve their
      // color instead of lighting them again with the character's dynamic sun.
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const convert = (old: THREE.Material) => {
          const src = old as THREE.MeshStandardMaterial;
          const mat = new THREE.MeshBasicMaterial({
            map: src.map,
            color: src.color,
            vertexColors: src.vertexColors,
            side: src.side,
            toneMapped: false,
          });
          if (mat.map)
            mat.map.anisotropy = Math.min(
              8,
              renderer.capabilities.getMaxAnisotropy(),
            );
          this.materials.add(mat);
          return mat;
        };
        o.material = Array.isArray(o.material)
          ? o.material.map(convert)
          : convert(o.material);
        o.castShadow = false;
      });
      this.entries.set(tile, {
        scene,
        triangles: 0,
        repaired: this.cutVolumes.length === 0,
      });
    });
    t.addEventListener('dispose-model', ({ tile, scene }) => {
      const entry = this.entries.get(tile);
      if (entry) this.repairQueue.cancel(entry);
      this.removeColliders(entry);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh)
          if (this.repairGeometry.delete(o.geometry)) o.geometry.dispose();
        if (o instanceof THREE.Mesh)
          for (const mat of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            if (this.materials.delete(mat)) mat.dispose();
          }
      });
      this.entries.delete(tile);
    });
    // Never include provider URLs, auth query strings, or token-bearing errors
    // in our UI or diagnostic snapshot.
    t.addEventListener('load-error', ({ tile, error }) => {
      this.errors++;
      const status = error.message.match(/(?:status|error code)\s+([45]\d\d)\b/)?.[1];
      if (status === '429' && tile) this.rateLimitedTiles.add(tile);
      // Root/authentication recovery needs a separate plugin initialization
      // lifecycle. Do not retry it by re-registering the authentication plugins.
      this.downloads.failure(tile ? status : undefined);
      const kind = status ? `HTTP ${status}` :
        ['AbortError','TypeError','Error'].includes(error.name) ? error.name : 'Other error';
      this.loadErrorsByKind[kind] = (this.loadErrorsByKind[kind] ?? 0) + 1;
      if (!tile) this.rootFailed = true;
    });
  }

  update(position: THREE.Vector3) {
    this.downloads.update();
    this.camera.updateMatrixWorld();
    this.tiles.group.updateMatrixWorld(true);
    this.region.sphere.center
      .copy(position)
      .applyMatrix4(this.tiles.group.matrixWorldInverse);
    if(!this.aligned)this.calibrationRegion.sphere.center.copy(this.calibrationAnchor).applyMatrix4(this.tiles.group.matrixWorldInverse);
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.update();
    this.tiles.group.updateMatrixWorld(true);
  }

  surface(
    x: number,
    z: number,
    fromY = 250,
    distance = 500,
    sourceOnly = false,
  ) {
    this.ray.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    this.ray.near = 0;
    this.ray.far = distance;
    // Calibration must measure the source scan. Once it is registered, ground
    // queries must also see the authored geometry replacing that scan.
    const roots: THREE.Object3D[] = [this.tiles.group];
    if (!sourceOnly && this.aligned && this.authoredSurfaces) {
      this.authoredSurfaces.updateWorldMatrix(true, true);
      roots.push(this.authoredSurfaces);
    }
    const hits = this.ray.intersectObjects(roots, true);
    return (
      hits.find((hit) => {
        if (!hit.face) return false;
        const tile = hit.object.userData.tile as Tile | undefined;
        if (
          this.aligned &&
          !sourceOnly &&
          tile &&
          !this.entries.get(tile)?.repaired
        )
          return false;
        const normal = hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld);
        return normal.y > 0.5;
      }) ?? null
    );
  }

  groundEdge(x: number, z: number, referenceY: number) {
    if (!this.aligned) return null;
    const hit = this.surface(x, z, referenceY + 2.8, 5.6, true);
    const tile = hit?.object.userData.tile as Tile | undefined;
    if (
      !hit ||
      !tile ||
      tile.geometricError > 4 ||
      !this.entries.get(tile)?.repaired
    )
      return null;
    return hit.point.y;
  }

  calibrate(x: number, z: number, referenceY: number) {
    if (this.aligned) return true;
    const hit = this.surface(x, z);
    if (!hit) return false;
    const tile = hit.object.userData.tile as Tile;
    this.calibrationProbe = { height: hit.point.y, error: tile.geometricError };
    // Google's finest available tile here declares ~2 m geometric error; the
    // bound is not the texture resolution. Waiting for <1 m can never finish.
    if (tile.geometricError > 4) return false;
    if (
      tile !== this.lastGroundTile ||
      this.lastGround === null ||
      Math.abs(hit.point.y - this.lastGround) > 0.08
    ) {
      this.stableSince = performance.now();
      this.lastGroundTile = tile;
      this.lastGround = hit.point.y;
      return false;
    }
    if (performance.now() - this.stableSince < 900) return false;
    // A measured local alignment, not a claim that orthometric heights equal
    // ellipsoid heights. All subsequent walking uses the displayed tile surface.
    this.alignmentOffset = referenceY - hit.point.y;
    this.tiles.group.matrix.elements[13] += this.alignmentOffset;
    this.tiles.group.updateMatrixWorld(true);
    for (const entry of this.entries.values()) entry.bounds = undefined;
    this.aligned = true;
    this.regions.removeRegion(this.calibrationRegion);
    this.firstSurfaceMs = performance.now() - this.start;
    return true;
  }

  setTravelDestination(position: THREE.Vector3 | null) {
    if (!position) {
      if (this.travelRegion) this.regions.removeRegion(this.travelRegion);
      this.travelRegion = undefined;
      return;
    }
    if (!this.travelRegion) {
      this.travelRegion = new SphereRegion({ sphere: new THREE.Sphere(new THREE.Vector3(), 45), errorTarget: .7 });
      this.regions.addRegion(this.travelRegion);
    }
    this.travelRegion.sphere.center.copy(position).applyMatrix4(this.tiles.group.matrixWorldInverse);
  }

  syncCollisions(position: THREE.Vector3, preservePosition?: THREE.Vector3) {
    if (!this.aligned) return false;
    // Queue nearby tiles first. Geometry is cut in background workers, then
    // installed only if this exact tile entry still belongs to the live scene.
    const active = [...this.tiles.activeTiles]
      .map((tile) => {
        const entry = this.entries.get(tile);
        if (entry && !entry.bounds)
          entry.bounds = new THREE.Box3().setFromObject(entry.scene);
        return {
          tile,
          entry,
          distance: entry?.bounds?.distanceToPoint(position) ?? Infinity,
        };
      })
      .sort((a, b) => a.distance - b.distance);
    for (const { tile, entry } of active)
      if (
        entry &&
        !entry.repaired &&
        !entry.preparing &&
        !entry.preparationFailed
      )
        this.prepareEntry(tile, entry);
    this.repairQueue.pump();
    const wanted = new Set<Entry>();
    for (const { tile, entry } of active) {
      if (!entry || tile.geometricError > 4) continue;
      if (!entry.bounds) {
        entry.scene.updateWorldMatrix(true, true);
        entry.bounds = new THREE.Box3().setFromObject(entry.scene);
      }
      const b = entry.bounds;
      const dx = Math.max(b.min.x - position.x, 0, position.x - b.max.x);
      const dz = Math.max(b.min.z - position.z, 0, position.z - b.max.z);
      if (
        Math.hypot(dx, dz) < 38 &&
        b.max.y > position.y - 20 &&
        b.min.y < position.y + 25
      )
        wanted.add(entry);
    }
    let changed = false;
    const began = performance.now();
    for (const entry of wanted) {
      if (!entry.repaired || entry.colliders) continue;
      const installStart = performance.now();
      entry.colliders = [];
      entry.scene.updateWorldMatrix(true, true);
      entry.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.userData.campusShadowReceiver)
          return;
        const g = o.geometry,
          attr = g.attributes.position;
        if (attr.count < 3) return;
        const vertices = new Float32Array(attr.count * 3),
          v = new THREE.Vector3();
        for (let i = 0; i < attr.count; i++) {
          v.fromBufferAttribute(attr, i).applyMatrix4(o.matrixWorld);
          vertices.set([v.x, v.y, v.z], i * 3);
        }
        const indices = g.index
          ? new Uint32Array(g.index.array)
          : Uint32Array.from({ length: attr.count }, (_, i) => i);
        entry.triangles += indices.length / 3;
        const collider = this.physics.createCollider(
          RAPIER.ColliderDesc.trimesh(
            vertices,
            indices,
            RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
          ).setFriction(0.8),
        );
        entry.colliders!.push(collider);
      });
      this.maxCollisionInstallMs = Math.max(
        this.maxCollisionInstallMs,
        performance.now() - installStart,
      );
      changed = true;
      if (performance.now() - began > 8) break;
    }
    // Install replacements before retiring old LODs, so a streaming transition
    // never deliberately leaves a frame with no ground collider.
    // A fully replaced district can have no remaining scanned triangles within
    // the collision radius. Require prepared source coverage AND matching local
    // authored/physical support, rather than waiting forever for a deleted tile.
    let authoredReady = false;
    if (wanted.size === 0 && this.authoredSurfaces && !this.preparationFailed &&
        active.some(({tile,entry})=>tile.geometricError<=4&&entry?.repaired) &&
        active.every(({entry})=>!entry||entry.repaired)) {
      const cached=this.authoredSupportCache;
      if(cached?.valid&&cached.position.distanceToSquared(position)<.0625){
        authoredReady=cached.valid;
      }else{
       if (!this.collisionReady) this.physics.step();
       this.authoredSurfaces.updateWorldMatrix(true,true);
       authoredReady = [[0,0],[.6,0],[-.6,0],[0,.6],[0,-.6]].every(([dx,dz])=>{
        const origin=new THREE.Vector3(position.x+dx,position.y+2,position.z+dz);
        this.ray.set(origin,new THREE.Vector3(0,-1,0));this.ray.near=0;this.ray.far=6;
        const visible=this.ray.intersectObject(this.authoredSurfaces!,true).find(hit=>
          hit.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y>.5);
        const physical=this.physics.castRay(new RAPIER.Ray(origin,{x:0,y:-1,z:0}),6,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
        return !!visible&&!!physical&&Math.abs(visible.point.y-(origin.y-physical.timeOfImpact))<.05;
       });
       // Authored meshes/colliders are static for this scene lifetime. Avoid
       // repeating five full mesh raycasts every stationary render frame.
       this.authoredSupportCache={position:position.clone(),valid:authoredReady};
      }
    }
    const complete =
      (wanted.size > 0 || authoredReady) &&
      [...wanted].every((entry) => entry.repaired && entry.colliders);
    if (complete)
      for (const entry of this.entries.values()) {
        // Keep the departure ground installed while a map destination loads.
        // Cancelling travel can then return control without a missing-floor frame.
        const preserve = preservePosition && entry.bounds &&
          entry.bounds.distanceToPoint(preservePosition) < 45;
        if (entry.colliders && !wanted.has(entry) && !preserve) {
          this.removeColliders(entry);
          changed = true;
        }
      }
    this.collisionReady = complete;
    if (changed) {
      this.collisionChanges++;
      this.physics.step();
    }
    return complete;
  }

  private prepareEntry(tile: Tile, entry: Entry) {
    entry.preparing = true;
    entry.scene.updateWorldMatrix(true, true);
    const meshes: THREE.Mesh[] = [];
    entry.scene.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        object.userData.campusShadowReceiver
      )
        return;
      object.geometry.computeBoundingBox();
      const bounds = object.geometry
        .boundingBox!.clone()
        .applyMatrix4(object.matrixWorld);
      if (this.cutVolumes.some((volume) => volume.bounds.intersectsBox(bounds)))
        meshes.push(object);
    });
    if (!meshes.length) {
      entry.repaired = true;
      entry.preparing = false;
      return;
    }
    void Promise.allSettled(
      meshes.map((mesh) =>
        this.repairQueue.enqueue(
          entry,
          mesh.geometry,
          mesh.matrixWorld,
          this.cutVolumes,
        ),
      ),
    ).then((results) => {
      const stale = this.disposed || this.entries.get(tile) !== entry;
      const failed = results.some((result) => result.status === 'rejected');
      if (stale || failed) {
        for (const result of results)
          if (result.status === 'fulfilled') result.value?.dispose();
        if (!stale && failed) {
          entry.preparationFailed = true;
          this.preparationFailed = true;
        }
        entry.preparing = false;
        return;
      }
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status !== 'fulfilled' || !result.value) continue;
        meshes[i].geometry = result.value;
        this.repairGeometry.add(result.value);
        this.repairs.meshes++;
      }
      entry.bounds = undefined;
      entry.repaired = true;
      entry.preparing = false;
    });
  }

  private removeColliders(entry?: Entry) {
    if (!entry?.colliders) return;
    for (const collider of entry.colliders) {
      this.physics.removeCollider(collider, true);
    }
    entry.colliders = undefined;
    entry.triangles = 0;
  }

  shadowMeshes(position: THREE.Vector3) {
    const meshes: THREE.Mesh[] = [];
    for (const tile of this.tiles.visibleTiles) {
      if (tile.geometricError > 4) continue;
      const entry = this.entries.get(tile);
      if (!entry) continue;
      if (!entry.bounds) {
        entry.scene.updateWorldMatrix(true, true);
        entry.bounds = new THREE.Box3().setFromObject(entry.scene);
      }
      const b = entry.bounds;
      const dx = Math.max(b.min.x - position.x, 0, position.x - b.max.x);
      const dz = Math.max(b.min.z - position.z, 0, position.z - b.max.z);
      if (
        Math.hypot(dx, dz) > 5 ||
        b.max.y < position.y - 7 ||
        b.min.y > position.y + 3
      )
        continue;
      entry.scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          !object.userData.campusShadowReceiver
        )
          meshes.push(object);
      });
    }
    return meshes;
  }

  credits() {
    return this.tiles
      .getAttributions()
      .filter((a) => a.type === 'string')
      .map((a) => String(a.value))
      .filter(Boolean)
      .join(' · ');
  }
  snapshot() {
    const cache = this.tiles.lruCache as typeof this.tiles.lruCache & {
      cachedBytes: number;
    };
    return {
      provider: 'Google Photorealistic 3D Tiles via Cesium ion',
      loaded: this.loaded,
      visible: this.tiles.visibleTiles.size,
      active: this.tiles.activeTiles.size,
      errors: this.errors,
      loadErrorsByKind: this.loadErrorsByKind,
      downloadRecovery: this.downloads.snapshot(),
      progress: this.tiles.loadProgress,
      cacheMiB: Math.round(cache.cachedBytes / 1048576),
      cacheFull: cache.isFull(),
      aligned: this.aligned,
      alignmentOffset: this.alignmentOffset,
      firstSurfaceMs: this.firstSurfaceMs,
      calibrationProbe: this.calibrationProbe,
      collisionReady: this.collisionReady,
      collisionChanges: this.collisionChanges,
      maxCollisionInstallMs: this.maxCollisionInstallMs,
      preparationFailed: this.preparationFailed,
      colliders: [...this.entries.values()].reduce(
        (n, e) => n + (e.colliders?.length ?? 0),
        0,
      ),
      collisionTriangles: [...this.entries.values()].reduce(
        (n, e) => n + e.triangles,
        0,
      ),
      walkwayRepair: {
        enabled: this.cutVolumes.length > 0,
        volumes: this.cutVolumes.length,
        geometryMiB:
          Math.round(
            ([...this.repairGeometry].reduce(
              (bytes, g) =>
                bytes +
                Object.values(g.attributes).reduce(
                  (n, attribute) => n + attribute.array.byteLength,
                  0,
                ),
              0,
            ) /
              1048576) *
              10,
          ) / 10,
        ...this.repairs,
        execution: 'background workers',
        preparation: this.repairQueue.snapshot(),
      },
      credits: this.credits(),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.downloads.dispose();
    this.rateLimitedTiles.clear();
    this.repairQueue.dispose();
    this.tiles.group.removeFromParent();
    this.tiles.dispose();
    for (const entry of this.entries.values()) this.removeColliders(entry);
    this.entries.clear();
    for (const mat of this.materials) mat.dispose();
    this.materials.clear();
    for (const geometry of this.repairGeometry) geometry.dispose();
    this.repairGeometry.clear();
    this.draco.dispose();
  }
}
