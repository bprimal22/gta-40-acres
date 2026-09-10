import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { guestHandler } from '../demo/guest-worker.mjs';
const root = resolve(import.meta.dirname, '../dist-demo');
const port = Number(process.env.UT_DEMO_PORT || 5187);
const guestPreview = process.env.UT_GUEST_PREVIEW === '1';
let guestEnv, guestHandle;
if (guestPreview) {
  const fields = Object.fromEntries((await readFile(resolve(import.meta.dirname, '../../.local/cesium/credentials.env'), 'utf8')).split(/\r?\n/).filter(s => /^[A-Z_]+=/.test(s)).map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
  guestEnv = { GUEST_ENABLED: '1', GUEST_ALLOWED_ORIGIN: `http://127.0.0.1:${port}`, GUEST_CESIUM_TOKEN: fields.CESIUM_ION_TOKEN, GUEST_COOKIE_SECRET: process.env.UT_GUEST_PREVIEW_SIGNING_SECRET || randomBytes(32).toString('hex') };
  guestHandle = guestHandler();
}
const rules = []; let current;
for (const line of (await readFile(resolve(root, '_headers'), 'utf8')).split('\n')) {
  if (line.startsWith('/')) { current = { path: line.trim(), headers: {} }; rules.push(current); }
  else if (current && /^\s+\S+:/.test(line)) { const i=line.indexOf(':'); current.headers[line.slice(0,i).trim()]=line.slice(i+1).trim(); }
}
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.wasm':'application/wasm', '.glb':'model/gltf-binary', '.woff2':'font/woff2', '.txt':'text/plain' };
createServer(async (req, res) => {
  if (guestPreview && req.url?.split('?')[0] === '/api/guest-session') {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const response = await guestHandle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers }), guestEnv);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
  }
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  let path; try { path=decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (path.startsWith('/api/') || path.includes('..') || path.includes('\\') || path.split('/').some(p=>p.startsWith('.')||p.startsWith('_'))) { res.writeHead(404).end(); return; }
  let file = resolve(root, '.'+path);
  if (!file.startsWith(root+sep) && file!==root) { res.writeHead(404).end(); return; }
  try { if (!(await stat(file)).isFile()) file=resolve(root,'index.html'); }
  catch { if (extname(path)) {res.writeHead(404).end();return;} file=resolve(root,'index.html'); }
  try {
    const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream' };
    for (const rule of rules) if (rule.path.endsWith('*') ? path.startsWith(rule.path.slice(0,-1)) : path===rule.path) Object.assign(headers,rule.headers);
    const data=await readFile(file); res.writeHead(200,{...headers,'Content-Length':data.length}); res.end(req.method==='HEAD'?undefined:data);
  } catch { res.writeHead(500).end(); }
}).listen(port, '127.0.0.1', () => console.log(`Static demo: http://127.0.0.1:${port}/`));
