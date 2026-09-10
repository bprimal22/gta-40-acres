import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../lib/campus/visitor-cesium.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const auth = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
globalThis.location = { hostname: 'demo.pages.dev', origin: 'https://demo.pages.dev' };
const requests = [], values = new Map();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
let status = 200, body = { type: '3DTILES', externalType: '3DTILES', options: { url: 'https://tile.googleapis.com/v1/3dtiles/root.json?key=fixture-provider-key' } };
globalThis.fetch = async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(body), { status }); };
const token = 'fixture-visitor-token-123456789';
const config = await auth.validateVisitorToken('  ' + token + ' ');
assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://api.cesium.com/v1/assets/2275207/endpoint');
assert.equal(new URL(requests[0].url).search, ''); assert.equal(requests[0].options.headers.Authorization, 'Bearer ' + token);
assert.equal(requests[0].options.credentials, 'omit'); assert.equal(requests[0].options.cache, 'no-store');
assert.equal(values.size, 0, 'Validation alone must not persist an unaccepted token');
auth.saveVisitorToken(config.token); assert.equal(auth.readVisitorToken(), token); assert.equal(values.size, 1);
assert.equal(values.get(auth.VISITOR_TOKEN_KEY), token, 'Persist only the visitor token, not the provider endpoint');
const count = requests.length; assert.equal(await auth.gameTilesConfig(config), config); assert.equal(requests.length, count);
await assert.rejects(auth.gameTilesConfig(), e => e.reason === 'invalid'); assert.equal(requests.length, count, 'Hosted game must not fetch app-server config');
for (const [code, reason] of [[401,'invalid'],[403,'forbidden'],[404,'asset'],[402,'quota'],[429,'quota'],[503,'network']]) {
  status=code; await assert.rejects(auth.validateVisitorToken(token), e => e.reason === reason);
}
status=200;
for (const url of ['https://untrusted.example/root.json?key=fixture','http://tile.googleapis.com/v1/3dtiles/root.json?key=fixture','https://tile.googleapis.com/not-tiles?key=fixture']) {
 body={type:'3DTILES',externalType:'3DTILES',options:{url}};
 await assert.rejects(auth.validateVisitorToken(token), e => e.reason === 'asset');
}
await assert.rejects(auth.validateVisitorToken('invalid short'), e => e.reason === 'invalid');
auth.removeVisitorToken(); assert.equal(auth.readVisitorToken(), null);
localStorage.setItem=()=>{throw Error('storage denied');}; assert.throws(()=>auth.saveVisitorToken(token),e=>e.reason==='storage');
for (const r of requests) assert.equal(new URL(r.url).hostname, 'api.cesium.com');
console.log(JSON.stringify({ passed: true, tested: ['direct bearer authentication','no token in request URL','provider endpoint reuse','no hosted app-server config request','automatic persistence contract','remove','storage failure','invalid/forbidden/missing asset/quota/network recovery','endpoint host validation'], requests: requests.length, liveNetwork: false }));
