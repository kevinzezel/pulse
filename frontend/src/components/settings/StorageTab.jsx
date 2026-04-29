'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { listBackends } from '@/services/api';
import { useProjects } from '@/providers/ProjectsProvider';
import BackendCard from './BackendCard';
import AddBackendModal from './AddBackendModal';

export default function StorageTab() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { projects, refreshProjects } = useProjects();
  const [data, setData] = useState({ backends: [], default_backend_id: 'local' });
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listBackends();
      setData(result);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { refresh(); }, [refresh]);

  function projectCountFor(backendId) {
    return projects.filter((p) => (p.storage_ref || 'local') === backendId).length;
  }

  // After Add (form or token), the backend list and the project list both
  // change -- new backend appears here, and the projects-manifest aggregator
  // surfaces any projects that came along with a token import.
  async function handleAdded() {
    setAddModalOpen(false);
    await refresh();
    refreshProjects().catch((err) => console.warn('[StorageTab] project refresh failed:', err));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('settings.storage.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('settings.storage.description')}</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setAddModalOpen(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          {t('settings.storage.addBackend')}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('settings.storage.loading')}</div>
      ) : (
        <div className="space-y-2">
          {data.backends.map((backend) => (
            <BackendCard
              key={backend.id}
              backend={backend}
              isDefault={data.default_backend_id === backend.id}
              projectCount={projectCountFor(backend.id)}
              onChange={refresh}
            />
          ))}
        </div>
      )}

      {addModalOpen && (
        <AddBackendModal
          onClose={() => setAddModalOpen(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
