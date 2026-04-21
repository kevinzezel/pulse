'use client';

import Header from '@/components/Header';
import MobileTabBar from '@/components/MobileTabBar';
import { useIsMobile } from '@/hooks/layout';

export default function MainLayout({ children }) {
  const isMobile = useIsMobile();

  return (
    <div className="flex flex-col h-dvh bg-background overflow-hidden">
      <Header />
      <main className="flex-1 min-h-0 overflow-hidden relative">
        {children}
      </main>
      {isMobile && <MobileTabBar />}
    </div>
  );
}
