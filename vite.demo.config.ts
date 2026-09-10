import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';

// Separate Pages release: static game assets plus a small guest-access worker.
// The private localhost middleware is not included in this build.
export default defineConfig({
  root: resolve(import.meta.dirname, 'demo'),
  publicDir: resolve(import.meta.dirname, 'public'),
  envDir: false,
  define: { __UT_STATIC_DEMO__: 'true' },
  resolve: { alias: {
    'next/link': resolve(import.meta.dirname, 'demo/link.tsx'),
    '@': resolve(import.meta.dirname),
  } },
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: resolve(import.meta.dirname, 'dist-demo'), emptyOutDir: true, sourcemap: false },
  preview: { host: '127.0.0.1', port: 5187, strictPort: true,
    headers: { 'Referrer-Policy': 'strict-origin-when-cross-origin' } },
});
