'use client';

import { useLocale } from '@/hooks/useLocale';
import { Globe } from 'lucide-react';
import { useState } from 'react';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const [hovered, setHovered] = useState(false);
  const nextLocale = locale === 'en' ? 'de' : 'en';

  return (
    <button
      className="lang-switcher"
      onClick={() => setLocale(nextLocale)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={locale === 'en' ? 'Auf Deutsch wechseln' : 'Switch to English'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 14px',
        borderRadius: 20,
        border: `1px solid ${hovered ? 'rgba(79,138,255,0.35)' : 'rgba(79,138,255,0.15)'}`,
        background: hovered
          ? 'linear-gradient(135deg, rgba(79,138,255,0.12), rgba(99,102,241,0.08))'
          : 'rgba(79,138,255,0.06)',
        color: hovered ? '#C4D4F0' : '#8BA4D0',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        letterSpacing: '0.5px',
        boxShadow: hovered ? '0 0 16px rgba(79,138,255,0.12)' : 'none',
        transform: hovered ? 'translateY(-1px)' : 'none',
      }}
    >
      <Globe
        size={14}
        style={{
          transition: 'transform 0.3s ease',
          transform: hovered ? 'rotate(20deg)' : 'none',
        }}
      />
      <span className="lang-switcher-label">{locale === 'en' ? 'EN' : 'DE'}</span>
    </button>
  );
}
