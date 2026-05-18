/**
 * Runtime API coordinates derived from the VITE_API_URL build-time variable.
 *
 * In dev: VITE_API_URL is undefined, so REST calls use the `/api` prefix that
 * Vite's dev-server proxy rewrites to localhost:3001. WebSocket also goes via
 * the Vite proxy at the current window origin.
 *
 * In production (GitHub Pages + Render): VITE_API_URL is the full Render URL
 * (e.g. https://foo.onrender.com). REST calls go directly there; WebSocket
 * swaps the scheme to wss://.
 */

const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;

/**
 * Base URL for REST calls — no trailing slash.
 *
 * Dev:  `/api`  → proxied by Vite to localhost:3001 (strips the /api prefix).
 * Prod: `https://foo.onrender.com`
 */
export const apiBase: string = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : '/api';

/**
 * Base URL for the WebSocket connection — no trailing slash.
 *
 * Dev:  `ws://<window.location.host>`  → proxied by Vite to ws://localhost:3001.
 * Prod: derived from VITE_API_URL with http(s) swapped to ws(s).
 */
export const wsBase: string = rawApiUrl
  ? rawApiUrl
      .replace(/^https/, 'wss')
      .replace(/^http/, 'ws')
      .replace(/\/$/, '')
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
