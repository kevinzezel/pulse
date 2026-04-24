'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText } from 'lucide-react';
import { getSessions, composeSessionId } from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useServers } from '@/providers/ServersProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import PromptsManager from '@/components/prompts/PromptsManager';

export default function PromptsPage() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { servers } = useServers();
  const { activeProjectId } = useProjects();

  const [sessions, setSessions] = useState([]);

  // Load sessions from all configured servers so the nested "pick a session"
  // sub-modal inside PromptsManager (page mode) can offer them. Filter by
  // active project so prompts only send to terminals in scope.
  const loadSessions = useCallback(async () => {
    try {
      if (servers.length === 0) {
        setSessions([]);
        return;
      }
      const results = await Promise.allSettled(servers.map(srv => getSessions(srv.id)));
      const merged = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const srv = servers[i];
          merged.push(...(r.value.sessions || [])
            .filter((s) => !s.project_id || s.project_id === activeProjectId)
            .map(s => ({
              ...s,
              id: composeSessionId(srv.id, s.id),
              server_id: srv.id,
              server_name: srv.name,
              server_color: srv.color,
            })));
        }
      });
      setSessions(merged);
    } catch (err) {
      showError(err);
    }
  }, [servers, showError, activeProjectId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-8 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <FileText className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">{t('prompts.pageTitle')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('prompts.pageSubtitle')}</p>
        </header>

        <PromptsManager
          mode="page"
          sessions={sessions}
          currentProjectId={activeProjectId}
        />
      </div>
    </div>
  );
}
