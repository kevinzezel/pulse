'use client';

import { Loader, RefreshCw, Globe, Wifi, WifiOff } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { SERVER_HEALTH_STATUS } from '@/providers/ServerHealthProvider';

function StatusIcon({ status }) {
  switch (status) {
    case SERVER_HEALTH_STATUS.ONLINE:
      return <Wifi size={11} className="text-success flex-shrink-0" />;
    case SERVER_HEALTH_STATUS.OFFLINE:
      return <WifiOff size={11} className="text-destructive flex-shrink-0" />;
    case SERVER_HEALTH_STATUS.AWAITING_MANUAL_RETRY:
      return <WifiOff size={11} className="text-destructive flex-shrink-0" />;
    case SERVER_HEALTH_STATUS.CHECKING:
      return <Loader size={11} className="animate-spin text-muted-foreground flex-shrink-0" />;
    default:
      return <Wifi size={11} className="text-muted-foreground/60 flex-shrink-0" />;
  }
}

function statusChipClass(active) {
  return active
    ? 'border-primary/50 bg-primary/15 text-primary'
    : 'border-border bg-card text-foreground hover:bg-muted/40';
}

export default function ServerFilterBar({
  servers = [],
  sessions = [],
  selectedServerId = null,
  onSelectServer,
  serverHealthById = {},
  onRetryServer,
}) {
  const { t } = useTranslation();
  if (servers.length === 0) return null;

  const counts = new Map();
  for (const s of sessions) {
    counts.set(s.server_id, (counts.get(s.server_id) || 0) + 1);
  }
  const totalCount = sessions.length;

  return (
    <div
      className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto border-b"
      style={{
        background: 'hsl(var(--sidebar-bg))',
        borderColor: 'hsl(var(--sidebar-border))',
        scrollbarWidth: 'thin',
      }}
    >
      <button
        type="button"
        onClick={() => onSelectServer?.(null)}
        title={t('serverFilter.all')}
        className={`flex-shrink-0 flex items-center gap-1.5 pl-2.5 pr-2 h-7 rounded-full border text-xs transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          !selectedServerId
            ? 'border-primary/50 bg-primary/15 text-primary'
            : 'border-border bg-card text-foreground hover:bg-muted/40'
        }`}
      >
        <Globe size={11} className={!selectedServerId ? 'text-primary' : 'text-muted-foreground'} />
        <span>{t('serverFilter.all')}</span>
        <span
          className={`text-[10px] px-1 rounded ${
            !selectedServerId ? 'text-primary/80 bg-primary/10' : 'text-muted-foreground bg-muted/40'
          }`}
        >
          {totalCount}
        </span>
      </button>

      {servers.map((srv) => {
        const isActive = selectedServerId === srv.id;
        const health = serverHealthById[srv.id] || { status: SERVER_HEALTH_STATUS.UNKNOWN };
        const count = counts.get(srv.id) || 0;
        const isOffline =
          health.status === SERVER_HEALTH_STATUS.OFFLINE ||
          health.status === SERVER_HEALTH_STATUS.AWAITING_MANUAL_RETRY;
        const canRetry = health.status === SERVER_HEALTH_STATUS.AWAITING_MANUAL_RETRY;
        const reasonKey = isOffline && health.reason ? `serverFilter.reason.${health.reason}` : null;
        const baseLabel = srv.name || `${srv.host}:${srv.port}`;
        const tooltip = reasonKey ? `${baseLabel} — ${t(reasonKey)}` : baseLabel;

        return (
          <div
            key={srv.id}
            className={`flex-shrink-0 flex items-center pl-2.5 pr-1 h-7 rounded-full border text-xs transition-colors select-none ${statusChipClass(isActive)}`}
          >
            <button
              type="button"
              onClick={() => onSelectServer?.(srv.id)}
              title={tooltip}
              className="flex items-center gap-1.5 pr-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
            >
              <StatusIcon status={health.status} />
              <span className="truncate max-w-[140px]">{baseLabel}</span>
              <span
                className={`text-[10px] px-1 rounded ${
                  isActive ? 'text-primary/80 bg-primary/10' : 'text-muted-foreground bg-muted/40'
                }`}
              >
                {count}
              </span>
            </button>
            {canRetry && onRetryServer && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryServer(srv.id);
                }}
                title={t('serverFilter.retry')}
                aria-label={t('serverFilter.retry')}
                className="ml-0.5 p-1 rounded-full text-muted-foreground hover:text-primary hover:bg-muted/60"
              >
                <RefreshCw size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
