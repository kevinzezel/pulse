'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Settings as SettingsIcon, Server, Bell, MessageCircle } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import ServersTab from '@/components/settings/ServersTab';
import TelegramTab from '@/components/settings/TelegramTab';
import NotificationsTab from '@/components/settings/NotificationsTab';

const TABS = [
  { id: 'servers', icon: Server, labelKey: 'settings.tabs.servers' },
  { id: 'telegram', icon: MessageCircle, labelKey: 'settings.tabs.telegram' },
  { id: 'notifications', icon: Bell, labelKey: 'settings.tabs.notifications' },
];

function SettingsContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const editParam = searchParams.get('edit');
  const initialTab = TABS.some(tab => tab.id === tabParam) ? tabParam : 'servers';
  const [activeTab, setActiveTab] = useState(initialTab);

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-8 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <SettingsIcon className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">{t('settings.pageTitle')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('settings.pageSubtitle')}</p>
        </header>

        <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={14} />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        {activeTab === 'servers' && <ServersTab initialEditId={editParam} />}
        {activeTab === 'telegram' && <TelegramTab />}
        {activeTab === 'notifications' && <NotificationsTab />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <SettingsContent />
    </Suspense>
  );
}
