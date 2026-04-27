'use client';

import { Wifi, WifiOff } from 'lucide-react';
import { SERVER_HEALTH_STATUS } from '@/providers/ServerHealthProvider';

export default function ServerTag({ name, size = 'xs', status = SERVER_HEALTH_STATUS.UNKNOWN }) {
  if (!name) return null;
  const textSize = size === 'xs' ? 'text-[9px]' : 'text-[10px]';
  const icon = status === SERVER_HEALTH_STATUS.OFFLINE
    ? <WifiOff size={9} className="text-destructive flex-shrink-0" />
    : status === SERVER_HEALTH_STATUS.ONLINE
      ? <Wifi size={9} className="text-success flex-shrink-0" />
      : null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted/40 text-muted-foreground ${textSize} font-medium flex-shrink-0`}
      title={name}
    >
      {icon}
      <span className="truncate max-w-[80px]">{name}</span>
    </span>
  );
}
