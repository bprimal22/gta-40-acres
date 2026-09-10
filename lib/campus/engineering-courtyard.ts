import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import type { TreePlacement } from './foreground-trees';
import { annotateGdcGlazing, createGdcGlazing } from './gdc-glazing';
import { buildPmaTowerFrontage } from './pma-frontage';
import { buildPmaLocalPodium } from './pma-local-podium';

// Aligned with the mapped walks 129071829 / 573368326, looking east from
// Speedway. s runs toward EER and t across the mall (positive = south).
const origin = new T.Vector3(32.1, 0, -252.35);
const east = new T.Vector3(1, 0, .089).normalize();
const south = new T.Vector3(-east.z, 0, east.x);
const basis = new T.Matrix4().makeBasis(east, new T.Vector3(0, 1, 0), south).setPosition(origin);
export const engineeringCourtPoint = (s: number, t: number, y = 0) =>
  new T.Vector3(s, y, t).applyMatrix4(basis);
export function engineeringCourtLocal(x: number, z: number) {
  const p = new T.Vector3(x - origin.x, 0, z - origin.z);
  return { s: p.dot(east), t: p.dot(south) };
}
export function inEngineeringCourt(x: number, z: number) {
  const { s, t } = engineeringCourtLocal(x, z);
  return s >= -4 && s <= 96 && t >= -11.5 && t <= 12;
}
function cut(s0: number, s1: number, t0: number, t1: number, low: number, high: number): CutVolume {
  const points = [[s0,t0],[s1,t0],[s1,t1],[s0,t1]].map(([s,t]) => engineeringCourtPoint(s,t));
  const center = engineeringCourtPoint((s0+s1)/2,(t0+t1)/2);
  const planes = points.map((p,i) => {
    const q = points[(i+1)%4];
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(q.z-p.z,0,p.x-q.x).normalize(),p);
    if (plane.distanceToPoint(center)>0) plane.negate();
    return plane;
  });
  const bounds = new T.Box3().setFromPoints(points); bounds.min.y=low; bounds.max.y=high;
  planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));
  return {planes,bounds};
}

/** Photo-informed west mall and EER entrance exterior, not a surveyed model.
 * Leaves the independently calibrated southern walk, stairs and GLT bridge
 * intact. Only reconstructed ground/frontage receives source clearance.
 */
