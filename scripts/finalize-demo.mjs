import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'dist-demo');
await writeFile(resolve(out, '_worker.js'), await readFile(resolve(root, 'demo/guest-worker.mjs')));
await writeFile(resolve(out, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }));
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)]))).flat();
}
const paths = (await files(out)).sort();
const hash = createHash('sha256');
for (const path of paths) {
  const name = relative(out, path);
  if (/^(sw\.js|release\.json|_headers)$/.test(name)) continue;
  const data = await readFile(path);
  if (data.length > 25 * 1024 * 1024) throw Error(`Pages file size limit: ${name}`);
  if (/\.(html|js|json|css|txt)$/.test(name)) {
    const text = data.toString();
    if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(text) || text.includes('credentials.env'))
      throw Error(`Unexpected credential content in ${name}`);
  }
  hash.update(name).update(data);
}
if (paths.length > 20000) throw Error('Pages file count limit exceeded');
const responseHeaders = `/*
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Cache-Control: public, max-age=0, must-revalidate
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: https://api.cesium.com https://tile.googleapis.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'
/sw.js
  Cache-Control: no-cache
`;
hash.update(responseHeaders);
hash.update(await readFile(resolve(root, 'public/sw.js')));
const version = hash.digest('hex').slice(0, 16);
const worker = (await readFile(resolve(root, 'public/sw.js'), 'utf8'))
  .replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'ut-campus-demo-${version}';`);
await writeFile(resolve(out, 'sw.js'), worker);
await writeFile(resolve(out, '_headers'), responseHeaders);
const report = { version, createdAt: new Date().toISOString(), files: paths.length + 2, bytes: (await Promise.all(paths.map(p => stat(p)))).reduce((n, s) => n + s.size, 0), host: 'Cloudflare Pages Free', visitorOwnedCesiumTokens: true, guestPreviewHours: 24, guestPreviewRequiresRuntimeSecrets: true };
await writeFile(resolve(out, 'release.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
