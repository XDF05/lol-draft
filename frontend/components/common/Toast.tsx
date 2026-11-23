'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (options: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

/**
 * App-wide toast notifications (T-018, task 144).
 *
 * Provides a `useToast()` hook plus an auto-placed container. Toasts render
 * in the top-right corner, dismiss themselves after `duration` ms (default
 * 4s), and can be dismissed manually. No external UI library is used —
 * inline styles mirror the rest of the frontend.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(
    ({ title, description, duration = 4000 }: Omit<Toast, 'id'>) => {
      const id = String(++nextId);
      setToasts((prev) => [...prev, { id, title, description, duration }]);
      if (duration > 0) {
        setTimeout(
          () => setToasts((prev) => prev.filter((t) => t.id !== id)),
          duration,
        );
      }
    },
    [],
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <p className="toast-title">{t.title}</p>
          {t.description && (
            <p className="toast-description">{t.description}</p>
          )}
          <button
            type="button"
            className="toast-dismiss"
            aria-label={`Dismiss ${t.title}`}
            onClick={() => onDismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
