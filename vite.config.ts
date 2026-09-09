import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// UI client build (ADR-0015). The client lives in `src/ui/client/`; `src/ui/`
// also holds the Node-run `server.ts` / `export.ts`, which are NOT part of this
// build (they run under Node's native type stripping, no bundling).
//
// Output goes to `dist/ui/` (`index.html` + hashed `assets/*.js|css`). That
// directory is not version-controlled (decision 1) — `src/ui/server.ts` serves
// it, and the dev loop is `vite build --watch` alongside the existing
// `node:http` server (decision 4). `base: './'` keeps asset URLs relative so
// the server's fixed `/` → index.html + `/assets/<file>` routes resolve.
export default defineConfig({
  root: fileURLToPath(new URL('./src/ui', import.meta.url)),
  base: './',
  plugins: [preact()],
  build: {
    outDir: fileURLToPath(new URL('./dist/ui', import.meta.url)),
    emptyOutDir: true,
    assetsDir: 'assets',
    // One entry, small app — a single JS + CSS chunk keeps the served asset
    // surface minimal (matches the two-route allowlist in server.ts).
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
