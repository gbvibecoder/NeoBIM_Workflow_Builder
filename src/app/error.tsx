'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useLocale } from '@/hooks/useLocale';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    console.error('[App Error]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#07070D' }}>
      <div className="max-w-md w-full text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="h-8 w-8 text-red-400" />
        </div>

        <h1 className="text-2xl font-semibold text-white mb-2">
          {t('error.somethingWrong')}
        </h1>
        <p className="text-sm text-zinc-400 mb-8">
          {t('error.notifiedDesc')}
          {error.digest && (
            <span className="block mt-1 text-xs text-zinc-500">
              {t('error.errorId')} {error.digest}
            </span>
          )}
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-5 py-2.5 text-sm font-medium rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors"
          >
            {t('error.tryAgain')}
          </button>
          <Link
            href="/dashboard"
            className="px-5 py-2.5 text-sm font-medium rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            {t('error.goToDashboard')}
          </Link>
        </div>
      </div>
    </div>
  );
}
