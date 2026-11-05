import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

/**
 * Vite config for the Manifest V3 extension.
 *
 * `root` is `src/`, so HTML entries land at predictable paths in dist/:
 *   src/popup/index.html        → dist/popup/index.html
 *   src/offscreen/offscreen.html → dist/offscreen/offscreen.html
 * The service worker is emitted at dist/background/service_worker.js and
 * loaded as an ES module ("type": "module" in the manifest), so it may
 * import shared chunks from dist/assets/.
 *
 * MV3 forbids remote code and eval, so there is no dev server: `npm run dev`
 * is `vite build --watch`, and you reload the unpacked extension.
 */
export default defineConfig(({ mode }) => ({
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, 'public'),
  base: '/',
  plugins: [react(), syncManifestVersion()],
  css: {
    postcss: {
      plugins: [tailwindcss({ config: resolve(__dirname, 'tailwind.config.js') }), autoprefixer()],
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    modulePreload: { polyfill: false }, // Chrome supports modulepreload natively
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        service_worker: resolve(__dirname, 'src/background/service_worker.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service_worker' ? 'background/service_worker.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
}));

/** Keeps manifest.json's version equal to package.json's, so there is one place to bump it. */
function syncManifestVersion() {
  return {
    name: 'sync-manifest-version',
    writeBundle() {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
      const out = resolve(__dirname, 'dist/manifest.json');
      const manifest = JSON.parse(readFileSync(out, 'utf8')) as { version: string };
      manifest.version = pkg.version;
      writeFileSync(out, JSON.stringify(manifest, null, 2));
    },
  };
}
