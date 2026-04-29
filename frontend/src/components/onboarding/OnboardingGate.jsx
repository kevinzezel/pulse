'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { FolderPlus, Database, Loader } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import { listBackends } from '@/services/api';
import AddBackendModal from '@/components/settings/AddBackendModal';

// Full-screen blocking gate shown when the install has zero projects across
// every configured backend. The dashboard contract (post v4.2) is "always
// at least one project," so the rest of the code drops the proj-default
// fallback chain and assumes activeProjectId points at a real entry. Two
// paths:
//
//  1. Create a project on a backend the user already has (Local always
//     present, plus any S3/Mongo they added).
//  2. Add a storage backend -- if it's a token-paste of a colleague's
//     backend, projects auto-discover from the manifest and the gate
//     dismisses on the next refresh; if it's a from-scratch backend, the
//     user comes back here and creates a project on it.
//
// Hidden on /login (auth gate covers that path) and while projects haven't
// loaded yet (avoids a flash before the first /api/projects response).
export default function OnboardingGate() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { projects, loaded, createProject, refreshProjects } = useProjects();
  const [mode, setMode] = useState('menu'); // 'menu' | 'create' | 'addBackend'
  const [name, setName] = useState('');
  const [backendId, setBackendId] = useState('local');
  const [backends, setBackends] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const visible = pathname !== '/login' && loaded && projects.length === 0;

  useEffect(() => {
    if (!visible) return;
    listBackends()
      .then((data) => setBackends(data.backends || []))
      .catch(() => setBackends([{ id: 'local', name: 'Local' }]));
  }, [visible, mode]);

  if (!visible) return null;

  async function handleCreate(e) {
    e.preventDefault();
    if (submitting) return;
    const clean = name.trim();
    if (!clean) return;
    setSubmitting(true);
    try {
      await createProject(clean, backendId);
      toast.success(t('success.project_created'));
      // Provider state updates from createProject -> refreshProjects, so
      // projects.length flips to >=1 and `visible` becomes false.
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBackendAdded() {
    // After Add: re-pull projects in case it was a token paste with a
    // populated manifest. If projects appear, this gate dismisses; otherwise
    // we land back on the menu and the new backend shows up in the dropdown.
    setMode('menu');
    await refreshProjects().catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-[60] bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-lg p-6 space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-semibold">{t('onboarding.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('onboarding.subtitle')}</p>
        </div>

        {mode === 'menu' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => setMode('create')}
              className="flex flex-col items-start gap-2 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent text-left transition"
            >
              <FolderPlus size={22} className="text-primary" />
              <div className="font-medium">{t('onboarding.createTitle')}</div>
              <div className="text-xs text-muted-foreground">{t('onboarding.createHint')}</div>
            </button>
            <button
              type="button"
              onClick={() => setMode('addBackend')}
              className="flex flex-col items-start gap-2 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent text-left transition"
            >
              <Database size={22} className="text-primary" />
              <div className="font-medium">{t('onboarding.addBackendTitle')}</div>
              <div className="text-xs text-muted-foreground">{t('onboarding.addBackendHint')}</div>
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreate} className="space-y-3 pt-2">
            <label className="block text-sm">
              <span className="block mb-1 text-muted-foreground">
                {t('projects.newModal.nameLabel')}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                placeholder={t('projects.newModal.namePlaceholder')}
                disabled={submitting}
                required
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
            </label>
            <label className="block text-sm">
              <span className="block mb-1 text-muted-foreground">
                {t('projects.newModal.backendLabel')}
              </span>
              <select
                value={backendId}
                onChange={(e) => setBackendId(e.target.value)}
                disabled={submitting}
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              >
                {backends.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setMode('menu')}
                disabled={submitting}
                className="px-3 py-1.5 rounded-md text-sm hover:bg-muted/40 text-muted-foreground disabled:opacity-50"
              >
                {t('onboarding.back')}
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
        )}

        {mode === 'addBackend' && (
          <AddBackendModal
            onClose={() => setMode('menu')}
            onAdded={handleBackendAdded}
          />
        )}
      </div>
    </div>
  );
}
