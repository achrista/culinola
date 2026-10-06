import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Beim Entwickeln läuft die Oberfläche auf eigenem Port und reicht API-Aufrufe an den Kern weiter.
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8090', ws: true },
    },
  },
});
