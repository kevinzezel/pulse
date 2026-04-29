'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { emitProjectEvent } from '@/providers/ProjectsProvider';
import { listBackends, moveProject } from '@/services/api';

export default function MoveProjectModal({ project, onClose, onMoved }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [busy, setBusy] = useState(false);
  const [allBackends, setAllBackends] = useState([]);
  const [target, setTarget] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loadingBackends, setLoadingBackends] = useState(true);

  const fromBackendId = project.storage_ref || 'local';

  useEffect(() => {
    let cancelled = false;
    setLoadingBackends(true);
    listBackends()
      .then((d) => {
        if (cancelled) return;
        const list = d.backends || [];
        setAllBackends(list);
        const opts = list.filter((b) => b.id !== fromBackendId);
        if (opts[0]) setTarget(opts[0].id);
      })
      .catch((err) => { if (!cancelled) showError(err); })
      .finally(() => { if (!cancelled) setLoadingBackends(false); });
    return () => { cancelled = true; };
  }, [fromBackendId, showError]);

  const targetOptions = useMemo(
    () => allBackends.filter((b) => b.id !== fromBackendId),
    [allBackends, fromBackendId],
  );

  const fromName = useMemo(() => {
    const match = allBackends.find((b) => b.id === fromBackendId);
    return match?.name || fromBackendId;
  }, [allBackends, fromBackendId]);

  async function handleMove() {
    if (busy || !confirmed || !target) return;
    setBusy(true);
    try {
      const updated = await moveProject({ projectId: project.id, targetBackendId: target });
      const targetName = allBackends.find((b) => b.id === target)?.name || target;
      emitProjectEvent('project:storage-ref-changed', {
        projectId: project.id,
        oldRef: fromBackendId,
        newRef: target,
      });
      toast.success(t('moveProject.success', { name: project.name, to: targetName }));
      onMoved(updated);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-foreground font-semibold">{t('moveProject.title')}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label={t('moveProject.cancel')}
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          {t('moveProject.description', { name: project.name, from: fromName })}
        </p>

        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy || loadingBackends || targetOptions.length === 0}
          className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {targetOptions.length === 0 ? (
            <option value="">—</option>
          ) : (
            targetOptions.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))
          )}
        </select>

        <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm">
          <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
          <p className="text-destructive">
            {t('moveProject.warning', { from: fromName })}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground select-none">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          {t('moveProject.confirmCheckbox')}
        </label>

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-sm hover:bg-muted/40 text-muted-foreground border border-border disabled:opacity-50"
          >
            {t('moveProject.cancel')}
          </button>
          <button
            type="button"
            onClick={handleMove}
            disabled={busy || !confirmed || !target || loadingBackends}
            className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy && <Loader size={13} className="animate-spin" />}
            {busy ? t('moveProject.moving') : t('moveProject.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
