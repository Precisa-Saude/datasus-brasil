import { Link, NavLink } from 'react-router-dom';

import { cn } from '@/lib/utils';

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'text-sm font-medium transition-colors hover:text-foreground',
    isActive ? 'text-foreground' : 'text-muted-foreground',
  );

export function Nav() {
  return (
    <header className="border-border bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link className="font-sans text-base font-semibold" to="/">
          datasus-brasil
        </Link>
        <div className="flex items-center gap-6">
          <NavLink className={linkClass} end to="/">
            Mapa
          </NavLink>
          <NavLink className={linkClass} to="/sobre">
            Sobre
          </NavLink>
          <a
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
            href="https://github.com/Precisa-Saude/datasus-brasil"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}
