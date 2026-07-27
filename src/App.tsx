import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LaunchRouter } from './components/LaunchRouter';
import { Shelf } from './screens/Shelf';
import { BookView } from './screens/BookView';
import { SearchView } from './screens/SearchView';
import { SettingsView } from './screens/SettingsView';

/**
 * HashRouter, not BrowserRouter.
 *
 * GitHub Pages has no server-side rewrite, so a deep path like /knightshelf/book/xyz
 * 404s on refresh or when opened from a home-screen shortcut. Hash routing sidesteps
 * that entirely — which matters most for the installed PWA, where a 404 is fatal.
 */
export function App() {
  return (
    <HashRouter>
      <LaunchRouter />
      <AppShell>
        <Routes>
          <Route path="/" element={<Shelf />} />
          <Route path="/book/:bookId" element={<BookView />} />
          <Route path="/search" element={<SearchView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
