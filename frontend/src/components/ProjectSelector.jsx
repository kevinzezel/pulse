'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FolderOpen, Check, Settings, Loader, ArrowRightLeft } from 'lucide-react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import MoveProjectModal from './projects/MoveProjectModal';

// Deterministic color from a backend id — same id always maps to the same hue.
// Inline HSL is fine here (design system tolerates inline HSL for derived colors);
// `local` falls back to a token to stay subtle.
function backendColor(backendId) {
  if (backendId === 'local') return 'hsl(var(--muted-foreground))';
  let hash = 0;
  for (let i = 0; i < backendId.length; i++) {
    hash = (hash * 31 + backendId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

export default function ProjectSelector() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { projects, activeProjectId, activeProject, loading, setActiveProject, refreshProjects } = useProjects();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(null);
  const [moveTarget, setMoveTarget] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function handleSwitch(id) {
    if (id === activeProjectId || switching) return;
    setSwitching(id);
    try {
      await setActiveProject(id);
      setOpen(false);
    } catch (err) {
      showError(err);
    } finally {
      setSwitching(null);
    }
  }

  const label = loading && !activeProject
    ? t('projectSelector.loading')
    : (activeProject?.name || t('projectSelector.none'));

  return (
    <div ref={ref} className="relative min-w-0 w-full">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 md:gap-2 px-2 md:px-2.5 py-1.5 rounded-md bg-muted/40 hover:bg-muted text-sm text-foreground border border-border transition-colors w-full max-w-[120px] md:max-w-none"
        title={t('projectSelector.switch')}
        aria-label={t('projectSelector.switch')}
      >
        <FolderOpen size={15} className="text-muted-foreground shrink-0" />
        <span className="flex-1 min-w-0 truncate text-left text-xs font-medium">{label}</span>
        <svg className="w-3 h-3 opacity-60 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card shadow-lg z-50 py-1">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            {t('projectSelector.switch')}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group w-full flex items-center gap-1 pr-1 hover:bg-muted/40 transition-colors"
              >
                <button
                  onClick={() => handleSwitch(p.id)}
                  disabled={switching !== null}
                  className="flex-1 min-w-0 flex items-center justify-between gap-2 pl-3 pr-1 py-1.5 text-sm text-foreground disabled:opacity-50"
                >
                  <span className="flex-1 min-w-0 flex items-center gap-2 text-left">
                    <span
                      className="inline-block size-2 rounded-full shrink-0"
                      style={{ background: backendColor(p.storage_ref || 'local') }}
                      title={p.storage_ref || 'local'}
                    />
                    <span className="truncate">{p.name}</span>
                  </span>
                  {switching === p.id
                    ? <Loader size={13} className="animate-spin text-muted-foreground shrink-0" />
                    : p.id === activeProjectId && <Check size={13} className="text-primary shrink-0" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMoveTarget(p); setOpen(false); }}
                  disabled={switching !== null}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-30"
                  title={t('moveProject.title')}
                  aria-label={t('moveProject.title')}
                >
                  <ArrowRightLeft size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="h-px bg-border my-1" />
          <Link
            href="/projects"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <Settings size={13} />
            <span>{t('projectSelector.manage')}</span>
          </Link>
        </div>
      )}
      {moveTarget && (
        <MoveProjectModal
          project={moveTarget}
          onClose={() => setMoveTarget(null)}
          onMoved={() => {
            setMoveTarget(null);
            refreshProjects().catch((err) => showError(err));
          }}
        />
      )}
    </div>
  );
}
