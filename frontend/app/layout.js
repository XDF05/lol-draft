export const metadata = {
  title: 'LoL Draft Strategy Board',
  description: 'Real-time League of Legends 1v1 draft strategy board',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
