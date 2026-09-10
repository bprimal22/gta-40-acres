import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import { annotateGdcGlazing, createGdcGlazing } from './gdc-glazing';
import { createGdcMasonry, type GdcMasonryTextures } from './gdc-masonry';

/** The City survey follows the broad roof; UT feature402 resolves the stepped
 * ground walls and the wider15.55m courtyard. Both use campus east/up/south metres.
 */
export const gdcRoofEnds = [
  {name:'north wing',a:[24.79,-49.90],b:[22.56,-24.75]},
  {name:'south wing',a:[21.44,-13.55],b:[19.21,11.68]},
] as const;
export const gdcWingOutlines = [
  {name:'north wing',points:[[29.805,-46.627],[29.336,-41.263],[27.718,-41.404],[26.888,-31.890],[28.506,-31.749],[28.038,-26.385]]},
  {name:'south wing',points:[[26.685,-10.893],[26.217,-5.528],[24.599,-5.670],[23.768,3.844],[25.386,3.987],[24.918,9.350]]},
] as const;
export const gdcWestFaces=gdcWingOutlines.flatMap(wing=>wing.points.slice(0,-1).map((a,i)=>({
  name:wing.name+' west '+i,a,b:wing.points[i+1],bays:[2,1,3,1,2][i],
})));
const courtyardOrigin=new THREE.Vector2(21.8,-19.1),east=new THREE.Vector2(.996164,.087504).normalize();
const atDepth=(point:readonly number[],depth:number)=>{
  const p=new THREE.Vector2(point[0],point[1]);return p.addScaledVector(east,depth-p.clone().sub(courtyardOrigin).dot(east)).toArray();
};

export type GdcFacadeOptions = {
  /** Borrowed surface textures; the caller owns their lifetime. */
  masonryTextures?: GdcMasonryTextures;
  /** Building datum, not player-center Y. Requires source-side confirmation. */
  baseElevation?: number;
  /** Six exterior storeys by default, registered to the measured west roof. */
  floors?: number;
  floorHeight?: number;
  /** Positive moves the authored wall toward Speedway, normal to each face. */
  outwardOffset?: number;
  /** Model corner returns where the warped scan is replaced. Zero is a fixture. */
  returnDepth?: number;
  /** Extend the two inner walls beside the stepped atrium, measured from the sculpture center. */
  courtyardDepth?:number;
  /** Add the photographed open grid on both sides of each projecting screen. */
  screenReturns?: boolean;
  /** Opt in to the surveyed south exterior wall; u is measured from the
   * courtyard origin, not from its west corner. UT402 ends at u59.6034. */
  southExteriorDepth?: number;
  /** Keep source grade below this datum; this is a facade-only clearance. */
  southExteriorCutMinY?: number;
  /** Optional eastern datum for a sloping clearance floor above surveyed grade. */
  southExteriorCutEndY?: number;
  /** Missing long north exterior, along the same building depth axis. The
   * official northeast corner is u90.435411; this is not the courtyard. */
  northExteriorDepth?: number;
  /** Keep source yard/connector floor below this bounded facade cut. */
  northExteriorCutMinY?: number;
  northExteriorCutEndY?: number;
};

/** Photo-guided west facades. A positive returnDepth explicitly enables a bounded
 * replacement of the two west wing ends, registered to loaded source probes.
 * Caller owns returned geometries/materials. Collider geometries are shared
 * references to visual geometry; dispose each geometry once (or call dispose).
 */
