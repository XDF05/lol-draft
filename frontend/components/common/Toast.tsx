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

  const value = useMemo(
    () => ({ toast, dismiss }),
    [toast, dismiss],
  );

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

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  top: '1rem',
  right: '1rem',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  pointerEvents: 'none',
};

const toastStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.75rem',
  padding: '0.75rem 1rem',
  borderRadius: '0.5rem',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  minWidth: '260px',
  pointerEvents: 'auto',
  fontSize: '0.875rem',
  lineHeight: '1.4',
  background: '#ffffff',
  border: '1px solid #e2e8f0',
};

const titleStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#0f172a',
  margin: 0,
};

const descriptionStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: '#475569',
  margin: '0.25rem 0 0',
};

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div style={containerStyle}>
      {toasts.map((t) => (
        <div key={t.id} style={toastStyle}>
          <p style={titleStyle}>{t.title}</p>
          {t.description && <p style={descriptionStyle}>{t.description}</p>}
        </div>
      ))}
    </div>
  );
}
