import type { CSSProperties } from 'react';

type SkeletonProps = {
  className?: string;
  style?: CSSProperties;
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'rect' | 'circle';
  animation?: 'pulse' | 'wave' | 'none';
};

export function Skeleton({
  className = '',
  style,
  width,
  height,
  variant = 'rect',
  animation = 'pulse',
}: SkeletonProps) {
  const baseClasses = 'bg-surface2/70';

  const variantClasses = {
    text: 'rounded-sm',
    rect: 'rounded-btn',
    circle: 'rounded-full',
  };

  const animationClasses = {
    pulse: 'animate-pulse',
    wave: 'skeleton-wave',
    none: '',
  };

  const inlineStyle: CSSProperties = {
    width: width ?? (variant === 'text' ? '100%' : undefined),
    height: height ?? (variant === 'text' ? '1em' : undefined),
    ...style,
  };

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${animationClasses[animation]} ${className}`}
      style={inlineStyle}
    />
  );
}

// Preset skeleton for card loading
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-card border border-border/45 bg-surface p-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        <Skeleton width={36} height={36} variant="rect" />
        <div className="flex-1 space-y-2">
          <Skeleton width="60%" height={14} variant="text" />
          <Skeleton width="40%" height={10} variant="text" />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Skeleton height={8} variant="rect" className="rounded-full" />
        <div className="flex justify-between">
          <Skeleton width={60} height={10} variant="text" />
          <Skeleton width={40} height={10} variant="text" />
        </div>
      </div>
    </div>
  );
}

// Preset skeleton for list item
export function SkeletonListItem({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 p-2 ${className}`}>
      <Skeleton width={36} height={36} variant="rect" />
      <div className="flex-1 space-y-1">
        <Skeleton width="70%" height={12} variant="text" />
        <Skeleton width="50%" height={10} variant="text" />
      </div>
      <Skeleton width={50} height={24} variant="rect" />
    </div>
  );
}

// Preset skeleton for history item
export function SkeletonHistoryItem({
  className = '',
}: {
  className?: string;
}) {
  return (
    <div
      className={`rounded-btn border border-border/45 bg-surface p-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        <Skeleton width={36} height={36} variant="rect" />
        <div className="flex-1 space-y-1">
          <Skeleton width="80%" height={14} variant="text" />
          <Skeleton width="60%" height={10} variant="text" />
          <div className="mt-2 flex justify-between">
            <Skeleton width={80} height={10} variant="text" />
            <Skeleton width={40} height={10} variant="text" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Multiple skeletons for loading states
export function SkeletonGroup({
  count = 3,
  skeleton: SkeletonComponent,
  className = '',
}: {
  count?: number;
  skeleton: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonComponent key={i} />
      ))}
    </div>
  );
}
