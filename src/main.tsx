import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { detectServer, loadServerData } from './lib/api';
import type { Backend } from './state/store';
import './index.css';

const root = createRoot(document.getElementById('root')!);

async function boot() {
  // Use the local server (and its storage folder) when it is running; otherwise keep data in this browser.
  const info = await detectServer();
  let backend: Backend = { mode: 'browser' };
  let serverData: unknown = null;
  if (info) {
    try {
      serverData = await loadServerData();
      backend = { mode: 'server', storage: info.storage };
    } catch (e) {
      console.error('Server found but data could not be loaded; using browser storage.', e);
    }
  }
  root.render(
    <StrictMode>
      <App backend={backend} serverData={serverData} />
    </StrictMode>,
  );
}

boot();
