'use client';

import type { ReactNode } from 'react';

import { AppShell } from './AppShell';
import { AuthProvider } from '../auth/auth_context';
import { BootstrapGate } from './BootstrapGate';
import { WsProvider } from '../ws/ws_context';
import { useWs } from '../ws/ws_context';

function Shell({ children }: { children: ReactNode }) {
  const ws = useWs();
  return <AppShell wsStatus={ws.status}>{children}</AppShell>;
}

export function ClientRoot({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <WsProvider>
        <BootstrapGate>
          <Shell>{children}</Shell>
        </BootstrapGate>
      </WsProvider>
    </AuthProvider>
  );
}
