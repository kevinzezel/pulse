'use client';

import { Settings, LayoutDashboard, FileText, Workflow, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/providers/I18nProvider';
import { useIsMobile } from '@/hooks/layout';
import LanguageSelector from './LanguageSelector';
import ThemeSelector from './ThemeSelector';
import ProjectSelector from './ProjectSelector';
import PulseLogo from './PulseLogo';
import NotesHeaderButton from './Notes/NotesHeaderButton';

const NAV_ITEMS = [
  { href: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { href: '/flows', icon: Workflow, labelKey: 'nav.flows' },
  { href: '/prompts', icon: FileText, labelKey: 'nav.prompts' },
  { href: '/settings', icon: Settings, labelKey: 'nav.settings' },
];

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore — redirecting anyway
  }
  window.location.href = '/login';
}

export default function Header() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const isMobile = useIsMobile();

  return (
    <header
      className="flex-shrink-0 flex items-center justify-between pl-0 pr-4 md:pl-4 h-14 border-b"
      style={{ background: 'hsl(var(--sidebar-bg))', borderColor: 'hsl(var(--sidebar-border))' }}
    >
      <div className="flex items-center min-w-0">
        {isMobile ? (
          <>
            <Link
              href="/"
              className="flex items-center justify-center shrink-0 w-12 h-14 border-r text-primary hover:bg-muted/40 transition-colors"
              style={{ borderColor: 'hsl(var(--sidebar-border))' }}
              title={t('nav.dashboard')}
              aria-label={t('nav.dashboard')}
            >
              <PulseLogo size={28} />
            </Link>
            <div className="pl-3 min-w-0">
              <ProjectSelector />
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-3 shrink-0 w-[224px]">
              <Link
                href="/"
                className="flex items-center gap-2.5 text-primary font-bold text-lg tracking-tight shrink-0 hover:opacity-80 transition-opacity"
                title={t('nav.dashboard')}
                aria-label={t('nav.dashboard')}
              >
                <PulseLogo size={28} />
                <span>Pulse</span>
              </Link>

              <div className="min-w-0 flex-1">
                <ProjectSelector />
              </div>
            </div>

            <nav className="flex items-center gap-1 pl-3 ml-1 border-l border-border h-8">
              {NAV_ITEMS.map(item => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                      active
                        ? 'text-primary bg-primary/10'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    }`}
                  >
                    <Icon size={15} />
                    {t(item.labelKey)}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {isMobile && <NotesHeaderButton />}
        <LanguageSelector />
        <ThemeSelector />
        <button
          type="button"
          onClick={handleLogout}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          title={t('header.logout')}
          aria-label={t('header.logout')}
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
