'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type PullToRefreshOptions = {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  enabled?: boolean;
};

type PullToRefreshState = {
  isPulling: boolean;
  isRefreshing: boolean;
  pullDistance: number;
};

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  enabled = true,
}: PullToRefreshOptions): PullToRefreshState {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const startY = useRef(0);
  const containerRef = useRef<HTMLElement | null>(null);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled || isRefreshing) return;

      // Only trigger when scrolled to top
      const target = e.target as HTMLElement;
      const scrollContainer = target.closest(
        '[data-pull-container]',
      ) as HTMLElement | null;
      if (scrollContainer && scrollContainer.scrollTop > 0) return;
      if (!scrollContainer && window.scrollY > 0) return;

      startY.current = e.touches[0]?.clientY ?? 0;
      setIsPulling(true);
    },
    [enabled, isRefreshing],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isPulling || !enabled || isRefreshing) return;

      const currentY = e.touches[0]?.clientY ?? 0;
      const diff = currentY - startY.current;

      // Only track downward pulls
      if (diff > 0) {
        // Apply resistance
        const resistance = 0.5;
        const distance = Math.min(diff * resistance, threshold * 1.5);
        setPullDistance(distance);
      }
    },
    [isPulling, enabled, isRefreshing, threshold],
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling) return;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }

    setIsPulling(false);
  }, [isPulling, pullDistance, threshold, isRefreshing, onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const container = document.querySelector(
      '[data-pull-container]',
    ) as HTMLElement | null;
    containerRef.current = container;

    const target = container ?? document;

    target.addEventListener('touchstart', handleTouchStart as EventListener, {
      passive: true,
    });
    target.addEventListener('touchmove', handleTouchMove as EventListener, {
      passive: true,
    });
    target.addEventListener('touchend', handleTouchEnd as EventListener);

    return () => {
      target.removeEventListener(
        'touchstart',
        handleTouchStart as EventListener,
      );
      target.removeEventListener('touchmove', handleTouchMove as EventListener);
      target.removeEventListener('touchend', handleTouchEnd as EventListener);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { isPulling, isRefreshing, pullDistance };
}

// Visual indicator component
export function PullIndicator({
  isPulling,
  isRefreshing,
  pullDistance,
  threshold = 80,
}: {
  isPulling: boolean;
  isRefreshing: boolean;
  pullDistance: number;
  threshold?: number;
}) {
  if (!isPulling && !isRefreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = progress * 360;

  return (
    <div
      className="fixed left-1/2 z-50 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-surface2 shadow-lg transition-transform"
      style={{
        top: `${Math.min(pullDistance - 20, 60)}px`,
        opacity: isPulling || isRefreshing ? 1 : 0,
      }}
    >
      {isRefreshing ? (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accentCyan border-t-transparent" />
      ) : (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-accentCyan transition-transform"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <path d="M12 5v14M5 12l7-7 7 7" />
        </svg>
      )}
    </div>
  );
}
