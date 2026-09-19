import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve('client'),
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    fs: { strict: true, allow: [resolve('client'), resolve('node_modules')] },
    watch: { usePolling: true, interval: 300 },
  },
});
