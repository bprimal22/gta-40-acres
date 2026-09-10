import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UT Austin | Campus Explorer',
  description:
    'A third-person exploration of the University of Texas at Austin. Campus reconstruction in development.',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
