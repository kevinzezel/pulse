'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  Plus, Search, FolderOpen, Pencil, Trash2, X, Loader, Star,
} from 'lucide-react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import { getProjectStats, listBackends } from '@/services/api';

// Backend dot — same hue derivation used in ProjectSelector. `local` falls
// back to a token to stay subtle; remote backend ids hash to a stable hue
// so two projects on the same backend share a color in the UI.
function backendColor(backendId) {
  if (!backendId || backendId === 'local') return 'hsl(var(--muted-foreground))';
  let hash = 0;
  for (let i = 0; i < backendId.length; i++) {
    hash = (hash * 31 + backendId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

function NewProjectModal({ onClose, onSubmit }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [name, setName] = useState('');
  const [backendId, setBackendId] = useState('local');
  const [backends, setBackends] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listBackends()
      .then((data) => setBackends(data.backends || []))
      .catch((err) => {
        showError(err);
        setBackends([{ id: 'local', name: 'Local' }]);
      });
  }, [showError]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const clean = name.trim();
    if (!clean) return;
    setSubmitting(true);
    try {
      await onSubmit(clean, backendId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-foreground font-semibold">{t('projects.newModal.title')}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="block text-sm text-muted-foreground mb-1">
            {t('projects.newModal.nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            disabled={submitting}
            placeholder={t('projects.newModal.namePlaceholder')}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-4 disabled:opacity-50"
          />
          <label className="block text-sm text-muted-foreground mb-1">
            {t('projects.newModal.backendLabel')}
          </label>
          <select
            value={backendId}
            onChange={(e) => setBackendId(e.target.value)}
            disabled={submitting || !backends}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-4 disabled:opacity-50"
          >
            {(backends || [{ id: 'local', name: 'Local' }]).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 rounded-md text-sm hover:bg-muted/40 text-muted-foreground disabled:opacity-50"
            >
              {t('projects.newModal.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {submitting && <Loader size={13} className="animate-spin" />}
              {submitting ? t('projects.newModal.creating') : t('projects.newModal.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RenameProjectModal({ initialName, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const clean = name.trim();
    if (!clean) return;
    setSubmitting(true);
    try {
      await onSubmit(clean);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-foreground font-semibold">{t('projects.renameModal.title')}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="block text-sm text-muted-foreground mb-1">
            {t('projects.renameModal.nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            disabled={submitting}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-4 disabled:opacity-50"
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 rounded-md text-sm hover:bg-muted/40 text-muted-foreground disabled:opacity-50"
            >
              {t('projects.renameModal.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {submitting && <Loader size={13} className="animate-spin" />}
              {submitting ? t('projects.renameModal.saving') : t('projects.renameModal.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteBlockedModal({ project, stats, onClose }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-destructive/40 rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-destructive">{t('projects.deleteBlocked.title')}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          {t('projects.deleteBlocked.message', { name: project.name })}
        </p>
        <ul className="text-sm space-y-1 mb-4 text-muted-foreground">
          {stats.groups > 0 && <li>• {t('projects.deleteBlocked.groups', { n: stats.groups })}</li>}
          {stats.terminals > 0 && <li>• {t('projects.deleteBlocked.terminals', { n: stats.terminals })}</li>}
          {stats.notes > 0 && <li>• {t('projects.deleteBlocked.notes', { n: stats.notes })}</li>}
          {stats.flows > 0 && <li>• {t('projects.deleteBlocked.flows', { n: stats.flows })}</li>}
          {stats.prompts > 0 && <li>• {t('projects.deleteBlocked.prompts', { n: stats.prompts })}</li>}
          {stats.taskBoards > 0 && <li>• {t('projects.deleteBlocked.taskBoards', { n: stats.taskBoards })}</li>}
          {stats.tasks > 0 && <li>• {t('projects.deleteBlocked.tasks', { n: stats.tasks })}</li>}
        </ul>
        <p className="text-xs text-muted-foreground mb-4">
          {t('projects.deleteBlocked.instructions')}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-muted hover:bg-muted/70 text-sm text-foreground"
          >
            {t('projects.deleteBlocked.ack')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ project, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{t('projects.deleteConfirm.title')}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          {t('projects.deleteConfirm.message', { name: project.name })}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 rounded-md text-sm hover:bg-muted/40 text-muted-foreground disabled:opacity-50"
          >
            {t('projects.deleteConfirm.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="px-4 py-1.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {submitting && <Loader size={13} className="animate-spin" />}
            {submitting ? t('projects.deleteConfirm.deleting') : t('projects.deleteConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, isActive, stats, loadingStats, onActivate, onRename, onDelete, onSetDefault, activating, settingDefault, canDelete }) {
  const { t, formatDate } = useTranslation();
  const total = stats
    ? stats.groups + stats.terminals + stats.notes + stats.flows + stats.prompts
      + (stats.taskBoards || 0) + (stats.tasks || 0)
    : null;
  const isEmpty = total === 0;

  return (
    <article
      className={`border rounded-lg p-4 transition bg-card ${
        isActive
          ? 'border-primary/60 ring-1 ring-primary/40'
          : 'border-border hover:border-muted-foreground/40'
      }`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${
              isActive ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
            }`}
          >
            <FolderOpen size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-block size-2 rounded-full shrink-0"
                style={{ background: backendColor(project.storage_ref || 'local') }}
                title={project.storage_ref || 'local'}
              />
              <h2 className="font-medium truncate">{project.name}</h2>
              {isActive && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
                  {t('projects.active')}
                </span>
              )}
              {project.is_default && (
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex items-center gap-1"
                  title={t('projects.defaultTitle')}
                >
                  <Star size={11} />
                  {t('projects.defaultLabel')}
                </span>
              )}
              {!loadingStats && stats && isEmpty && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {t('projects.empty')}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('projects.createdAt', { date: formatDate(project.created_at) })}
            </p>
            {loadingStats || !stats ? (
              <div className="h-4 mt-2" />
            ) : isEmpty ? (
              <p className="text-xs text-muted-foreground mt-2">
                {t('projects.emptyDescription')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                <span>{t('projects.stats.groups', { n: stats.groups })}</span>
                <span>·</span>
                <span>{t('projects.stats.terminals', { n: stats.terminals })}</span>
                <span>·</span>
                <span>{t('projects.stats.notes', { n: stats.notes })}</span>
                <span>·</span>
                <span>{t('projects.stats.flows', { n: stats.flows })}</span>
                <span>·</span>
                <span>{t('projects.stats.prompts', { n: stats.prompts })}</span>
                {(stats.taskBoards || 0) > 0 && (
                  <>
                    <span>·</span>
                    <span>{t('projects.stats.taskBoards', { n: stats.taskBoards })}</span>
                  </>
                )}
                {(stats.tasks || 0) > 0 && (
                  <>
                    <span>·</span>
                    <span>{t('projects.stats.tasks', { n: stats.tasks })}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isActive && (
            <button
              type="button"
              onClick={onActivate}
              disabled={activating}
              className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium flex items-center gap-1.5"
            >
              {activating && <Loader size={13} className="animate-spin" />}
              {t('projects.activate')}
            </button>
          )}
          {!project.is_default && (
            <button
              type="button"
              onClick={onSetDefault}
              disabled={settingDefault}
              className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
              title={t('projects.makeDefault')}
              aria-label={t('projects.makeDefault')}
            >
              {settingDefault ? <Loader size={15} className="animate-spin" /> : <Star size={15} />}
            </button>
          )}
          <button
            type="button"
            onClick={onRename}
            className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
            title={t('projects.rename')}
            aria-label={t('projects.rename')}
          >
            <Pencil size={15} />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="p-2 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
              title={t('projects.delete')}
              aria-label={t('projects.delete')}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function ProjectsPage() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const {
    projects, activeProjectId,
    setActiveProject,
    createProject, renameProject, deleteProject, setDefaultProject,
  } = useProjects();

  const [statsByProject, setStatsByProject] = useState({});
  const [loadingStats, setLoadingStats] = useState(true);
  const [search, setSearch] = useState('');
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBlocked, setDeleteBlocked] = useState(null);
  const [activatingId, setActivatingId] = useState(null);
  const [settingDefaultId, setSettingDefaultId] = useState(null);

  const fetchStats = useCallback(async () => {
    if (projects.length === 0) {
      setStatsByProject({});
      setLoadingStats(false);
      return;
    }
    setLoadingStats(true);
    try {
      const entries = await Promise.all(
        projects.map((p) => getProjectStats(p.id).then((s) => [p.id, s]).catch(() => [p.id, null]))
      );
      const map = {};
      for (const [id, s] of entries) if (s) map[id] = s;
      setStatsByProject(map);
    } finally {
      setLoadingStats(false);
    }
  }, [projects]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, search]);

  async function handleActivate(id) {
    setActivatingId(id);
    try {
      await setActiveProject(id);
      toast.success(t('success.project_activated'));
    } catch (err) {
      showError(err);
    } finally {
      setActivatingId(null);
    }
  }

  async function handleCreate(name, targetBackendId) {
    try {
      await createProject(name, targetBackendId);
      setCreatingOpen(false);
      await fetchStats();
      toast.success(t('success.project_created'));
    } catch (err) {
      showError(err);
    }
  }

  async function handleSetDefault(id) {
    setSettingDefaultId(id);
    try {
      await setDefaultProject(id);
      toast.success(t('success.project_default_set'));
    } catch (err) {
      showError(err);
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function handleRename(name) {
    if (!renameTarget) return;
    try {
      await renameProject(renameTarget.id, name);
      setRenameTarget(null);
      toast.success(t('success.project_renamed'));
    } catch (err) {
      showError(err);
    }
  }

  async function handleDeleteClick(project) {
    const stats = statsByProject[project.id];
    const total = stats
      ? stats.groups + stats.terminals + stats.notes + stats.flows + stats.prompts
        + (stats.taskBoards || 0) + (stats.tasks || 0)
      : 0;
    if (total > 0) {
      setDeleteBlocked({ project, stats });
    } else {
      setDeleteTarget(project);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteProject(deleteTarget.id);
      setDeleteTarget(null);
      await fetchStats();
      toast.success(t('success.project_deleted'));
    } catch (err) {
      showError(err);
      if (err?.detail_key === 'errors.project_not_empty') {
        setDeleteBlocked({ project: deleteTarget, stats: err.detail_params });
        setDeleteTarget(null);
      }
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">{t('projects.pageTitle')}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              {t('projects.pageSubtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreatingOpen(true)}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium flex items-center gap-2 shrink-0"
          >
            <Plus size={16} />
            {t('projects.newProject')}
          </button>
        </div>

        <div className="relative mb-6">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('projects.searchPlaceholder')}
            className="w-full bg-card border border-border rounded-md pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div className="space-y-3">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              isActive={p.id === activeProjectId}
              stats={statsByProject[p.id]}
              loadingStats={loadingStats}
              activating={activatingId === p.id}
              settingDefault={settingDefaultId === p.id}
              canDelete={!p.is_default && projects.length > 1}
              onActivate={() => handleActivate(p.id)}
              onRename={() => setRenameTarget(p)}
              onDelete={() => handleDeleteClick(p)}
              onSetDefault={() => handleSetDefault(p.id)}
            />
          ))}
        </div>
      </div>

      {creatingOpen && (
        <NewProjectModal
          onClose={() => setCreatingOpen(false)}
          onSubmit={handleCreate}
        />
      )}
      {renameTarget && (
        <RenameProjectModal
          initialName={renameTarget.name}
          onClose={() => setRenameTarget(null)}
          onSubmit={handleRename}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          project={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
      {deleteBlocked && (
        <DeleteBlockedModal
          project={deleteBlocked.project}
          stats={deleteBlocked.stats}
          onClose={() => setDeleteBlocked(null)}
        />
      )}
    </div>
  );
}
