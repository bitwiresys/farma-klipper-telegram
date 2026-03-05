import { useCallback, useMemo, useReducer } from 'react';

import { useWs } from '../ws/ws_context';

type Action<T> =
  | { type: 'SNAPSHOT'; items: T[] }
  | { type: 'UPDATE'; id: string; item: T }
  | { type: 'DELETE'; id: string }
  | { type: 'CLEAR' };

function getEntityId<T>(item: T): string {
  return (item as any).id;
}

function entityReducer<T>(state: Map<string, T>, action: Action<T>): Map<string, T> {
  switch (action.type) {
    case 'SNAPSHOT': {
      const next = new Map<string, T>();
      for (const item of action.items) {
        next.set(getEntityId(item), item);
      }
      return next;
    }
    case 'UPDATE': {
      const next = new Map(state);
      next.set(action.id, action.item);
      return next;
    }
    case 'DELETE': {
      const next = new Map(state);
      next.delete(action.id);
      return next;
    }
    case 'CLEAR': {
      return new Map();
    }
    default:
      return state;
  }
}

export type EntityMapConfig<T> = {
  snapshotEventType: string;
  updateEventType?: string;
  deleteEventType?: string;
  getSnapshotItems: (payload: any) => T[] | undefined;
  getUpdateItem?: (payload: any) => { id: string; item: T } | undefined;
  getDeleteId?: (payload: any) => string | undefined;
};

export function useEntityMap<T>(config: EntityMapConfig<T>): {
  map: Map<string, T>;
  list: T[];
  dispatch: React.Dispatch<Action<T>>;
  subscribe: () => () => void;
} {
  const ws = useWs();
  const [map, dispatch] = useReducer(entityReducer<T>, new Map());

  const subscribe = useCallback(() => {
    return ws.subscribe((ev) => {
      const e = ev as any;

      if (e.type === config.snapshotEventType) {
        const items = config.getSnapshotItems(e.payload);
        if (items) {
          dispatch({ type: 'SNAPSHOT', items });
        }
      }

      if (config.updateEventType && e.type === config.updateEventType) {
        if (config.getUpdateItem) {
          const result = config.getUpdateItem(e.payload);
          if (result) {
            dispatch({ type: 'UPDATE', id: result.id, item: result.item });
          }
        }
      }

      if (config.deleteEventType && e.type === config.deleteEventType) {
        if (config.getDeleteId) {
          const id = config.getDeleteId(e.payload);
          if (id) {
            dispatch({ type: 'DELETE', id });
          }
        }
      }
    });
  }, [ws, config]);

  const list = useMemo(() => Array.from(map.values()), [map]);

  return { map, list, dispatch, subscribe };
}

// Convenience hooks for common entities

import type { PrinterDto } from './dto';

export function usePrintersMap(): {
  printers: PrinterDto[];
  printersById: Map<string, PrinterDto>;
  subscribePrinters: () => () => void;
} {
  const { map, list, subscribe } = useEntityMap<PrinterDto>({
    snapshotEventType: 'PRINTERS_SNAPSHOT',
    updateEventType: 'PRINTER_STATUS',
    getSnapshotItems: (payload) => payload?.printers as PrinterDto[] | undefined,
    getUpdateItem: (payload) => {
      const p = payload?.printer as PrinterDto | undefined;
      if (!p) return undefined;
      return { id: p.id, item: p };
    },
  });

  return {
    printers: list,
    printersById: map,
    subscribePrinters: subscribe,
  };
}
