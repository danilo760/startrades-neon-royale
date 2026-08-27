import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{
      find: /^\.\.\/game\/GameScene\.js$/,
      replacement: fileURLToPath(new URL('./src/game/NeonRoyaleScene.js', import.meta.url)),
    }],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/phaser/')) return 'vendor-phaser';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4173', '/events': { target: 'ws://127.0.0.1:4173', ws: true } } },
});
