import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Captura exceções de render dos descendentes pra não deixar o app
 * inteiro virar tela branca. Mostra a mensagem do erro + instrução
 * mínima.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="bg-background flex min-h-screen items-center justify-center p-6">
          <div className="border-destructive/30 bg-destructive/5 text-destructive max-w-xl space-y-2 rounded-lg border p-5 font-margem text-sm">
            <p className="font-semibold">Algo quebrou na renderização do mapa.</p>
            <p className="text-xs">{this.state.error.message}</p>
            <p className="text-muted-foreground text-xs">
              Abre o console do browser pra ver o stack trace. Recarregar (F5) muitas vezes resolve
              quando é transitório (ex. DuckDB WASM ainda carregando assets).
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
