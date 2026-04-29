import { GridOverlay } from '@precisa-saude/ui/decorative';
import { Route, Routes, useLocation } from 'react-router-dom';

import { ErrorBoundary } from './components/ErrorBoundary';
import { Footer } from './components/Footer';
import { Nav } from './components/Nav';
import Home from './pages/Home';
import Sobre from './pages/Sobre';
import Tendencias from './pages/Tendencias';

export default function App() {
  // O mapa ocupa a tela inteira em / (e nos drill-downs /uf/...), então
  // o footer só faz sentido nas páginas de conteúdo (ex.: /sobre).
  const { pathname } = useLocation();
  const isMapRoute = pathname === '/' || pathname.startsWith('/uf/');
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <GridOverlay enabled={import.meta.env.DEV} />
      <main className="flex flex-1 flex-col">
        <ErrorBoundary>
          <Routes>
            <Route element={<Home />} path="/" />
            <Route element={<Home />} path="/uf/:ufSigla" />
            <Route element={<Home />} path="/uf/:ufSigla/mun/:codigo" />
            <Route element={<Tendencias />} path="/tendencias" />
            <Route element={<Sobre />} path="/sobre" />
          </Routes>
        </ErrorBoundary>
      </main>
      {!isMapRoute ? <Footer /> : null}
    </div>
  );
}
