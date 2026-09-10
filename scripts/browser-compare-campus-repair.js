// Static display-only comparison, run through the browser console while no input
// is held. Reuses live cached source geometry; no extra tile requests or exports.
// Camera/player/collisions stay fixed. All prototype, geometry and visibility
// changes are synchronous and restored before the next animation frame.
// oxlint-disable-next-line typescript/no-floating-promises
(async()=>{
 const url=performance.getEntriesByType('resource').map(e=>e.name)
  .filter(n=>n.startsWith(location.origin+'/lib/campus/game.ts')).at(-1);
 if(!url)throw Error('Live game module URL was not retained');
 const {CampusGame}=await import(url),prototype=CampusGame.prototype,originalSnapshot=prototype.snapshot;
 let game;
 try{prototype.snapshot=function(){game=this;return originalSnapshot.call(this)};window.__campus.snapshot();}
 finally{prototype.snapshot=originalSnapshot}
 if(!game||game.disposed||!game.photoreal||game.keys.size)throw Error('A live, stationary campus scene is required');
 const before=game.snapshot(),changes=[];
 const detail={};
 for(const tile of game.photoreal.tiles.visibleTiles){
  const scene=game.photoreal.entries.get(tile)?.scene;if(!scene)continue;
  const original=tile.engineData.geometry,nodes=[];
  scene.traverse(o=>{if(o.geometry&&!o.userData.campusShadowReceiver)nodes.push(o)});
  if(!original||nodes.length!==original.length)throw Error('Source geometry ownership mismatch');
  for(let i=0;i<nodes.length;i++)if(nodes[i].geometry!==original[i])changes.push({node:nodes[i],current:nodes[i].geometry,original:original[i]});
  const key=String(Math.round(tile.geometricError*1000)/1000);detail[key]=(detail[key]||0)+1;
 }
 const capture=()=>{game.renderer.render(game.scene,game.camera);return game.renderer.domElement.toDataURL('image/png')};
 const repaired=capture(),visible=game.walkway?.group.visible;
 let source;
 try{
  for(const change of changes)change.node.geometry=change.original;
  if(game.walkway)game.walkway.group.visible=false;
  source=capture();
 }finally{
  for(const change of changes)change.node.geometry=change.current;
  if(game.walkway)game.walkway.group.visible=visible;
  game.renderer.render(game.scene,game.camera);
 }
 const after=game.snapshot();
 return {repaired,source,changedMeshes:changes.length,visibleGeometricErrors:detail,
  positionBefore:before.position,positionAfter:after.position,cameraBefore:before.camera,cameraAfter:after.camera,
  tilesLoadedBefore:before.imagery.loaded,tilesLoadedAfter:after.imagery.loaded,
  geometryRestored:changes.every(c=>c.node.geometry===c.current),
  limits:'Same camera and cached tile LOD. Static display-only comparison, not movement with source collisions. Material conversion is unchanged. No tile geometry is downloaded or saved.'};
})()
