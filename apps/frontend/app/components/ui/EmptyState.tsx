import type { ReactNode } from 'react';

import { Card } from './Card';
import { Button } from './Button';

export function EmptyState({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Card>
      <div className="text-sm font-medium text-textPrimary">{title}</div>
      <div className="mt-1 text-xs text-textSecondary">{subtitle}</div>
      <Button className="mt-3 w-full" variant="primary" onClick={onAction}>
        {actionLabel}
      </Button>
    </Card>
  );
}
