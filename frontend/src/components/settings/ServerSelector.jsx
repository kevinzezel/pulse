'use client';

import { useTranslation } from '@/providers/I18nProvider';

export default function ServerSelector({ servers, value, onChange, disabled }) {
  const { t } = useTranslation();
  if (servers.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 mb-4">
      <label className="text-xs text-muted-foreground">
        {t('settings.serverSelector.label')}
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {servers.map(s => (
          <option key={s.id} value={s.id}>
            {s.name || `${s.host}:${s.port}`}
          </option>
        ))}
      </select>
    </div>
  );
}
