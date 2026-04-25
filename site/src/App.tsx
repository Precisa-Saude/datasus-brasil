import { GridOverlay } from '@precisa-saude/ui/decorative';
import { Route, Routes, useLocation } from 'react-router-dom';

import { ErrorBoundary } from './components/ErrorBoundary';
import { Footer } from './components/Footer';
import { Nav } from './components/Nav';
import Home from './pages/Home';
import Sobre from './pages/Sobre';

export default function App() {
  // O mapa ocupa a tela inteira em /, então o footer só faz sentido nas
  // páginas de conteúdo (ex.: /sobre).
  const isMapRoute = useLocation().pathname === '/';
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <GridOverlay enabled={import.meta.env.DEV} />
      <main className="flex flex-1 flex-col">
        <ErrorBoundary>
          <Routes>
            <Route element={<Home />} path="/" />
            <Route element={<Sobre />} path="/sobre" />
          </Routes>
        </ErrorBoundary>
      </main>
      {!isMapRoute ? <Footer /> : null}
    </div>
  );
}
