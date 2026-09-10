import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

function localTilesConfig(): Plugin {
  return {
    name: 'local-cesium-client-config',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/tiles-config', async (req, res) => {
        const allowed = new Set([
          'http://localhost:5173',
          'http://127.0.0.1:5173',
        ]);
        if (
          req.method !== 'GET' ||
          !allowed.has(`http://${req.headers.host}`) ||
          (req.headers.origin && !allowed.has(req.headers.origin)) ||
          req.headers['sec-fetch-site'] === 'cross-site'
        ) {
          res.writeHead(403).end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        try {
          // This restricted public-client token is delivered only to the local
          // browser. The private file is never copied into source or build output.
          const text = await readFile(
            resolve(process.cwd(), '../.local/cesium/credentials.env'),
            'utf8',
          );
          const fields = Object.fromEntries(
            text
              .split(/\r?\n/)
              .filter((line) => /^[A-Z_]+=/.test(line))
              .map((line) => {
                const i = line.indexOf('=');
                return [
                  line.slice(0, i),
                  line
                    .slice(i + 1)
                    .trim()
                    .replace(/^['"]|['"]$/g, ''),
                ];
              }),
          );
          const token = fields.CESIUM_ION_TOKEN,
            assetId = Number(fields.CESIUM_GOOGLE_ASSET_ID);
          if (!token || !Number.isSafeInteger(assetId) || assetId <= 0)
            throw Error('Missing configuration');
          res.end(JSON.stringify({ token, assetId }));
        } catch {
          res
            .writeHead(503)
            .end(
              JSON.stringify({
                error: 'Local campus imagery access is not configured.',
              }),
            );
        }
      });
    },
  };
}

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      headers: { 'Referrer-Policy': 'strict-origin-when-cross-origin' },
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      localTilesConfig(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
