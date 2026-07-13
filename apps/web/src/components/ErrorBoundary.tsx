import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * App-wide safety net. Without this, any render error (e.g. a server/client
 * schema mismatch during a partial redeploy) unmounts the whole tree and leaves
 * a blank dark screen. Here we catch it and show a recoverable message instead —
 * a judge should never stare at an empty background.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[filobot] render error caught by boundary:", error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-xl font-bold text-foreground">
            Something broke while rendering
            <span className="mt-1 block text-sm font-normal text-muted-foreground">
              Algo falló al renderizar el dashboard
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            The live stream may be sending data in an unexpected shape (often a
            server/client version mismatch after a deploy). Reloading usually
            fixes it once both sides are on the same version.
          </p>
          <pre className="max-h-32 overflow-auto rounded-md border border-border bg-card/60 p-2 text-left text-[11px] text-loss">
            {error.message}
          </pre>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:scale-105"
        >
          <RefreshCw className="h-4 w-4" />
          Reload
        </button>
      </div>
    );
  }
}
