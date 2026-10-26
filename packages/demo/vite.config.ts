import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const shim = (name: string) => fileURLToPath(new URL(`./src/shims/${name}.ts`, import.meta.url));

// Die Demo läuft unter culinola.org/demo/. Kern und Plugins bekommen statt der Node-Module kleine Gegenstücke
// für den Browser; das Umwandeln neuer Rezepte und die Anbindung an Sprachmodelle bleiben draußen.
export default defineConfig({
  base: '/demo/',
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^(node:)?fs$/, replacement: shim('fs') },
      { find: /^(node:)?path$/, replacement: shim('path') },
      { find: /^(node:)?crypto$/, replacement: shim('crypto') },
      { find: /^(node:)?events$/, replacement: shim('events') },
      { find: '@culinola/recipe-import', replacement: shim('unavailable') },
    ],
  },
  define: {
    'process.env': '{}',
  },
  build: {
    outDir: '../../website/demo',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
