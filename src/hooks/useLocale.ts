'use client';

import { create } from 'zustand';
import { type Locale, getLocaleFromStorage, setLocaleToStorage, t as translate, tArray as translateArray, type TranslationKey } from '@/lib/i18n';

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
  tArray: (key: TranslationKey) => readonly string[];
}

export const useLocale = create<LocaleStore>((set) => ({
  locale: 'en',
  setLocale: (newLocale: Locale) => {
    setLocaleToStorage(newLocale);
    set({
      locale: newLocale,
      // Create new function references so ALL subscribers re-render
      t: (key: TranslationKey) => translate(key, newLocale),
      tArray: (key: TranslationKey) => translateArray(key, newLocale),
    });
  },
  t: (key: TranslationKey) => translate(key, 'en'),
  tArray: (key: TranslationKey) => translateArray(key, 'en'),
}));

// Initialize from localStorage on client
if (typeof window !== 'undefined') {
  const stored = getLocaleFromStorage();
  useLocale.setState({
    locale: stored,
    t: (key: TranslationKey) => translate(key, stored),
    tArray: (key: TranslationKey) => translateArray(key, stored),
  });
}
