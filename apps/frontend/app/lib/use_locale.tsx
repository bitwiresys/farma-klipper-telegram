'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { Locale } from './i18n';
import { DEFAULT_LOCALE, LOCALES, detectLocale, setLocale, t } from './i18n';

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const detected = detectLocale();
    setLocaleState(detected);
  }, []);

  const handleSetLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    setLocale(newLocale);
  }, []);

  const translate = useCallback((key: string) => t(key, locale), [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale: handleSetLocale, t: translate }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useLocale must be used within I18nProvider');
  }
  return ctx;
}

// Language selector component
export function LocaleSelector() {
  const { locale, setLocale } = useLocale();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className="rounded-btn border border-border/50 bg-surface px-2 py-1.5 text-xs text-textPrimary"
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {l === 'en' ? 'English' : 'Русский'}
        </option>
      ))}
    </select>
  );
}
