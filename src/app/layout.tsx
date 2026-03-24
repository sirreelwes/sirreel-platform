import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SirReel Team HQ',
  description: 'Production vehicle fleet management platform',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
