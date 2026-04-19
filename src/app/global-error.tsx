'use client';

import { useEffect } from 'react';
import { useLocale } from '@/hooks/useLocale';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    // Dynamic Sentry import: a top-level `import * as Sentry` would pull
    // @sentry/nextjs → @sentry/node → @opentelemetry/instrumentation into
    // webpack's SSR bundle at compile time, which crashes Next.js 16 dev
    // with `TypeError: document.querySelector is not a function` inside
    // pages.runtime.dev.js — even when NEXT_PUBLIC_SENTRY_DSN is unset
    // and next.config.ts skips withSentryConfig wrapping.
    // Dynamic-import confines the package graph to the browser.
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SENTRY_DSN) {
      void import('@sentry/nextjs')
        .then((mod) => mod.captureException(error))
        .catch(() => { /* ignore — reporting is best-effort */ });
    }
    console.error('[Global Error]', error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body
        style={{
          background: '#07070D',
          color: '#F0F4FF',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ maxWidth: '420px', textAlign: 'center', padding: '24px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              margin: '0 auto 24px',
              borderRadius: '16px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
            }}
          >
            !
          </div>

          <h1 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '8px' }}>
            {t('globalError.somethingWrong')}
          </h1>
          <p style={{ fontSize: '14px', color: '#a1a1aa', marginBottom: '32px' }}>
            {t('globalError.criticalDesc')}
            {error.digest && (
              <span style={{ display: 'block', marginTop: '4px', fontSize: '12px', color: '#71717a' }}>
                {t('globalError.errorId')} {error.digest}
              </span>
            )}
          </p>

          <button
            onClick={reset}
            style={{
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: 500,
              borderRadius: '12px',
              background: 'white',
              color: 'black',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {t('globalError.reload')}
          </button>
        </div>
      </body>
    </html>
  );
}
