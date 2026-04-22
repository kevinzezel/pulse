'use client';

import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { I18nProvider } from '@/providers/I18nProvider';
import { ProjectsProvider } from '@/providers/ProjectsProvider';
import { ViewStateProvider } from '@/providers/ViewStateProvider';
import { ServersProvider } from '@/providers/ServersProvider';
import { NotificationsProvider } from '@/providers/NotificationsProvider';
import { NotesProvider } from '@/providers/NotesProvider';
import { NotesFab } from '@/components/Notes/NotesFab';
import { NotesManager } from '@/components/Notes/NotesManager';

export default function InnerLayout({ children }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ProjectsProvider>
          <ViewStateProvider>
            <ServersProvider>
              <NotificationsProvider>
                <NotesProvider>
                  {children}
                  <NotesFab />
                  <NotesManager />
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
            </ServersProvider>
          </ViewStateProvider>
        </ProjectsProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
