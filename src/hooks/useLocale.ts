'use client';

import { create } from 'zustand';
import { type Locale, getLocaleFromStorage, setLocaleToStorage, t as translate, tArray as translateArray, type TranslationKey } from '@/lib/i18n';

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
  tArray: (key: TranslationKey) => readonly string[];
}

export const useLocale = create<LocaleStore>((set, get) => ({
  locale: 'en',
  setLocale: (locale: Locale) => {
    setLocaleToStorage(locale);
    set({ locale });
  },
  t: (key: TranslationKey) => translate(key, get().locale),
  tArray: (key: TranslationKey) => translateArray(key, get().locale),
}));

// Initialize from localStorage on client
if (typeof window !== 'undefined') {
  const stored = getLocaleFromStorage();
  useLocale.setState({ locale: stored });
}
