import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../components/common/Toast';

export const metadata: Metadata = {
  title: 'LoL Draft Strategy Board',
  description: 'Real-time League of Legends 1v1 draft strategy board',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
