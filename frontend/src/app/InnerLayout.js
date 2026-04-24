'use client';

import { Toaster } from 'react-hot-toast';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { I18nProvider } from '@/providers/I18nProvider';
import { ProjectsProvider } from '@/providers/ProjectsProvider';
import { ViewStateProvider } from '@/providers/ViewStateProvider';
import { ServersProvider } from '@/providers/ServersProvider';
import { UpdateNotifierProvider } from '@/providers/UpdateNotifierProvider';
import { NotificationsProvider } from '@/providers/NotificationsProvider';
import { NotesProvider } from '@/providers/NotesProvider';
import { NotesFab } from '@/components/Notes/NotesFab';
import { NotesManager } from '@/components/Notes/NotesManager';

// FAB + manager don't make sense pre-auth — hide them on /login.
function NotesUI() {
  const pathname = usePathname();
  if (pathname === '/login') return null;
  return (
    <>
      <NotesFab />
      <NotesManager />
    </>
  );
}

export default function InnerLayout({ children }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ProjectsProvider>
          <ViewStateProvider>
            <ServersProvider>
              <UpdateNotifierProvider>
                <NotificationsProvider>
                  <NotesProvider>
                    {children}
                    <NotesUI />
                    <Toaster
                      position="bottom-right"
                      toastOptions={{
                        duration: 4000,
                        style: {
                          background: 'hsl(var(--card))',
                          color: 'hsl(var(--card-foreground))',
                          border: '1px solid hsl(var(--border))',
                        },
                      }}
                    />
                  </NotesProvider>
                </NotificationsProvider>
              </UpdateNotifierProvider>
            </ServersProvider>
          </ViewStateProvider>
        </ProjectsProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
