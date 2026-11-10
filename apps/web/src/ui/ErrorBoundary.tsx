import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Lo que se enseña si algo de dentro falla (con el mensaje del error). */
  fallback: (message: string) => ReactNode;
  children: ReactNode;
}

/** Un fallo al pintar no deja la página en blanco: se ve un mensaje en su lugar. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    return this.state.error ? this.props.fallback(this.state.error.message) : this.props.children;
  }
}
