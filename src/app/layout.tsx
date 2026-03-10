import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SirReel Fleet Hub',
  description: 'Production vehicle fleet management platform',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-sirreel-bg text-sirreel-text antialiased">
        {children}
      </body>
    </html>
  );
}
