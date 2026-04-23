import { Route, Routes } from 'react-router-dom';

import { Footer } from './components/Footer';
import { Nav } from './components/Nav';
import Home from './pages/Home';
import Sobre from './pages/Sobre';

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="flex-1">
        <Routes>
          <Route element={<Home />} path="/" />
          <Route element={<Sobre />} path="/sobre" />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
