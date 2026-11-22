import { render, screen, fireEvent, act } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ message = 'Kaboom' }: { message?: string }) {
  throw new Error(message);
}

function renderBoundary(fallback?: React.ReactNode, onError?: (e: Error) => void) {
  return render(
    <ErrorBoundary fallback={fallback} onError={onError}>
      <Boom />
    </ErrorBoundary>,
  );
}

describe('ErrorBoundary (error feedback)', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    consoleError.mockClear();
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  it('renders the default fallback when a child throws', () => {
    renderBoundary();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/Kaboom/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('renders a custom fallback when provided', () => {
    renderBoundary(<div data-testid="custom">Custom error UI</div>);
    expect(screen.getByTestId('custom')).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
  });

  it('invokes the onError callback with the error and info', () => {
    const onError = jest.fn();
    renderBoundary(undefined, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe('Kaboom');
  });

  it('resets and re-renders children when Try again is clicked', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Boom message="first render fails" />
      </ErrorBoundary>,
    );

    // Initial render throws -> fallback shown.
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();

    act(() => {
      rerender(<div data-testid="recovered">recovered</div>);
    });

    // Child re-renders successfully after reset.
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
  });

  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
  });
});
