'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Lock } from 'lucide-react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import LanguageSelector from '@/components/LanguageSelector';
import ThemeSelector from '@/components/ThemeSelector';
import PulseLogo from '@/components/PulseLogo';

function VersionFooter() {
  const [version, setVersion] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/local-version')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data?.version) setVersion(data.version); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!version) return null;
  return (
    <footer className="text-center py-3 text-xs text-muted-foreground">
      Pulse v{version}
    </footer>
  );
}

function LoginForm() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading || !password) return;
    setLoading(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const error = new Error(err.detail || 'Auth failed');
        error.detail_key = err.detail_key;
        throw error;
      }
      const raw = params.get('next') || '/';
      const safeNext = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
      router.replace(safeNext);
    } catch (err) {
      showError(err);
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border bg-card p-6 space-y-4 shadow-sm">
      <div className="flex items-center gap-2.5 text-primary font-bold text-lg tracking-tight">
        <PulseLogo size={28} />
        <span>Pulse</span>
      </div>
      <div className="flex items-center gap-2 text-foreground">
        <Lock size={16} />
        <h1 className="text-sm font-semibold">{t('login.title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t('login.passwordPlaceholder')}
        disabled={loading}
        className="w-full px-3 py-2 rounded-md bg-input border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={loading || !password}
        className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {t('login.signingIn')}
          </>
        ) : (
          t('login.signIn')
        )}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div
      className="min-h-dvh flex flex-col bg-background"
      style={{ background: 'hsl(var(--sidebar-bg))' }}
    >
      <header
        className="flex items-center justify-end px-4 h-14 border-b flex-shrink-0"
        style={{ borderColor: 'hsl(var(--sidebar-border))' }}
      >
        <div className="flex items-center gap-1">
          <LanguageSelector />
          <ThemeSelector />
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center p-4">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
      <VersionFooter />
    </div>
  );
}
