import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';

// Registered against the retained scan. Decorative proportions come from the
// State Preservation Board's north-facade photograph, not architectural CAD.
export const CAPITOL_DOME_CENTER = [-308, 1266.5] as const;
export const CAPITOL_DOME_CUT_FLOOR = 37;

/** Replace only the blurred upper rotunda. Main facades, roofs, pediment,
 * grounds and their collisions stay with the source scenery. All returned
 * geometry is in world metres, and the same meshes supply visible/physical
 * flight obstacles. Geometry is merged by material to keep draw calls bounded.
 */
export function buildCapitolDome() {
  const materials: T.MeshStandardMaterial[] = [];
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  const mat = (name: string, color: number, roughness = .84, metalness = 0) => {
    const m = new T.MeshStandardMaterial({ color, roughness, metalness });
    m.name = `Capitol ${name}`; materials.push(m); return m;
  };
  // Lower albedo compensates for the scene's bright Texas sunlight; matching
  // photographed sRGB colors directly would wash the authored stone white.
  const stone = mat('pink granite', 0x8c6f63);
  const trim = mat('carved pale granite', 0x9f8371);
  const dome = mat('stone colored painted metal', 0x917765, .78, .04);
  const glass = mat('recessed dark windows', 0x292b29, .38, .16);
  const bronze = mat('weathered window frames', 0x6e6a59, .6, .35);
  const shadow = mat('deep rotunda recesses', 0x776e63, .93);
  for (const m of [stone, trim, dome]) {
    m.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vCapitolMetres;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvCapitolMetres=position;');
      shader.fragmentShader = `varying vec3 vCapitolMetres;
float capHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float capNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(mix(capHash(i),capHash(i+vec3(1,0,0)),f.x),mix(capHash(i+vec3(0,1,0)),capHash(i+vec3(1,1,0)),f.x),f.y),
mix(mix(capHash(i+vec3(0,0,1)),capHash(i+vec3(1,0,1)),f.x),mix(capHash(i+vec3(0,1,1)),capHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        `#include <color_fragment>
float capPixel=max(length(fwidth(vCapitolMetres)),.0001);
float capGrain=(capNoise(vCapitolMetres*95.)-.5)*(1.-smoothstep(.008,.04,capPixel));
float capWeather=capNoise(vCapitolMetres*.65)-.5;
diffuseColor.rgb*=1.+capGrain*.1+capWeather*.055;`);
    };
    m.customProgramCacheKey = () => 'capitol-mineral-85-v1';
  }
  const origin = new T.Vector3(CAPITOL_DOME_CENTER[0], 0, CAPITOL_DOME_CENTER[1]);
  const put = (g: T.BufferGeometry, m: T.Material, matrix?: T.Matrix4) => {
    if (matrix) g.applyMatrix4(matrix);
    g.translate(origin.x, 0, origin.z);
    if (!batches.has(m)) batches.set(m, []);
    batches.get(m)!.push(g);
  };
  const lathe = (profile: number[][], m: T.Material, segments = 96) =>
    put(new T.LatheGeometry(profile.map(([r,y]) => new T.Vector2(r,y)), segments), m);
  const ring = (y: number, radius: number, height: number, m = trim) =>
    lathe([[radius-.35,y-height/2],[radius,y-height/2],[radius,y+height/2],[radius-.35,y+height/2]],m);
  const radial = (angle: number, radius: number, y = 0) => new T.Matrix4().makeRotationY(angle)
    .setPosition(Math.sin(angle)*radius, y, Math.cos(angle)*radius);
  const box = (w: number,h: number,d: number,m: T.Material,angle: number,r: number,y: number) =>
    put(new T.BoxGeometry(w,h,d),m,radial(angle,r,y));
  const arch = (w: number,h: number) => {
    const s=new T.Shape(),r=w/2,spring=h/2-r;
    s.moveTo(-r,-h/2);s.lineTo(r,-h/2);s.lineTo(r,spring);
    s.absarc(0,spring,r,0,Math.PI,false);s.lineTo(-r,-h/2);return s;
  };
  const window = (angle:number,r:number,y:number,w:number,h:number,pitch=0) => {
    const placement=radial(angle,r,y).multiply(new T.Matrix4().makeRotationX(pitch));
    put(new T.ShapeGeometry(arch(w+.3,h+.28),20),trim,placement);
    put(new T.ShapeGeometry(arch(w,h),20).translate(0,0,.018),glass,placement);
    put(new T.BoxGeometry(.045,h-.12,.07).translate(0,-.02,.065),bronze,placement);
    for(const level of[-h*.25,0,h*.23])put(new T.BoxGeometry(w,.045,.07).translate(0,level,.065),bronze,placement);
    put(new T.BoxGeometry(w+.4,.22,.36).translate(0,-h/2-.12,.12),trim,placement);
  };
  // Solid stepped drum connects to the source roof below the cut plane.
  lathe([[0,34],[13.7,34],[13.7,36.8],[14.2,37],[14.2,38.3],
    [13.5,38.3],[13.5,39.1],[0,39.1]],stone);
  lathe([[0,39],[12.2,39],[12.2,51.9],[0,51.9]],shadow);
  for(let i=0;i<24;i++) {
    const a=i*Math.PI*2/24;
    // Tapered shafts and stepped bases/capitals create real cast shadows.
    put(new T.CylinderGeometry(.43,.5,11.1,20),stone,radial(a,13.45,45.15));
    for(const [y,r,h] of[[39.3,.75,.32],[39.65,.59,.28],[50.7,.57,.3],[51.05,.76,.35]])
      put(new T.CylinderGeometry(r,r,h,20),trim,radial(a,13.45,y));
    window(a,12.24,45.2,1.55,7.4);
    box(.35,10.8,.3,stone,a,12.3,45.2);
  }
  for(const [y,r,h] of[[38.7,14.4,.4],[51.6,14.7,.45],[52.05,15.2,.45],
    [52.5,14.9,.45],[53.05,14.5,.3]])ring(y,r,h);
  // Upper arched drum: narrower than the lower colonnade in the photos.
  lathe([[0,53],[10.9,53],[10.9,62.5],[0,62.5]],stone);
  for(let i=0;i<24;i++) {
    const a=i*Math.PI*2/24;
    window(a,10.925,57.9,1.25,5.8);
    box(.44,6.8,.4,trim,a+Math.PI/24,11.15,57.7);
    box(.8,.24,.64,trim,a+Math.PI/24,11.2,61.2);
  }
  for(const [y,r,h] of[[53.6,12,.35],[54.2,11.5,.25],[61.65,11.8,.35],
    [62.05,12.1,.4],[62.55,11.8,.35]])ring(y,r,h);
  // Curved shell rather than a polygon cone; narrow raised ribs stay sharp
  // when viewed from the flight camera. These dimensions are photo estimates.
  const profile=[[0,62.8],[10.8,62.8],[10.65,64],[10.2,66],[9.5,68],
    [8.45,70],[7.1,72],[5.2,74],[3.4,75.3],[2.8,76],[0,76]];
  lathe(profile,dome,128);
  const shell=profile.slice(1,-1);
  for(let i=0;i<32;i++){
    const a=i*Math.PI*2/32;
    const curve=new T.CatmullRomCurve3(shell.map(([r,y])=>
      new T.Vector3(Math.sin(a)*(r+.07),y,Math.cos(a)*(r+.07))));
    put(new T.TubeGeometry(curve,36,.045,5,false),trim);
  }
  for(let i=0;i<24;i++)window(i*Math.PI*2/24,10.05,66.8,.8,2.2,-.36);
  ring(63,11.05,.28);ring(76.15,3.1,.35);
  // Lantern with open colonnade against a recessed inner core.
  lathe([[0,76.2],[2.55,76.2],[2.55,77.1],[0,77.1]],trim,64);
  lathe([[0,77],[1.9,77],[1.9,82.4],[0,82.4]],shadow,64);
  for(let i=0;i<8;i++)put(new T.CylinderGeometry(.19,.23,4.7,12),trim,radial(i*Math.PI/4,2.4,79.7));
  ring(82.3,2.85,.4);ring(82.65,3,.3);
  lathe([[0,82.75],[2.7,82.75],[2.55,83.4],[1.8,84.4],[.55,85.1],[0,85.1]],dome,64);
  ring(85.15,.75,.2);
  // Distant Goddess of Liberty silhouette; small features are deliberately
  // approximate rather than claiming a scanned replica of the sculpture.
  lathe([[0,85.2],[.38,85.2],[.27,86.4],[.34,86.65],[.23,87.35],[0,87.35]],trim,16);
  put(new T.SphereGeometry(.19,12,8).translate(0,87.53,0),trim);
  put(new T.CylinderGeometry(.055,.08,1.1,8).rotateZ(-.38).translate(.34,87.1,0),trim);
  put(new T.ConeGeometry(.23,.3,5).translate(.53,87.85,0),trim);
  // Small balusters at both galleries, merged into the same trim batch.
  for(const [y,r] of[[39.7,14.15],[53.2,11.7]]){
    ring(y+.65,r,.13);ring(y,r,.13);
    for(let i=0;i<96;i++)put(new T.CylinderGeometry(.06,.085,.58,8),trim,radial(i*Math.PI/48,r-.1,y+.32));
  }
  const meshes:T.Mesh[]=[];
  for(const [m,parts] of batches){
    const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;
    g.computeBoundingBox();g.computeBoundingSphere();
    const mesh=new T.Mesh(g,m);mesh.name=m.name;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);
    for(const part of new Set([...parts,...flat]))part.dispose();
  }
  const r=16.5,planes:T.Plane[]=[];
  for(let i=0;i<32;i++){
    const n=new T.Vector3(Math.sin(i*Math.PI/16),0,Math.cos(i*Math.PI/16));
    planes.push(new T.Plane(n,-n.dot(origin)-r));
  }
  planes.push(new T.Plane(new T.Vector3(0,-1,0),CAPITOL_DOME_CUT_FLOOR),
    new T.Plane(new T.Vector3(0,1,0),-94));
  const volumes:CutVolume[]=[{planes,bounds:new T.Box3(
    new T.Vector3(origin.x-r,CAPITOL_DOME_CUT_FLOOR,origin.z-r),new T.Vector3(origin.x+r,94,origin.z+r))}];
  return { meshes,materials,volumes,colliderGeometries:meshes.map(m=>m.geometry),
    stats:{scope:'Upper Capitol dome only; retained photographic main building and grounds',
      sourcePhoto:'State Preservation Board north facade, June 2015',approximateDimensions:true,
      center:[...CAPITOL_DOME_CENTER],lowerColumns:24,upperArches:24,ribs:32,
      triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),materialBatches:meshes.length} };
}