export function buildGdcFacades(options: GdcFacadeOptions = {}) {
  // Iteration-29 low-origin source hits beside the wall range 2.23–2.69 m.
  // Speedway itself is higher: do not reuse its ~3.55 m walking elevation here.
  const base = options.baseElevation ?? 2.45;
  const floors = options.floors ?? 6;
  const pitchY = options.floorHeight ?? 4.45;
  const outwardOffset = options.outwardOffset ?? 0;
  const returnDepth=options.returnDepth??0,courtyardDepth=options.courtyardDepth??0;
  const southExteriorDepth=options.southExteriorDepth??0;
  const northExteriorDepth=options.northExteriorDepth??0;
  const northExteriorCutMinY=options.northExteriorCutMinY??6.5;
  const northExteriorCutEndY=options.northExteriorCutEndY??northExteriorCutMinY;
  if(!Number.isFinite(northExteriorDepth)||northExteriorDepth<0||northExteriorDepth>90.43542||
      (northExteriorDepth>0&&(returnDepth<=0||northExteriorDepth<=returnDepth||base<=1.6||
      ![northExteriorCutMinY,northExteriorCutEndY].every(Number.isFinite)||
      Math.min(northExteriorCutMinY,northExteriorCutEndY)<1.6||Math.max(northExteriorCutMinY,northExteriorCutEndY)>base+8)))
    throw new Error('GDC north exterior dimensions are invalid');
  const southExteriorCutMinY=options.southExteriorCutMinY??3.15;
  const southExteriorCutEndY=options.southExteriorCutEndY??southExteriorCutMinY;
  if (!Number.isFinite(southExteriorDepth)||southExteriorDepth<0||southExteriorDepth>59.6034||
      (southExteriorDepth>0&&(returnDepth<=0||southExteriorDepth<=returnDepth||base<=1.6||
      ![southExteriorCutMinY,southExteriorCutEndY].every(Number.isFinite)||
      Math.min(southExteriorCutMinY,southExteriorCutEndY)<1.6||Math.max(southExteriorCutMinY,southExteriorCutEndY)>base+4)))
    throw new Error('GDC south exterior dimensions are invalid');
  if (!Number.isInteger(floors) || floors < 1 || floors > 6)
    throw new Error('GDC facade floors must be an integer from 1 to 6');
  if (![base, pitchY, outwardOffset,returnDepth,courtyardDepth].every(Number.isFinite) || pitchY < 3.7 || pitchY > 5 || returnDepth<0 || returnDepth>16 || courtyardDepth<0 || courtyardDepth>36)
    throw new Error('GDC facade dimensions are invalid');

  const materials = {
    brick: createGdcMasonry('brick',options.masonryTextures),
    stone: createGdcMasonry('stone',options.masonryTextures),
    frame: new THREE.MeshStandardMaterial({color: 0x8b938e, metalness: .72, roughness: .30}),
    louver: new THREE.MeshStandardMaterial({color: 0x805339, metalness: .30, roughness: .57}),
    glass: createGdcGlazing('GDC shaded recessed glazing with sky reflection'),
    westGlass: createGdcGlazing('GDC Speedway local reflection glazing'),
    brickRelief: createGdcMasonry('brick',options.masonryTextures),
    recess: new THREE.MeshStandardMaterial({color: 0x353c3b, roughness: .93}),
  };
  materials.frame.name = 'GDC anodized glazing frames';
  materials.louver.name = 'GDC rusty-brown projecting louver grid';
  materials.brickRelief.name = 'GDC decorative brick spandrel ribs';
  materials.recess.name = 'GDC shaded reveals';
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const records: { name: string; length: number; bayPitch: number; base: number; top: number;
    a:number[];b:number[];west:boolean;outward: number[]; bounds: THREE.Box3 }[] = [];
  let windows = 0, louverBars = 0, screenReturnBars = 0;

  const faces: {name:string;a:readonly number[];b:readonly number[];bays:number;west:boolean}[]=
    gdcWestFaces.map(f=>({...f,west:true}));
  if(returnDepth>0)for(const wing of gdcWingOutlines){
    const a=wing.points[0],b=wing.points.at(-1)!;
    const northInner=wing.name==='south wing',southInner=wing.name==='north wing';
    const na=atDepth(a,northInner&&courtyardDepth?courtyardDepth:wing.name==='north wing'&&northExteriorDepth?northExteriorDepth:returnDepth);
    const sb=atDepth(b,southInner&&courtyardDepth?courtyardDepth:wing.name==='south wing'&&southExteriorDepth?southExteriorDepth:returnDepth);
    for(const f of [{name:wing.name+' north return',a:na,b:a},{name:wing.name+' south return',a:b,b:sb}]){
      const length=Math.hypot(f.b[0]-f.a[0],f.b[1]-f.a[1]);
      faces.push({...f,bays:Math.max(1,Math.round(length/3.7)),west:false});
    }
  }
  for (const face of faces) {
    const longNorth = northExteriorDepth > 0 && face.name === 'north wing north return';
    const a = new THREE.Vector3(face.a[0], 0, face.a[1]);
    const b = new THREE.Vector3(face.b[0], 0, face.b[1]);
    const u = b.clone().sub(a).normalize();
    const outward = new THREE.Vector3(-u.z, 0, u.x);
    // u cross up = outward, giving a right-handed basis and correct winding.
    const matrix = new THREE.Matrix4().makeBasis(u, new THREE.Vector3(0, 1, 0), outward);
    matrix.setPosition(a.clone().addScaledVector(outward, outwardOffset));
    const length = a.distanceTo(b), endInset = .12;
    const usable = length - endInset * 2, pitch = usable / face.bays;
    // Photo-guided asymmetric window fields, including narrower corner fields.
    // These are proportions, not a claim of surveyed structural bay widths.
    const widths=Array<number>(face.bays).fill(pitch);
    const edges=widths.reduce((out,w)=>[...out,out.at(-1)!+w],[endInset]);
    const faceBounds = new THREE.Box3();
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      // Only Speedway-facing glass uses the corridor reflection capture.
      // Distant south/courtyard returns keep the existing sky environment.
      if(material===materials.glass&&face.west)material=materials.westGlass;
      geometry.computeBoundingBox();
      const localBounds = geometry.boundingBox!;
      if (material === materials.glass || material === materials.westGlass)
        annotateGdcGlazing(geometry, 'x', u, outward, faces.indexOf(face) * 31.7 + localBounds.getCenter(new THREE.Vector3()).x * 3.3 + localBounds.min.y * 5.1);
      if (material === materials.brick || material === materials.brickRelief || material === materials.stone) {
        const bond = material === materials.brickRelief || localBounds.max.x - localBounds.min.x < .15 ? 1 : 0;
        geometry.setAttribute('gdcBond', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(bond), 1));
      }
      const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
      // UVs are metres, so joints retain scale on every frame/reveal/beam.
      for (let i = 0; i < p.count; i++) {
        const side = Math.abs(n.getX(i)) > .7, top = Math.abs(n.getY(i)) > .7;
        uv.setXY(i, side ? p.getZ(i) : p.getX(i), top ? p.getZ(i) : p.getY(i));
      }
      geometry.applyMatrix4(matrix);
      geometry.computeBoundingBox();
      faceBounds.union(geometry.boundingBox!);
      if (!batches.has(material)) batches.set(material, []);
      batches.get(material)!.push(geometry);
    };
    const box = (x: number, y: number, z: number, w: number, h: number, d: number,
      material: THREE.Material, tilt = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (tilt) g.rotateX(tilt);
      g.translate(x, y, z); add(g, material);
    };
    const stoneBlock = (x: number, y: number, z: number, w: number, h: number, d: number) => {
      // Secondary long elevation keeps physical depth without hundreds of
      // tiny bevel faces. Existing close west/courtyard/south detail is unchanged.
      if (longNorth) { box(x, y, z, w, h, d, materials.stone); return; }
      // A small real chamfer catches light at the main architectural edges.
      const bevel = .012, shape = new THREE.Shape();
      shape.moveTo(-w / 2 + bevel, -h / 2 + bevel);
      shape.lineTo(w / 2 - bevel, -h / 2 + bevel);
      shape.lineTo(w / 2 - bevel, h / 2 - bevel);
      shape.lineTo(-w / 2 + bevel, h / 2 - bevel); shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: d - 2 * bevel, bevelEnabled: true, bevelThickness: bevel,
        bevelSize: bevel, bevelSegments: 1, steps: 1, curveSegments: 1,
      });
      g.translate(x, y, z - d / 2 + bevel); add(g, materials.stone);
    };

    // Fully recessed opaque glazing avoids invented interiors and keeps cost
    // modest. The surroundings are reflected by the scene environment map.
    for (let f = 0; f < floors; f++) {
      const low = base + f * pitchY;
      const sill = f === 0 ? .68 : 1.15;
      const glassLow = low + sill, glassHigh = low + pitchY - .16;
      const glassHeight = glassHigh - glassLow;
      const middle = (glassLow + glassHigh) / 2;
      const pierWidth = f === 0 ? .55 : .95;

      // A masonry spandrel between each window row; thin pale bands stay proud.
      box(length / 2, low + sill / 2, -.13, usable, sill, .50,
        f === 0 ? materials.stone : materials.brick);
      stoneBlock(length / 2, low + sill - .035, .08, usable, .11, .38);
      // Continuous head beam closes the 0.22 m space above the glazing and
      // carries the next row's brick spandrel; no open slot between floors.
      stoneBlock(length / 2, low + pitchY - .07, .04, usable, .18, .46);
      for (let j = 0; j <= face.bays; j++) {
        const x = edges[j];
        const edge = j === 0 || j === face.bays;
        const width = edge ? pierWidth / 2 : pierWidth;
        const center = x + (j === 0 ? width / 2 : j === face.bays ? -width / 2 : 0);
        box(center, middle, -.075, width, glassHeight, .60,
          f === 0 ? materials.stone : materials.brick);
        // Thin pale reveals and a recessed flute articulate the upper brick piers.
        if (!edge && f > 0) {
          box(center, middle, .247, .065, glassHeight, .028, materials.recess);
          for (const side of [-1, 1])
            box(center + side * (width / 2 - .025), middle, .247, .038, glassHeight, .030, materials.brick);
          for(const shift of [-.18,.18]) {
            box(center+shift,middle,.265,.085,glassHeight,.065,materials.brick);
            // Continue the ribs through the broad brick band, matching the
            // vertical articulation in the courtyard photographs. Decorative
            // relief is kept outside the existing collision surface batch.
            box(center+shift,low+sill/2,.205,.085,Math.max(.1,sill-.14),.065,materials.brickRelief);
          }
        }
      }

      for (let j = 0; j < face.bays; j++) {
        const x = (edges[j]+edges[j+1])/2, width = widths[j] - pierWidth;
        // Glass is 0.29 m behind the outer masonry face, with actual jambs.
        box(x, middle, -.32, width, glassHeight, .055, materials.glass);
        for (const side of [-1, 1]) {
          box(x + side * (width / 2 - .035), middle, -.08, .07, glassHeight, .47, materials.frame);
          stoneBlock(x + side * (width / 2 + .035), middle, .005, .075, glassHeight, .43);
        }
        for (const y of [glassLow + .035, glassHigh - .035])
          box(x, y, -.08, width, .07, .47, materials.frame);
        box(x, middle, -.265, .046, glassHeight, .075, materials.frame);
        // Slightly inset horizontal transom makes a lower glazing panel.
        box(x, glassLow + .46, -.265, width, .035, .065, materials.frame);

        windows++;
        // Six-storey source photos show an open, unscreened top window row.
        if(f===floors-1&&floors===6)continue;
        const screenHeight = f === 0 ? 1.35 : 1.06;
        const screenLow = glassHigh - screenHeight, screenY = (screenLow + glassHigh) / 2;
        const screenWidth = width + .12, screenDepth = .43;
        // Stand-offs leave visible air between the glass and the exterior grid.
        for (const side of [-1, 1]) {
          const sx = x + side * screenWidth / 2;
          box(sx, screenY, .30, .042, screenHeight, .055, materials.louver);
          for (const y of [screenLow, glassHigh])
            box(sx, y, .085, .04, .045, screenDepth, materials.louver);
        }
        for (const y of [screenLow, glassHigh])
          box(x, y, .32, screenWidth + .04, .045, .055, materials.louver);
        const horizontal = Math.round(screenHeight / .145);
        for (let k = 1; k < horizontal; k++) {
          box(x, screenLow + k * screenHeight / horizontal, .305,
            screenWidth, .025, .105, materials.louver, .22);
          louverBars++;
        }
        if (options.screenReturns && !longNorth) {
          // These are U-shaped screen boxes in the courtyard reference, not
          // isolated front lattices. The side grilles keep the same0.43m
          // projection and remain in the existing decorative louver batch.
          for (const side of [-1,1]) {
            const sx=x+side*screenWidth/2;
            for (let k=1;k<horizontal;k++) {
              box(sx,screenLow+k*screenHeight/horizontal,.085,
                .025,.025,screenDepth,materials.louver); screenReturnBars++;
            }
            for(const depth of[-.055,.09,.235]) {
              box(sx,screenY,depth,.027,screenHeight,.026,materials.louver); screenReturnBars++;
            }
          }
        }
        const vertical = Math.round(screenWidth / .17);
        for (let k = 1; k < vertical; k++) {
          box(x - screenWidth / 2 + k * screenWidth / vertical, screenY, .326,
            .024, screenHeight, .070, materials.louver);
          louverBars++;
        }
      }
    }
    if((southExteriorDepth>0&&face.name==='south wing south return')||(northExteriorDepth>0&&face.name==='north wing north return')){
      // Extend only the solid wall base. The north exterior yard is not
      // replaced; its independent upper-only cut preserves unknown low ground.
      box(length/2,(1.60+base)/2,-.13,usable,base-1.60,.50,materials.stone);
    }
    records.push({name: face.name, a:[...face.a],b:[...face.b],west:face.west,length, bayPitch: pitch, base,
      top: base + floors * pitchY + .08, outward: outward.toArray(), bounds: faceBounds});
  }

  const roofBox=(a:readonly number[],b:readonly number[],depth:number,width:number)=>{
    const A=new THREE.Vector3(a[0],0,a[1]),B=new THREE.Vector3(b[0],0,b[1]),u=B.clone().sub(A).normalize(),out=new THREE.Vector3(-u.z,0,u.x);
    const geometry=new THREE.BoxGeometry(A.distanceTo(B),.24,width);
    geometry.translate(A.distanceTo(B)/2,base+floors*pitchY+.16,-depth);
    const pos=geometry.attributes.position,uv=geometry.attributes.uv;
    for(let i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i),pos.getZ(i));
    const matrix=new THREE.Matrix4().makeBasis(u,new THREE.Vector3(0,1,0),out);matrix.setPosition(A);geometry.applyMatrix4(matrix);
    geometry.setAttribute('gdcBond',new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count),1));
    if(!batches.has(materials.stone))batches.set(materials.stone,[]);batches.get(materials.stone)!.push(geometry);
  };
  if(returnDepth>0)for(const face of gdcRoofEnds)roofBox(face.a,face.b,returnDepth/2,returnDepth+.3);
  if(courtyardDepth>returnDepth)for(const wing of gdcWingOutlines){
    const point=wing.name==='north wing'?wing.points.at(-1)!:wing.points[0];
    const a=atDepth(point,returnDepth-.4),b=atDepth(point,courtyardDepth-.2);
    // Restore the narrow roof strip removed with the inner facade below.
    roofBox(a,b,wing.name==='north wing'?1.0:-1.0,2.7);
  }

  if(southExteriorDepth>returnDepth){
    const point=gdcWingOutlines[1].points.at(-1)!;
    // Restore only the eave band paired with the new facade cut. The original
    // rooftop/parapet remains beyond this 2.4m strip and above its 29.43 m top.
    const a=atDepth(point,returnDepth-.4),b=atDepth(point,southExteriorDepth-.1);
    roofBox(a,b,.12,2.4);
  }

  if(northExteriorDepth>returnDepth){
    const point=gdcWingOutlines[0].points[0];
    // Reverse the segment so its outward normal points north. This restores
    // only the cut's eave band; the inner roof and low connector stay separate.
    const a=atDepth(point,northExteriorDepth-.1),b=atDepth(point,returnDepth-.4);
    roofBox(a,b,.12,2.4);
  }

  const meshes: THREE.Mesh[] = [];
  for (const [material, parts] of batches) {
    const normalized = parts.map(p => p.index ? p.toNonIndexed() : p);
    const geometry = mergeGeometries(normalized);
    if (!geometry) throw new Error('GDC facade geometry could not be merged');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name || 'GDC west facade';
    mesh.castShadow = true; mesh.receiveShadow = true;
    meshes.push(mesh);
    for (const p of new Set([...parts, ...normalized])) p.dispose();
  }
  const bounds = new THREE.Box3();
  for (const mesh of meshes) bounds.union(mesh.geometry.boundingBox!);
  // Iteration31 measured the distorted lower face several metres behind the
  // footprint, including an edge outlier around10.6m. The integrated12m
  // replacement also supplies corner returns, floor and roof to close the skin.
  const volumes: CutVolume[] = [];
  if(returnDepth>0)for(const face of gdcRoofEnds){
    const a=new THREE.Vector3(face.a[0],base,face.a[1]),b=new THREE.Vector3(face.b[0],base,face.b[1]);
    const u=b.clone().sub(a).normalize(),outward=new THREE.Vector3(-u.z,0,u.x);
    const center=a.clone().lerp(b,.5).addScaledVector(outward,-returnDepth/2+.325);
    const halfU=a.distanceTo(b)/2+.65,halfD=returnDepth/2+.325;
    const minY=base-.35,maxY=base+floors*pitchY+1.2;
    const planes=[
      new THREE.Plane().setFromNormalAndCoplanarPoint(u,center.clone().addScaledVector(u,halfU)),
      new THREE.Plane().setFromNormalAndCoplanarPoint(u.clone().negate(),center.clone().addScaledVector(u,-halfU)),
      new THREE.Plane().setFromNormalAndCoplanarPoint(outward,center.clone().addScaledVector(outward,halfD)),
      new THREE.Plane().setFromNormalAndCoplanarPoint(outward.clone().negate(),center.clone().addScaledVector(outward,-halfD)),
      new THREE.Plane(new THREE.Vector3(0,-1,0),minY),new THREE.Plane(new THREE.Vector3(0,1,0),-maxY)];
    const corners=[];for(const su of [-1,1])for(const sd of [-1,1])for(const y of [minY,maxY])corners.push(center.clone().addScaledVector(u,su*halfU).addScaledVector(outward,sd*halfD).setY(y));
    volumes.push({planes,bounds:new THREE.Box3().setFromPoints(corners)});
  }
  if(courtyardDepth>returnDepth)for(const wing of gdcWingOutlines){
    const point=wing.name==='north wing'?wing.points.at(-1)!:wing.points[0];
    // Stop before the rendered wall's .12 m endpoint inset. Extending the cut
    // past that wall removes source without replacing it above the atrium roof.
    const a=atDepth(point,returnDepth-.5),b=atDepth(point,courtyardDepth-.2),A=new THREE.Vector3(a[0],0,a[1]),B=new THREE.Vector3(b[0],0,b[1]);
    const u=B.clone().sub(A).normalize(),n=new THREE.Vector3(-u.z,0,u.x),center=A.clone().lerp(B,.5),half=A.distanceTo(B)/2;
    // The roof extends into the wing farther than the thin facade. Remove the
    // old roof throughout that same width so it cannot show through the slab.
    const minN=wing.name==='north wing'?-2.35:-1.2,maxN=wing.name==='north wing'?1.2:2.35;
    const planes=[new THREE.Plane().setFromNormalAndCoplanarPoint(u,B),new THREE.Plane().setFromNormalAndCoplanarPoint(u.clone().negate(),A),
      new THREE.Plane().setFromNormalAndCoplanarPoint(n,center.clone().addScaledVector(n,maxN)),new THREE.Plane().setFromNormalAndCoplanarPoint(n.clone().negate(),center.clone().addScaledVector(n,minN)),
      new THREE.Plane(new THREE.Vector3(0,-1,0),base-.35),new THREE.Plane(new THREE.Vector3(0,1,0),-(base+floors*pitchY+1.2))];
    const corners=[];for(const t of [-half,half])for(const d of [minN,maxN])for(const y of [base-.35,base+floors*pitchY+1.2])corners.push(center.clone().addScaledVector(u,t).addScaledVector(n,d).setY(y));
    volumes.push({planes,bounds:new THREE.Box3().setFromPoints(corners)});
  }
  if(southExteriorDepth>returnDepth){
    const point=gdcWingOutlines[1].points.at(-1)!;
    const a=atDepth(point,returnDepth-.45),b=atDepth(point,southExteriorDepth-.2);
    const A=new THREE.Vector3(a[0],0,a[1]),B=new THREE.Vector3(b[0],0,b[1]);
    const u=B.clone().sub(A).normalize(),n=new THREE.Vector3(-u.z,0,u.x);
    // Iteration 54's witnessed distorted face is 0.36 m outside the official wall.
    // Bounds stay inside the matching roof strip, with a 0.02/0.03m inset.
    // The low cut boundary deliberately preserves the streamed yard/grade.
    const minN=-1.30,maxN=1.05,minY=Math.min(southExteriorCutMinY,southExteriorCutEndY),maxY=base+floors*pitchY+.28;
    const gradient=(southExteriorCutEndY-southExteriorCutMinY)/A.distanceTo(B);
    const lowerPlane=new THREE.Plane(new THREE.Vector3(gradient*u.x,-1,gradient*u.z),southExteriorCutMinY-gradient*A.dot(u)).normalize();
    const planes=[new THREE.Plane().setFromNormalAndCoplanarPoint(u,B),
      new THREE.Plane().setFromNormalAndCoplanarPoint(u.clone().negate(),A),
      new THREE.Plane().setFromNormalAndCoplanarPoint(n,A.clone().addScaledVector(n,maxN)),
      new THREE.Plane().setFromNormalAndCoplanarPoint(n.clone().negate(),A.clone().addScaledVector(n,minN)),
      lowerPlane,new THREE.Plane(new THREE.Vector3(0,1,0),-maxY)];
    const corners=[];for(const p of[A,B])for(const d of[minN,maxN])for(const y of[minY,maxY])
      corners.push(p.clone().addScaledVector(n,d).setY(y));
    volumes.push({planes,bounds:new THREE.Box3().setFromPoints(corners)});
  }
  if(northExteriorDepth>returnDepth){
    const point=gdcWingOutlines[0].points[0];
    const a=atDepth(point,northExteriorDepth-.2),b=atDepth(point,returnDepth-.45);
    const A=new THREE.Vector3(a[0],0,a[1]),B=new THREE.Vector3(b[0],0,b[1]);
    const u=B.clone().sub(A).normalize(),n=new THREE.Vector3(-u.z,0,u.x);
    const minN=-1.30,maxN=1.05,minY=Math.min(northExteriorCutMinY,northExteriorCutEndY),maxY=base+floors*pitchY+.28;
    // A is the east endpoint; keep the optional grade datum oriented west→east.
    const gradient=(northExteriorCutMinY-northExteriorCutEndY)/A.distanceTo(B);
    const lowerPlane=new THREE.Plane(new THREE.Vector3(gradient*u.x,-1,gradient*u.z),northExteriorCutEndY-gradient*A.dot(u)).normalize();
    const planes=[new THREE.Plane().setFromNormalAndCoplanarPoint(u,B),
      new THREE.Plane().setFromNormalAndCoplanarPoint(u.clone().negate(),A),
      new THREE.Plane().setFromNormalAndCoplanarPoint(n,A.clone().addScaledVector(n,maxN)),
      new THREE.Plane().setFromNormalAndCoplanarPoint(n.clone().negate(),A.clone().addScaledVector(n,minN)),
      lowerPlane,new THREE.Plane(new THREE.Vector3(0,1,0),-maxY)];
    const corners=[];for(const p of[A,B])for(const d of[minN,maxN])for(const y of[minY,maxY])
      corners.push(p.clone().addScaledVector(n,d).setY(y));
    volumes.push({planes,bounds:new THREE.Box3().setFromPoints(corners)});
  }
  const colliderGeometries = meshes
    .filter(m => m.material !== materials.louver && m.material !== materials.brickRelief)
    .map(m => m.geometry);
  const stats = {faces: records.length, floors, windows, louverBars,screenReturnBars,
    triangles: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0),
    drawCalls: meshes.length, cutVolumes: volumes.length,southExteriorDepth,northExteriorDepth};
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const mesh of meshes) mesh.geometry.dispose();
    for (const material of Object.values(materials)) material.dispose();
  };
  return {meshes, materials, colliderGeometries, volumes, bounds, records, stats, dispose};
}
