import manifest from '../../public/assets/civilian/sources.json';

// Both the viewer and game use the same revision. A fresh load uses the rebuilt
// asset without reusing an older cached GLB. Existing scenes may need a reload.
const revision = manifest.files
  .find((file) => file.file === 'character.glb')!
  .sha256.slice(0, 16);
export const PERSONAL_CHARACTER_URL = `/assets/civilian/character.glb?v=${revision}`;
