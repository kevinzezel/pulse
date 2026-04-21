'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';

export default function SidebarShell({ isOpen, setIsOpen, isMobile, children }) {
  const { t } = useTranslation();

  const asideClass = isMobile
    ? `absolute inset-y-0 left-0 z-40 flex flex-col border-r transition-all duration-300 ${
        isOpen ? 'w-64 shadow-xl' : 'w-12 overflow-hidden'
      }`
    : `relative flex-shrink-0 flex flex-col border-r transition-all duration-300 ${
        isOpen ? 'w-64' : 'w-12 overflow-hidden'
      }`;

  return (
    <aside
      className={asideClass}
      style={{ background: 'hsl(var(--sidebar-bg))', borderColor: 'hsl(var(--sidebar-border))' }}
    >
      {!isOpen && (
        <div
          className="border-b flex items-center px-1 py-2 justify-center"
          style={{ borderColor: 'hsl(var(--sidebar-border))' }}
        >
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="p-1 text-primary hover:text-primary/80 transition-colors"
            title={t('sidebar.expandTooltip')}
            aria-label={t('sidebar.expandTooltip')}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
      {isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="absolute top-1/2 -right-[10px] -translate-y-1/2 w-5 h-10 flex items-center justify-center rounded border bg-sidebar text-muted-foreground hover:text-foreground opacity-50 hover:opacity-100 transition-all z-20"
          style={{ background: 'hsl(var(--sidebar-bg))', borderColor: 'hsl(var(--sidebar-border))' }}
          title={t('sidebar.collapseTooltip')}
          aria-label={t('sidebar.collapseTooltip')}
        >
          <ChevronLeft size={12} />
        </button>
      )}
      {children}
    </aside>
  );
}
