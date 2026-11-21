import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../components/common/Toast';
import ThemeToggle from '../components/common/ThemeToggle';

export const metadata: Metadata = {
  title: 'LoL Draft Strategy Board',
  description: 'Real-time League of Legends 1v1 draft strategy board',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Apply a saved theme before the browser paints the first frame. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('lol-draft-theme');if(t!=='dark'&&t!=='light')t='light';document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','light')}})()",
          }}
        />
      </head>
      <body>
        <AuthProvider>
          <ThemeProvider>
            <ToastProvider>
              {children}
              <ThemeToggle />
            </ToastProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
