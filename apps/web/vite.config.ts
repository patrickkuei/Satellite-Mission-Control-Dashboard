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
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
