import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type AppLanguage = 'id' | 'en';

export const LANGUAGE_STORAGE_KEY = 'my_expenses_lang';

interface LanguageContextValue {
  lang: AppLanguage;
  setLang: (next: AppLanguage) => void;
  toggleLang: () => void;
  tr: (idText: string, enText: string) => string;
}

const defaultContext: LanguageContextValue = {
  lang: 'id',
  setLang: () => {},
  toggleLang: () => {},
  tr: (idText) => idText,
};

const LanguageContext = createContext<LanguageContextValue>(defaultContext);

function readInitialLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'id';
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved === 'en' ? 'en' : 'id';
  } catch {
    return 'id';
  }
}

export const LanguageProvider: React.FC<{
  initialLang?: AppLanguage;
  children: React.ReactNode;
}> = ({ initialLang, children }) => {
  const [lang, setLangState] = useState<AppLanguage>(() => initialLang ?? readInitialLanguage());

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      } catch {
        // Ignore storage quota / privacy mode errors
      }
    }
  }, [lang]);

  const setLang = useCallback((next: AppLanguage) => {
    setLangState(next);
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => (prev === 'id' ? 'en' : 'id'));
  }, []);

  const tr = useCallback(
    (idText: string, enText: string) => (lang === 'en' ? enText : idText),
    [lang]
  );

  const value = useMemo(
    () => ({ lang, setLang, toggleLang, tr }),
    [lang, setLang, toggleLang, tr]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
