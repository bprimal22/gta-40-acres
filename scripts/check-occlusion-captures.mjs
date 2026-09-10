// Verify saved actual-browser frames, including the photographed-color regression.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const root = 'evidence/';
const prefix = process.argv[2] ?? 'verified';
assert.match(prefix, /^(verified|shader-fixed)$/);
const difference = (a, b) => {
  let sum = 0, max = 0, darkenedPixels = 0, brightenedPixels = 0;
  for (let i = 0; i < a.length; i += 3) {
    let dark = false, bright = false;
    for (let j = 0; j < 3; j++) {
      const delta = a[i+j] - b[i+j];
      sum += Math.abs(delta); max = Math.max(max, Math.abs(delta));
      dark ||= delta > 2; bright ||= delta < -2;
    }
    darkenedPixels += Number(dark); brightenedPixels += Number(bright);
  }
  return { meanAbsoluteChannelDifference: sum/a.length, maximum: max, darkenedPixels, brightenedPixels };
};
const pixels = (path, crop) => {
  let image = sharp(root+path);
  if (crop) image = image.extract(crop);
  return image.removeAlpha().raw().toBuffer();
};
const records = [];
for (const location of ['hackerman', 'mbb', 'near-mbb', 'gdc']) {
  const base = `iteration-37-${prefix}-${location}-compare`;
  const meta = JSON.parse(await fs.readFile(root+base+'.json', 'utf8'));
  assert.deepEqual(meta.before.position, meta.after.position);
  assert.deepEqual(meta.before.camera, meta.after.camera);
  assert.equal(meta.before.ambientOcclusion.enabled, meta.after.ambientOcclusion.enabled);
  const [direct, without, withAO] = await Promise.all(['direct', 'without', 'withAO'].map(s=>pixels(base+'-'+s+'.png')));
  const pipeline = difference(direct, without), occlusion = difference(without, withAO);
  assert.ok(occlusion.darkenedPixels > 1000, `${location}: effect must contribute visible pixels`);
  assert.equal(occlusion.brightenedPixels, 0, `${location}: contact shading must not brighten the scene`);
  records.push({ location, sameCameraAndPosition: true, displayFlagRestored: true, pipeline, occlusion });
}
const crop = { left:1190, top:30, width:65, height:180 };
const sourceColor = {};
for (const [label, base] of [['initial','iteration-37-hackerman-compare'], ['final',`iteration-37-${prefix}-hackerman-compare`]]) {
  sourceColor[label] = difference(...await Promise.all(['direct', 'without'].map(s=>pixels(base+'-'+s+'.png', crop))));
}
assert.ok(sourceColor.initial.meanAbsoluteChannelDifference > 5, 'Retain the original photographed-color failure');
assert.ok(sourceColor.final.meanAbsoluteChannelDifference < 1, 'Preserve photographed facade color, allowing anti-aliasing/half-float rounding');
const report = { passed:true, prefix, records, photographedFacade:{ crop, ...sourceColor },
  limits:'Actual same-frame canvas comparisons. Pixel difference establishes effect/preservation, not artistic quality. Antialiasing at geometry edges differs between default and offscreen framebuffers. The ROI is the photographed upper Patterson facade in the Hackerman view.' };
await fs.writeFile(root+'iteration-37-capture-check.json', JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
