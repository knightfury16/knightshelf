import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted so the app renders correctly with no connection.
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
// The opsz axis is the point of Newsreader: letterforms firm up at small sizes
// and refine at display sizes, which is exactly what a dictionary page needs.
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';

import './index.css';
import { App } from './App';
import { installTapHaptics } from './lib/haptics';
import { LibraryProvider } from './state/LibraryProvider';
import { SyncProvider } from './state/SyncProvider';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html.');

/**
 * Outside React on purpose: it belongs to the document for the app's whole lifetime, and
 * an effect would attach it twice under StrictMode.
 */
installTapHaptics();

createRoot(container).render(
  <StrictMode>
    {/* SyncProvider sits inside, so it can reload the library after a merge. */}
    <LibraryProvider>
      <SyncProvider>
        <App />
      </SyncProvider>
    </LibraryProvider>
  </StrictMode>,
);
