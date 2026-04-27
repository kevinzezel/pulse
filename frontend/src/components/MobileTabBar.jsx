'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, Workflow, SquareKanban, Settings } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';

const NAV_ITEMS = [
  { href: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { href: '/tasks', icon: SquareKanban, labelKey: 'nav.tasks' },
  { href: '/flows', icon: Workflow, labelKey: 'nav.flows' },
  { href: '/prompts', icon: FileText, labelKey: 'nav.prompts' },
  { href: '/settings', icon: Settings, labelKey: 'nav.settings' },
];

export default function MobileTabBar() {
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <nav
      className="flex-shrink-0 h-[52px] border-t flex"
      style={{ background: 'hsl(var(--sidebar-bg))', borderColor: 'hsl(var(--sidebar-border))' }}
    >
      {NAV_ITEMS.map(item => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`min-w-0 flex-1 flex flex-col items-center justify-center gap-0.5 border-t-2 transition-colors ${
              active
                ? 'text-primary border-primary'
                : 'text-muted-foreground border-transparent'
            }`}
          >
            <Icon size={16} />
            <span className="w-full truncate px-0.5 text-center text-[10px] font-medium tracking-wide">
              {t(item.labelKey)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
