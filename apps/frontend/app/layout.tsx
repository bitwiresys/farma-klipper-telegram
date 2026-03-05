import './globals.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';

import { ClientRoot } from './components/ClientRoot';

export const metadata: Metadata = {
  title: 'Farma',
  description: 'Telegram Mini App for Klipper/Moonraker',
  manifest: '/manifest.json',
  themeColor: '#20d3c2',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Farma',
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body
        className="min-h-screen bg-bg font-sans text-textPrimary"
        data-app-version={process.env.NEXT_PUBLIC_APP_VERSION ?? ''}
      >
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  );
}
