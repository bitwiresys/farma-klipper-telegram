'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { PrinterDto, PresetDto, PrintHistoryDto } from './dto';
import {
  addToSyncQueue,
  clearSyncQueue,
  getAllHistory,
  getAllPresets,
  getAllPrinters,
  getSyncQueue,
  removeFromSyncQueue,
  saveHistory,
  savePresets,
  savePrinters,
  type HistoryRow,
  type PresetRow,
  type PrinterRow,
  type SyncQueueItem,
} from './db';
import { useWs } from '../ws/ws_context';
import { useAuth } from '../auth/auth_context';

type OfflineState = {
  isOnline: boolean;
  lastSyncAt: number | null;
  pendingOperations: number;
  isSyncing: boolean;
};

type OfflineSyncContext = OfflineState & {
  syncNow: () => Promise<void>;
  clearCache: () => Promise<void>;
};

// Convert DTOs to DB rows
function presetToRow(p: PresetDto): PresetRow {
  return {
    id: p.id,
    title: p.title,
    plasticType: p.plasticType,
    colorHex: p.colorHex,
    description: p.description ?? null,
    thumbnailUrl: p.thumbnailUrl ?? null,
    gcodeMeta: p.gcodeMeta ?? null,
    compatibilityRules: p.compatibilityRules ?? null,
    _updatedAt: Date.now(),
  };
}

function printerToRow(p: PrinterDto): PrinterRow {
  return {
    id: p.id,
    displayName: p.displayName,
    modelId: p.modelId,
    modelName: p.modelName,
    bedX: p.bedX,
    bedY: p.bedY,
    bedZ: p.bedZ,
    nozzleDiameter: p.nozzleDiameter,
    needsRekey: p.needsRekey,
    snapshot: p.snapshot,
    _updatedAt: Date.now(),
  };
}

function historyToRow(h: PrintHistoryDto): HistoryRow {
  return {
    id: h.id,
    printerId: h.printerId,
    filename: h.filename,
    status: h.status,
    thumbnailUrl: h.thumbnailUrl ?? null,
    startedAt: h.startedAt,
    endedAt: h.endedAt ?? null,
    printDurationSec: h.printDurationSec ?? null,
    totalDurationSec: h.totalDurationSec ?? null,
    filamentUsedMm: h.filamentUsedMm ?? null,
    errorMessage: h.errorMessage ?? null,
    _updatedAt: Date.now(),
  };
}

// Global state for offline sync
let globalOfflineState: OfflineState = {
  isOnline: true,
  lastSyncAt: null,
  pendingOperations: 0,
  isSyncing: false,
};

const listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}

function setOfflineState(partial: Partial<OfflineState>) {
  globalOfflineState = { ...globalOfflineState, ...partial };
  notifyListeners();
}

export function useOfflineSync(): OfflineSyncContext {
  const ws = useWs();
  const { token } = useAuth();
  const [state, setState] = useState<OfflineState>(globalOfflineState);

  // Subscribe to global state changes
  useEffect(() => {
    listeners.add(() => setState({ ...globalOfflineState }));
    return () => {
      listeners.delete(() => setState({ ...globalOfflineState }));
    };
  }, []);

  // Track online status
  useEffect(() => {
    const handleOnline = () => {
      setOfflineState({ isOnline: true });
    };
    const handleOffline = () => {
      setOfflineState({ isOnline: false });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    setOfflineState({ isOnline: navigator.onLine });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Subscribe to WS events and cache data
  useEffect(() => {
    if (!token) return;

    return ws.subscribe((ev) => {
      const e = ev as any;

      if (e.type === 'PRINTERS_SNAPSHOT') {
        const printers = (e.payload?.printers as PrinterDto[] | undefined) ?? [];
        void savePrinters(printers.map(printerToRow));
        setOfflineState({ lastSyncAt: Date.now() });
      }

      if (e.type === 'PRINTER_STATUS') {
        const p = e.payload?.printer as PrinterDto | undefined;
        if (p) {
          void savePrinters([printerToRow(p)]);
        }
      }

      if (e.type === 'PRESETS_SNAPSHOT') {
        const presets = (e.payload?.presets as PresetDto[] | undefined) ?? [];
        void savePresets(presets.map(presetToRow));
        setOfflineState({ lastSyncAt: Date.now() });
      }

      if (e.type === 'HISTORY_SNAPSHOT') {
        const history = (e.payload?.history as PrintHistoryDto[] | undefined) ?? [];
        void saveHistory(history.map(historyToRow));
        setOfflineState({ lastSyncAt: Date.now() });
      }

      if (e.type === 'HISTORY_EVENT') {
        const h = e.payload?.history as PrintHistoryDto | undefined;
        if (h) {
          void saveHistory([historyToRow(h)]);
        }
      }
    });
  }, [token, ws]);

  // Process sync queue when coming online
  const processSyncQueue = useCallback(async () => {
    if (!token) return;

    const queue = await getSyncQueue();
    if (queue.length === 0) return;

    setOfflineState({ isSyncing: true });

    for (const item of queue) {
      try {
        // TODO: Implement actual sync based on item.type and item.entity
        // For now, just remove from queue
        await removeFromSyncQueue(item.id);
      } catch {
        // Increment retry count
        item.retries++;
        if (item.retries < 3) {
          await addToSyncQueue(item);
        }
      }
    }

    const remaining = await getSyncQueue();
    setOfflineState({
      pendingOperations: remaining.length,
      isSyncing: false,
    });
  }, [token]);

  // Auto-sync when coming online
  useEffect(() => {
    if (state.isOnline && state.pendingOperations > 0 && !state.isSyncing) {
      void processSyncQueue();
    }
  }, [state.isOnline, state.pendingOperations, state.isSyncing, processSyncQueue]);

  // Update pending operations count
  useEffect(() => {
    void (async () => {
      const queue = await getSyncQueue();
      setOfflineState({ pendingOperations: queue.length });
    })();
  }, []);

  const syncNow = useCallback(async () => {
    if (!state.isOnline) return;
    await processSyncQueue();
  }, [state.isOnline, processSyncQueue]);

  const clearCache = useCallback(async () => {
    const { clearAllData } = await import('./db');
    await clearAllData();
    await clearSyncQueue();
    setOfflineState({ lastSyncAt: null, pendingOperations: 0 });
  }, []);

  return {
    ...state,
    syncNow,
    clearCache,
  };
}

// Hook to get cached data for offline use
export function useCachedPresets(): {
  presets: PresetRow[];
  loading: boolean;
} {
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const cached = await getAllPresets();
        setPresets(cached);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { presets, loading };
}

export function useCachedPrinters(): {
  printers: PrinterRow[];
  loading: boolean;
} {
  const [printers, setPrinters] = useState<PrinterRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const cached = await getAllPrinters();
        setPrinters(cached);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { printers, loading };
}

export function useCachedHistory(): {
  history: HistoryRow[];
  loading: boolean;
} {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const cached = await getAllHistory();
        setHistory(cached.sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { history, loading };
}