export function buildEngineeringCourtyard(
  approachHeight: (x: number, z: number) => number,
  sourceConcrete: T.MeshStandardMaterial,
  sourceGrass: T.MeshStandardMaterial,
  options: {photoFacades?:boolean;localPodium?:boolean} = {},
) {
  const materials: T.MeshStandardMaterial[] = [];
  const material = (name: string, color: number, roughness=.88, metalness=0) => {
    const m = new T.MeshStandardMaterial({color,roughness,metalness});
    m.name=name;materials.push(m);return m;
  };
  const concrete=sourceConcrete.clone();concrete.name='Engineering courtyard concrete';
  // Three does not clone shader callbacks; share the established route finish.
  concrete.onBeforeCompile=(shader,renderer)=>sourceConcrete.onBeforeCompile.call(concrete,shader,renderer);
  concrete.customProgramCacheKey=()=>sourceConcrete.customProgramCacheKey();materials.push(concrete);
  const grass=material('Engineering central lawn',0x829064,1);grass.map=sourceGrass.map;
  const soil=material('Engineering low planted strips',0x4e5735,1);
  const limestone=material('EER pale limestone panels',0xc8bfa9);
  const limestoneShade=material('EER alternating stone panels',0xc3baa5);
  const glass=material('EER blue gray glazing',0x365969,.21,.34);
  const darkGlass=material('EER recessed glazing',0x223b48,.28,.25);
  const shadow=material('EER closed interior backing',0x263237,1);
  const frame=material('EER silver mullions and braces',0xaeb7b5,.4,.58);
  const roof=material('EER parapet and roof',0x8e948f,.85);
  const lampMetal=material('Engineering globe lamp posts',0x515d55,.6,.4);
  const globe=material('Engineering lamp glass',0xe2e4dc,.4);
  const bench=material('Engineering bench slats',0x746453,.95);
  // Fine stone grain stays subtle at walking height. Large color differences
  // between panels made the earlier wings look like a patchwork texture atlas.
  for(const m of [limestone,limestoneShade]){
    m.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 eerStonePosition;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\neerStonePosition=position;');
      shader.fragmentShader='varying vec3 eerStonePosition;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float grain=sin(eerStonePosition.x*37.0+eerStonePosition.y*53.0)*sin(eerStonePosition.z*47.0-eerStonePosition.y*29.0);
        diffuseColor.rgb*=.99+.01*grain;`);
    };
    m.customProgramCacheKey=()=> 'eer-subtle-limestone-v2';
  }
  const photoGlass=options.photoFacades?createGdcGlazing('EER recessed photo-study glass'):null;
  const soffit=options.photoFacades?material('EER warm wood entrance soffit',0x94704a,.76):null;
  if(photoGlass)materials.push(photoGlass);
  const batches=new Map<T.Material,T.BufferGeometry[]>(), solidParts:T.BufferGeometry[]=[];
  const add=(g:T.BufferGeometry,m:T.Material,solid=false)=>{
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    if(uv&&n)for(let i=0;i<p.count;i++)uv.setXY(i,
      Math.abs(n.getX(i))>.7?p.getZ(i):p.getX(i),Math.abs(n.getY(i))>.7?p.getZ(i):p.getY(i));
    if(m===photoGlass) {
      const seed=p.count+p.getX(0)*17+p.getY(0)*31+p.getZ(0)*11;
      annotateGdcGlazing(g,'z',south,east.clone().negate(),seed);
    }
    g.applyMatrix4(basis);
    if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);
    if(solid) {
      const physical=g.clone();
      // Per-field glass shading attributes are render-only; keep the merged
      // collider schema identical to the established position/normal/UV mesh.
      for(const key of Object.keys(physical.attributes))if(key.startsWith('gdcWindow'))physical.deleteAttribute(key);
      solidParts.push(physical);
    }
  };
  const box=(s:number,y:number,t:number,w:number,h:number,d:number,m:T.Material,solid=false)=>
    add(new T.BoxGeometry(w,h,d).translate(s,y,t),m,solid);
  const tube=(a:T.Vector3,b:T.Vector3,r:number,m:T.Material)=>{
    const delta=b.clone().sub(a),g=new T.CylinderGeometry(r,r,delta.length(),8);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()));
    g.translate(...a.clone().lerp(b,.5).toArray());add(g,m);
  };
  const height=(s:number,t:number)=>{
    const p=engineeringCourtPoint(s,t);
    return approachHeight(p.x,p.z);
  };
  const paved=(s:number,t:number)=>s<3||s>78||Math.abs(t)>7.7||Math.abs(s-18)<1.3||Math.abs(s-54)<1.3;
  // One continuous ground mesh per material. Matching physics comes from these
  // same triangles, including the lawn: there is no decorative floor over a void.
  const ground=(s0:number,s1:number,t0:number,t1:number,entrance=false)=>{
    const ns=Math.ceil((s1-s0)/.75),nt=Math.ceil((t1-t0)/.75);
    const terrainParts=new Map<T.Material,number[]>();
    const vertex=(s:number,t:number)=>new T.Vector3(s,entrance?7.15:height(s,t),t);
    const emit=(ps:T.Vector3[],m:T.Material)=>{
      if(!terrainParts.has(m))terrainParts.set(m,[]);
      for(const p of ps)terrainParts.get(m)!.push(...p.toArray());
    };
    for(let i=0;i<ns;i++)for(let j=0;j<nt;j++){
      const a=s0+(s1-s0)*i/ns,b=s0+(s1-s0)*(i+1)/ns;
      const c=t0+(t1-t0)*j/nt,d=t0+(t1-t0)*(j+1)/nt;
      const s=(a+b)/2,t=(c+d)/2;
      const m=entrance||paved(s,t)?concrete:Math.abs(t)>6.3?soil:grass;
      const p=vertex(a,c),q=vertex(b,c),r=vertex(a,d),v=vertex(b,d);
      emit([p,r,q,q,r,v],m);
    }
    const corners=[[s0,t0],[s1,t0],[s1,t1],[s0,t1]];
    for(let i=0;i<4;i++){
      const a=corners[i],b=corners[(i+1)%4],n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1]));
      for(let j=0;j<n;j++){
        const p=vertex(T.MathUtils.lerp(a[0],b[0],j/n),T.MathUtils.lerp(a[1],b[1],j/n));
        const q=vertex(T.MathUtils.lerp(a[0],b[0],(j+1)/n),T.MathUtils.lerp(a[1],b[1],(j+1)/n));
        const pl=p.clone().add(new T.Vector3(0,-2.5,0)),ql=q.clone().add(new T.Vector3(0,-2.5,0));
        emit([p,q,pl,q,ql,pl],concrete);
      }
    }
    for(const [m,positions] of terrainParts){
      const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3));
      g.setAttribute('uv',new T.Float32BufferAttribute(positions.flatMap((v,i)=>i%3===0?[v/2,positions[i+2]/2]:[]),2));
      g.computeVertexNormals();add(g,m,true);
    }
  };
  ground(-4,96,-11.5,12);
  // Connect the atrium apron to the end of the existing upper terrace.
  ground(96,115,-11.5,12,true);
  const volumes:CutVolume[]=[cut(-4,96,-11.5,12,-4,23),cut(96,115,-11.5,12,3,23)];

  const trees:TreePlacement[]=[];
  for(const t of [-6.95,6.95])for(const [i,s] of [8,28,39,48,65,75].entries()){
    const p=engineeringCourtPoint(s,t,height(s,t)-.025);
    trees.push({x:p.x,y:p.y,z:p.z,rotation:(i+(t<0?2:0))*2.39996,
      scale:.86+.035*(i%3),width:.82,height:1.08});
  }
  // Narrow stone edging follows the actual grade; avoid tall barriers around
  // grass or placing trunks on either continuous walking strip.
  for(const t of [-6.3,6.3])for(let s=3;s<78;s++){
    if(Math.abs(s-18)<1.7||Math.abs(s-54)<1.7)continue;
    box(s+.5,height(s+.5,t)-.03,t,1,.1,.13,limestone);
  }
  let lamps=0,benches=0;
  for(const t of [-7.25,7.25])for(const s of [12,43,70]){
    const y=height(s,t);lamps++;
    tube(new T.Vector3(s,y,t),new T.Vector3(s,y+3.7,t),.055,lampMetal);
    box(s,y+.15,t,.22,.3,.22,lampMetal,true);
    add(new T.SphereGeometry(.22,10,8).scale(.8,1.25,.8).translate(s,y+3.85,t),globe);
    tube(new T.Vector3(s,y+4.08,t),new T.Vector3(s,y+4.25,t),.035,lampMetal);
  }
  for(const t of [-6.85,6.85])for(const s of [33,60]){
    const y=height(s,t);benches++;
    for(let j=0;j<4;j++)box(s,y+.46,t+(j-1.5)*.11,1.8,.055,.095,bench,true);
    for(const d of [-.66,.66])box(s+d,y+.23,t,.07,.46,.4,lampMetal,true);
  }

  // EER's two cream wings frame a recessed glazed atrium. These exterior-only
  // masses follow the west building edge; storey heights/detail are estimated
  // from the supplied photos. Complete returns replace the mixed scan/model
  // seams that were exposed by the earlier shallow twenty-metre wings.
  const base=7.15,floor=4.35,floors=7,top=base+floors*floor;
  let windows=0,braces=0,photoRecesses=0,soffitSlats=0;
  const photoWingFront=(t0:number,t1:number)=>{
    const width=t1-t0,inner=t0<0?t1:t0;
    const bays=Math.round((width-3)/4.4),pitch=(width-3.6)/bays;
    const openings:{left:number;right:number;low:number;high:number}[]=[];
    for(let f=0;f<floors;f++){
      const low=base+f*floor+.16,high=base+(f+1)*floor-.16;
      // The continuous glazing at the inner corners is wider than the sparse
      // slit windows on the pale wing. Both now sit in real wall apertures.
      openings.push({left:inner+(t0<0?-2.45:.14),right:inner+(t0<0?-.14:2.45),low,high});
      for(let j=0;j<bays;j++){
        const x=t0<0?t0+.55+(j+.65)*pitch:t0+3.05+(j+.35)*pitch;
        const w=j%3===1?1.03:.70;
        openings.push({left:x-w/2,right:x+w/2,low,high});
      }
    }
    const xs=[...new Set([t0,t1,...openings.flatMap(o=>[o.left,o.right])])].sort((a,b)=>a-b),ys=[...new Set([3.5,top,...openings.flatMap(o=>[o.low,o.high])])].sort((a,b)=>a-b);
    for(let ix=0;ix<xs.length-1;ix++)for(let iy=0;iy<ys.length-1;iy++){
      const t=(xs[ix]+xs[ix+1])/2,y=(ys[iy]+ys[iy+1])/2;
      if(openings.some(o=>t>o.left-1e-5&&t<o.right+1e-5&&y>o.low-1e-5&&y<o.high+1e-5))continue;
      box(104.6,y,t,1.2,ys[iy+1]-ys[iy],xs[ix+1]-xs[ix],limestone,true);
    }
    for(const o of openings){const t=(o.left+o.right)/2,y=(o.low+o.high)/2,w=o.right-o.left,h=o.high-o.low;
      box(104.42,y,t,.07,h,w,photoGlass!,true);
      for(const tt of[o.left+.027,o.right-.027])box(104.18,y,tt,.48,h,.054,frame,true);
      for(const yy of[o.low+.027,o.high-.027])box(104.18,yy,t,.48,.054,w,frame,true);
      // Narrow dark horizontal transoms read the laboratory floor datum without
      // large bright exterior bands bisecting the limestone wall.
      box(104.35,o.low+h*.26,t,.09,.046,w,frame);windows++;photoRecesses++;
    }
    for(let f=1;f<floors;f++)box(103.992,base+f*floor,(t0+t1)/2,.018,.055,width,roof);
  };
  for(const [t0,t1] of [[-43,-12],[12,34.5]]){
    const center=(t0+t1)/2,width=t1-t0;
    const end=t0<0?153.5:184.4,depth=end-104;
    if(options.photoFacades) {
      // Keep the mapped body and returns; replace only its front1.2m skin.
      box((105.2+end)/2,(3.5+top)/2,center,end-105.2,top-3.5,width,limestone,true);
      photoWingFront(t0,t1);
    } else box((104+end)/2,(3.5+top)/2,center,depth,top-3.5,width,limestone,true);
    box((104+end)/2,top+.26,center,depth+.35,.52,width+.35,roof);
    // Stable bays with narrow vertical glazing and continuous floor bands.
    // Small alternating offsets follow the photos without random panel sizes.
    const bays=Math.round(width/4.4),pitch=(width-1.2)/bays;
    if(!options.photoFacades)for(let f=0;f<floors;f++){
      const y=base+(f+.5)*floor;
      box(103.87,base+f*floor,center,.32,.15,width,frame);
      for(let j=0;j<bays;j++){
        const start=t0+.6+j*pitch,glassWidth=j===bays-1?1.15:.72;
        const windowT=start+pitch*(f%2?.60:.72);
        box(103.90,y,start+pitch/2,.18,floor-.21,pitch-.055,j%3?limestone:limestoneShade);
        box(103.77,y,windowT,.065,floor-.26,glassWidth,j===bays-1?glass:darkGlass);windows++;
        for(const side of [-1,1])box(103.70,y,windowT+side*(glassWidth/2+.035),.14,floor-.2,.065,frame);
        box(103.69,y-floor/2+.14,windowT,.18,.08,glassWidth+.14,frame);
      }
    }
    // Return glazing on the inner sides emphasizes the atrium's setback.
    const inner=t0<0?t1:t0;
    for(const edge of [t0,t1])for(let f=0;f<floors;f++){
      const outward=edge===t0?-1:1,y=base+(f+.5)*floor;
      box((104+end)/2,base+f*floor,edge+outward*.065,depth,.15,.2,frame);
      for(let s=106;s<end-1.5;s+=4.4){
        box(s,y,edge+outward*.075,.82,floor-.28,.10,darkGlass);windows++;
        for(const side of [-1,1])box(s+side*.45,y,edge+outward*.13,.065,floor-.2,.16,frame);
      }
      // Recessed atrium-side corner windows sit under the same floor datum.
      if(f===0)box(110,base+3.1,inner+(t0<0?.7:-.7),11,.16,1.45,roof);
    }
    // Keep the source ground outside the narrow apron: clearing below these
    // wings would remove unsurveyed neighboring paths without replacing them.
    volumes.push(cut(102.5,end+.3,t0-.25,t1+.25,base+.05,70));
  }
  // Complete the mapped stepped north/rear footprint, behind the two principal
  // wings. The entry recess remains open all the way to the glass threshold.
  for(const [s0,s1,t0,t1] of [[104,115,-52.6,-43],[115,153.5,-58.7,-43],
    [153.5,184.4,-33.8,-12],[153.5,177.3,-38.5,-33.8],[116.4,184.4,-12,12]]){
    box((s0+s1)/2,(3.5+top)/2,(t0+t1)/2,s1-s0,top-3.5,t1-t0,limestone,true);
    box((s0+s1)/2,top+.26,(t0+t1)/2,s1-s0,.52,t1-t0,roof);
    volumes.push(cut(s0-.25,s1+.25,t0-.25,t1+.25,base+.05,70));
  }
  // Thin exterior sun screens on the exposed southern return, as visible in
  // the oblique reference. Batched geometry adds depth without new textures.
  for(let s=127;s<181;s+=3.5)box(s,base+16,34.95,.10,24,.8,frame);
  for(let y=base+4;y<base+28;y+=.6)box(154,y,35.25,54,.07,.35,roof);
  // A closed glass-backed entrance permits exterior exploration, not access
  // to a modeled interior. Mullions and X braces are real geometry with depth.
  box(115.7,(base+top-2.2)/2,0,1.4,top-base-2.2,24,shadow,true);
  if(options.photoFacades) {
    // Split the tall atrium into real framed fields so the shaded room cue
    // has a coherent floor scale, instead of one giant blue painted plane.
    for(let f=0;f<7;f++)for(let j=0;j<8;j++) {
      const low=base+f*floor,high=Math.min(top-2.2,low+floor);
      box(114.9,(low+high)/2,-10.36+j*2.96,.10,high-low,2.96,photoGlass!);
    }
  }else box(114.9,(base+top-2.2)/2,0,.10,top-base-2.2,23.7,glass);
  for(let t=-12;t<=12;t+=1.5)box(114.77,(base+top-2.2)/2,t,.15,top-base-2.2,.075,frame);
  for(let f=0;f<=6;f++){
    const y=base+f*floor;
    box(114.56,f===0?base-.12:y,0,.7,.22,24,frame);
    if(f===0)continue;
    const y1=y+floor-.25;
    if(y1>top-1.8)continue;
    for(const [a,b] of [[-11.6,11.6]]){
      tube(new T.Vector3(114.28,y+.18,a),new T.Vector3(114.28,y1,b),.095,frame);
      tube(new T.Vector3(114.28,y+.18,b),new T.Vector3(114.28,y1,a),.095,frame);braces+=2;
    }
  }
  if(options.photoFacades) {
    box(111.75,base+11.22,0,6.35,.32,23.8,roof);
    //82 real shallow timber strips provide the characteristic warm soffit.
    for(let t=-11.76;t<11.8;t+=.29){box(111.75,base+11.008,t,6.22,.105,.25,soffit!);soffitSlats++;}
    box(108.56,base+11.15,0,.11,.52,23.8,frame);
    box(113.92,base+3.19,0,2.25,.20,12.5,roof);
  }else box(113.9,base+3.35,0,2.4,.32,24,limestone);
  for(let t=-4.5;t<=4.5;t+=1.5){
    box(114.69,base+1.55,t,.16,3,1.36,darkGlass);
    box(114.55,base+1.55,t,.12,3,.045,frame);
    box(114.47,base+1.25,t+.48,.07,.46,.045,frame);
  }
  box(115.4,top-2.18,0,2,.3,24.2,roof);
  volumes.push(cut(104,116.5,-12,12,base-.4,63));

  // PMA: mapped stepped podium with two smooth towers. Window recesses and
  // vertical piers are geometry, based on the user's historical photograph;
  // tower heights and the podium/tower split remain approximate.
  const pmaStone=material('PMA pale warm masonry',0xc5aa88,.92);
  const pmaRecess=material('PMA dark recessed windows',0x273432,.48,.12);
  const pmaFootprint=[
    [81.71,-101.93],[81.69,-71.62],[77.33,-71.63],[77.34,-80.2],[54.11,-80.47],
    [54.11,-75.12],[48.46,-75.12],[48.46,-89.24],[45.93,-89.24],[45.93,-93.51],
    [9.75,-93.51],[9.75,-78.57],[8.09,-78.58],[8.09,-75.2],[9.83,-75.21],
    [9.84,-58.13],[54.61,-58.55],[54.53,-19.75],[66.43,-19.75],[66.43,-28.39],
    [77.66,-28.6],[77.66,-46.04],[73.07,-46.05],[73.07,-58.77],
    [154.52,-58.71],[154.55,-101.89],
  ];
  const podiumTop=10.5;
  const pmaGlass=material('PMA grouped blue-gray glazing',0x475854,.33,.24);
  const pmaFrame=material('PMA recessed bronze window frames',0x66655d,.55,.3);
  const pmaPodium=options.localPodium===false ? null : buildPmaLocalPodium(add,pmaFootprint as [number,number][],{stone:pmaStone,glass:pmaGlass,metal:pmaFrame});
  if (!pmaPodium) {
    const shape=new T.Shape(pmaFootprint.map(([s,t])=>new T.Vector2(s,-t)));
    add(new T.ExtrudeGeometry(shape,{depth:7.5,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,3,0),pmaStone,true);
  }
  const pmaPoints=pmaFootprint.map(([s,t])=>new T.Vector2(s,t));
  for(const ids of T.ShapeUtils.triangulateShape(pmaPoints,[])){
    const points=ids.map(i=>engineeringCourtPoint(...pmaFootprint[i] as [number,number]));
    const center=points.reduce((sum,p)=>sum.add(p),new T.Vector3()).multiplyScalar(1/3);
    const planes=points.map((p,i)=>{
      const q=points[(i+1)%3],plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(q.z-p.z,0,p.x-q.x).normalize(),p);
      if(plane.distanceToPoint(center)>0)plane.negate();return plane;
    });
    const bounds=new T.Box3().setFromPoints(points);bounds.min.y=3.01;bounds.max.y=95;
    planes.push(new T.Plane(new T.Vector3(0,-1,0),3.01),new T.Plane(new T.Vector3(0,1,0),-95));
    volumes.push({planes,bounds});
  }

  const pmaFrontage=buildPmaTowerFrontage(add,pmaStone,pmaGlass,pmaFrame);
  // The photographed Speedway end wall has a projecting service-core blade.
  // Its position combines the mapped podium notch with retained wall samples;
  // depth and the small roof projection remain photo-informed estimates.
  box(9.05,39.25,-76.1,2.3,57.5,5.4,pmaStone,true);
  volumes.push(cut(7.9,10.2,-78.8,-73.4,10.5,68));
  // Back the corrected south-face strip with the complete closed tower skin.
  // This only clears the 1.7 m registration discrepancy above the podium.
  volumes.push(cut(9.9,45.9,-58.6,-56.9,10.5,66.98));
  let pmaWindows=pmaFrontage.stats.openings;
  for(const [s0,s1,t0,t1,count] of [[81.8,154.4,-101.8,-58.9,11]]){
    const step=4.0,topY=podiumTop+count*step,w=s1-s0,d=t1-t0;
    box((s0+s1)/2,(podiumTop+topY)/2,(t0+t1)/2,w-.9,topY-podiumTop,d-.9,pmaStone,true);
    box((s0+s1)/2,topY+.24,(t0+t1)/2,w+.18,.48,d+.18,pmaStone);
    const corners=[[s0,t0],[s1,t0],[s1,t1],[s0,t1]];
    for(let edge=0;edge<4;edge++){
      const a=corners[edge],b=corners[(edge+1)%4],ds=b[0]-a[0],dt=b[1]-a[1],length=Math.hypot(ds,dt);
      const nx=dt/length,nz=-ds/length,angle=-Math.atan2(dt,ds),bays=Math.max(1,Math.round(length/4.2)),pitch=length/bays;
      const facadeBox=(u:number,y:number,width:number,h:number,depth:number,m:T.Material,inset=0)=>{
        const g=new T.BoxGeometry(width,h,depth).rotateY(angle);
        g.translate(a[0]+ds*u/length+nx*inset,y,a[1]+dt*u/length+nz*inset);add(g,m);
      };
      for(let f=0;f<count;f++){
        const floorY=podiumTop+f*step;
        facadeBox(length/2,floorY+1.25,length,2.5,.7,pmaStone);
        for(let j=0;j<bays;j++){
          facadeBox((j+.5)*pitch,floorY+3.25,pitch-.7,1.48,.065,pmaRecess,-.24);pmaWindows++;
          facadeBox(j*pitch,floorY+2,.72,step,.72,pmaStone);
          facadeBox((j+.5)*pitch,floorY+2.51,pitch-.7,.13,.85,pmaStone,.035);
        }
        facadeBox(length,floorY+2,.72,step,.72,pmaStone);
      }
    }
  }

  const meshes:T.Mesh[]=[];
  for(const [m,parts] of batches){
    const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;
    const mesh=new T.Mesh(g,m);mesh.name=`Engineering courtyard: ${m.name}`;
    mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);
    for(const part of new Set([...parts,...flat]))part.dispose();
  }
  const flatSolid=solidParts.map(g=>g.index?g.toNonIndexed():g);
  const colliderGeometries=[mergeGeometries(flatSolid)!];
  for(const part of new Set([...solidParts,...flatSolid]))part.dispose();
  // These three batches contain only ground() triangles; every triangle also
  // exists unchanged in the combined solid collider. Borrow their identities
  // for the offline terrain mask without treating decorative meshes as floors.
  const groundMeshes=meshes.filter(mesh=>mesh.material===concrete||mesh.material===grass||mesh.material===soil);
  return {meshes,groundMeshes,materials,colliderGeometries,volumes,trees,height,paved,
    stats:{trees:trees.length,lamps,benches,windows,braces,photoRecesses,soffitSlats,pmaTowers:2,pmaWindows,pmaFrontage:pmaFrontage.stats,pmaPodium:pmaPodium?.stats,
      triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0)}};
}
