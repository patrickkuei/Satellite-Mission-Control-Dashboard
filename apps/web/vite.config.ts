/**
 * Vite config for the orbit.ctrl frontend.
 *
 * - Dev server on port 5173 (default)
 * - API proxy to localhost:3001 so the frontend can call `/api/*` and
 *   `/ws/*` without hard-coding the backend URL during development.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // VITE_BASE_PATH is injected by the GitHub Actions workflow so assets resolve
  // correctly under the /<repo-name>/ sub-path that GitHub Pages uses.
  // Falls back to '/' for local dev and SnapDeploy (where the app is at root).
  base: process.env.VITE_BASE_PATH ?? '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
