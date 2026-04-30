'use client';

import { Loader } from 'lucide-react';

export default function PageLoadingState({
  title,
  description,
  detail,
  className = '',
  icon: Icon = Loader,
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center ${className}`}
    >
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: 'hsl(var(--muted) / 0.4)' }}
      >
        <Icon size={26} className="text-primary animate-spin" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {detail && (
          <p className="mt-1 mx-auto max-w-[280px] truncate font-mono text-xs text-muted-foreground/80">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}
