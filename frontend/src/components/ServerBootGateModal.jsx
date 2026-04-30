import { Loader, RefreshCw, Settings as SettingsIcon, X } from 'lucide-react';

// Modal that gates the dashboard while servers are being probed on boot. The
// component is split out from the page module so it can be rendered in unit
// tests without dragging the entire dashboard tree along. Three buttons are
// shown when every server failed to respond: retry, open settings (the user
// usually needs to fix protocol/host/port/key here), and a soft dismiss that
// drops the gate so the dashboard chrome (Header + nav) remains usable even
// while no terminals are reachable. Without the dismiss button, users with a
// single offline client got stuck on this modal until the network recovered.
export default function ServerBootGateModal({ gate, t, onRetry, onOpenSettings, onDismiss }) {
  if (!gate.visible) return null;
  const allFailed = gate.checked && gate.total > 0 && gate.onlineCount === 0;
  const title = allFailed ? t('serverBoot.allOfflineTitle') : t('serverBoot.checkingTitle');
  const body = allFailed ? t('serverBoot.allOfflineBody') : t('serverBoot.checkingBody');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
            <Loader size={18} className={`text-primary ${gate.checking ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{body}</p>
          </div>
        </div>

        {gate.results.length > 0 && (
          <div className="mt-4 max-h-36 overflow-y-auto rounded-md border border-border bg-background/40">
            {gate.results.map((item) => {
              const reasonKey = item.reason ? `serverFilter.reason.${item.reason}` : null;
              const checking = item.status === 'checking';
              return (
                <div key={item.serverId} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="truncate text-foreground">{item.name}</span>
                  <span className={item.ok ? 'text-success' : 'text-muted-foreground'}>
                    {checking ? t('serverBoot.checkingStatus') : (item.ok ? t('serverBoot.online') : (reasonKey ? t(reasonKey) : t('serverBoot.offline')))}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {allFailed && (
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={onRetry}
              disabled={gate.checking}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {gate.checking ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {t('serverBoot.retry')}
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/40"
            >
              <SettingsIcon size={13} />
              {t('serverBoot.openSettings')}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <X size={13} />
              {t('serverBoot.dismiss')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
