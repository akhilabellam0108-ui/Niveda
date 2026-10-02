import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces a normal multi-file build in dist/.
// `npm run build:single` inlines everything into one index.html (handy for sharing a preview).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  base: '/',
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist/web', emptyOutDir: true, chunkSizeWarningLimit: 800 },
  server: { host: true, allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'], proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:8080', changeOrigin: false } } },
}));
