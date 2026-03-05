'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from './api';
import { useAuth } from '../auth/auth_context';

type PushSubscriptionInfo = {
  id: string;
  endpoint: string;
  createdAt: string;
};

type PushState = {
  isSupported: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission | null;
  subscriptions: PushSubscriptionInfo[];
  publicKey: string | null;
  loading: boolean;
  error: string | null;
};

type PushContext = PushState & {
  subscribe: () => Promise<void>;
  unsubscribe: (endpoint?: string) => Promise<void>;
  requestPermission: () => Promise<boolean>;
};

export function usePush(): PushContext {
  const { token } = useAuth();
  const [state, setState] = useState<PushState>({
    isSupported: false,
    isSubscribed: false,
    permission: null,
    subscriptions: [],
    publicKey: null,
    loading: false,
    error: null,
  });

  // Check support and load initial state
  useEffect(() => {
    const isSupported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window;

    setState((s) => ({ ...s, isSupported }));

    if (!isSupported || !token) return;

    // Load VAPID public key
    void (async () => {
      try {
        const res = await apiRequest<{ publicKey: string }>('/api/push/vapid');
        setState((s) => ({ ...s, publicKey: res.publicKey }));
      } catch {
        // Push not configured on server
        setState((s) => ({ ...s, publicKey: null }));
      }
    })();

    // Check permission
    if ('Notification' in window) {
      setState((s) => ({ ...s, permission: Notification.permission }));
    }

    // Load existing subscriptions
    void loadSubscriptions();
  }, [token]);

  const loadSubscriptions = async () => {
    if (!token) return;
    try {
      const res = await apiRequest<{ subscriptions: PushSubscriptionInfo[] }>(
        '/api/push/subscriptions',
      );
      setState((s) => ({
        ...s,
        subscriptions: res.subscriptions,
        isSubscribed: res.subscriptions.length > 0,
      }));
    } catch {
      // ignore
    }
  };

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) return false;

    const permission = await Notification.requestPermission();
    setState((s) => ({ ...s, permission }));
    return permission === 'granted';
  }, []);

  const subscribe = useCallback(async () => {
    if (!token || !state.publicKey) {
      setState((s) => ({ ...s, error: 'Push not available' }));
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      // Request permission if needed
      if (state.permission !== 'granted') {
        const granted = await requestPermission();
        if (!granted) {
          setState((s) => ({
            ...s,
            loading: false,
            error: 'Permission denied',
          }));
          return;
        }
      }

      // Register service worker
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          state.publicKey,
        ) as BufferSource,
      });

      // Send subscription to server
      await apiRequest('/api/push/subscribe', {
        token,
        method: 'POST',
        body: {
          subscription: subscription.toJSON(),
        },
      });

      await loadSubscriptions();
      setState((s) => ({ ...s, loading: false, isSubscribed: true }));
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to subscribe',
      }));
    }
  }, [token, state.publicKey, state.permission, requestPermission]);

  const unsubscribe = useCallback(
    async (endpoint?: string) => {
      if (!token) return;

      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        await apiRequest('/api/push/unsubscribe', {
          token,
          method: 'POST',
          body: endpoint ? { endpoint } : {},
        });

        // Also unsubscribe from browser
        if (!endpoint) {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await subscription.unsubscribe();
          }
        }

        await loadSubscriptions();
        setState((s) => ({ ...s, loading: false, isSubscribed: false }));
      } catch (e) {
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : 'Failed to unsubscribe',
        }));
      }
    },
    [token],
  );

  return {
    ...state,
    subscribe,
    unsubscribe,
    requestPermission,
  };
}

// Helper to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
