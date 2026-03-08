'use client';

import { useLocale } from '@/hooks/useLocale';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  return (
    <button
      onClick={() => setLocale(locale === 'en' ? 'de' : 'en')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(255,255,255,0.04)',
        color: '#9898B0',
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.color = '#F0F0F5';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        e.currentTarget.style.color = '#9898B0';
      }}
      title={locale === 'en' ? 'Auf Deutsch wechseln' : 'Switch to English'}
    >
      <span style={{ fontSize: '14px' }}>{locale === 'en' ? '\u{1F1EC}\u{1F1E7}' : '\u{1F1E9}\u{1F1EA}'}</span>
      <span>{locale === 'en' ? 'EN' : 'DE'}</span>
    </button>
  );
}
