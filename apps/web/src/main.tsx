/**
 * Frontend entry point. Mounts the React app and imports the global
 * stylesheet (design tokens + base resets).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { App } from './App';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

// Single QueryClient shared by every hook. Defaults are tuned for a live
// dashboard: no aggressive retries, refetch-on-focus disabled.
// QueryCache.onError fires once per failed query (after retries) and pushes
// a toast — import is deferred to avoid a circular dep at module init time.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error) {
      void import('./stores/toasts').then(({ useToastStore }) => {
        const msg = error instanceof Error ? error.message : 'API request failed';
        useToastStore.getState().addToast(msg);
      });
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
