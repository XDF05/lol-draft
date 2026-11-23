import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from './Toast';

function ToastHarness() {
  const { toast } = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast({ title: 'Save failed' })}>
        add toast
      </button>
      <button
        type="button"
        onClick={() => toast({ title: 'Persist', duration: 0 })}
      >
        add persistent toast
      </button>
    </div>
  );
}

function renderToast() {
  return render(
    <ToastProvider>
      <ToastHarness />
    </ToastProvider>,
  );
}

describe('Toast (error feedback)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders no toasts initially', () => {
    renderToast();
    expect(screen.queryByText(/Save failed/)).not.toBeInTheDocument();
  });

  it('adds a toast when toast() is called', () => {
    renderToast();
    fireEvent.click(screen.getByRole('button', { name: /add toast/i }));
    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });

  it('auto-dismisses a toast after its duration (default 4s)', () => {
    renderToast();
    fireEvent.click(screen.getByRole('button', { name: /add toast/i }));
    expect(screen.getByText('Save failed')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.queryByText(/Save failed/)).not.toBeInTheDocument();
  });

  it('does not auto-dismiss a toast with duration 0', () => {
    renderToast();
    fireEvent.click(
      screen.getByRole('button', { name: /add persistent toast/i }),
    );
    expect(screen.getByText('Persist')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(screen.getByText('Persist')).toBeInTheDocument();
  });
});
