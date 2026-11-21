'use client';

import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Children rendered while there is no error. */
  children: ReactNode;
  /** Optional custom fallback rendered while an error is active. */
  fallback?: ReactNode;
  /** Optional callback invoked when an error is captured. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Client-side error boundary (T-017).
 *
 * Captures React render errors in the draft UI so a single broken component
 * does not blank the whole page. Renders a fallback with a "Try again"
 * button that resets the boundary and re-renders the children.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught UI error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const fallback = this.props.fallback ?? (
        <div
          style={{
            maxWidth: '34rem',
            margin: '3rem auto',
            padding: '1.5rem',
            textAlign: 'center',
          }}
        >
          <h2 style={{ margin: '0 0 0.5rem' }}>Something went wrong</h2>
          <p className="muted" style={{ margin: '0 0 1rem' }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button type="button" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
      return <>{fallback}</>;
    }
    return this.props.children;
  }
}
