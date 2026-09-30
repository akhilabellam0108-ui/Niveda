import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/features.css';
import { initNativeAlarms } from './lib/nativeAlarms';

// Android app: register the medicine-alarm buttons before anything else, so a
// Taken / Snooze / Skip pressed while the app was closed is handled on launch.
void initNativeAlarms().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
