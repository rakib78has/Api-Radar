import '../shared/zod-config.js';
import '../ui/styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Dashboard } from './Dashboard.js';

const root = document.getElementById('root');
if (root !== null) {
  const initialSession = new URLSearchParams(location.search).get('session');
  createRoot(root).render(
    <StrictMode>
      <Dashboard initialSessionId={initialSession} />
    </StrictMode>,
  );
}
