import './globals.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';

import { AuthProvider } from './auth/auth_context';

export const metadata: Metadata = {
  title: 'Farma',
  description: 'Telegram Mini App for Klipper/Moonraker',
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
        className="min-h-screen bg-slate-950 text-slate-50"
        data-app-version={process.env.NEXT_PUBLIC_APP_VERSION ?? ''}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
