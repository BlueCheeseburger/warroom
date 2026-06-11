import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'electron/main.ts') },
      rollupOptions: {
        // undici (pulled in by cheerio → topicScraper) contains a runtime-features
        // module that requires 'node:sqlite'. Rollup hoists that require to the top
        // level outside undici's own try/catch, crashing Electron on startup.
        // Marking undici external means it loads from node_modules at runtime where
        // its try/catch for ERR_UNKNOWN_BUILTIN_MODULE works correctly.
        external: ['electron', 'ws', 'bufferutil', 'utf-8-validate', 'undici'],
        output: { entryFileNames: 'index.cjs', format: 'cjs' },
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'electron/preload.ts') },
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'index.html') }
    },
    plugins: [react()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
    }
  }
});
