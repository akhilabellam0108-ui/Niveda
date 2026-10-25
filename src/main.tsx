import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/features.css';
import { initLanguage } from './i18n';

// The interface language is loaded first; the app (and every label defined at module level)
// is imported only after it, so all text comes up in the chosen language.
async function start() {
  await initLanguage();
  const [{ default: App }, { initNativeAlarms }, { registerServiceWorker }] = await Promise.all([
    import('./App'),
    import('./lib/nativeAlarms'),
    import('./lib/webPush'),
  ]);
  // Android app: register the medicine-alarm buttons before anything else, so a
  // Taken / Snooze / Skip pressed while the app was closed is handled on launch.
  void initNativeAlarms().catch(() => undefined);
  // Website: installable as an app, opens offline, and receives pushed medicine reminders.
  registerServiceWorker();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
