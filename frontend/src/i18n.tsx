import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { english } from './messages'

export type Language = 'ru' | 'en'
export type Message = keyof typeof english
export type Translate = (message: Message, values?: Record<string, string | number>) => string
const storageKey = 'terminal-language'

function readLanguage(): Language {
  try { return localStorage.getItem(storageKey) === 'en' ? 'en' : 'ru' }
  catch { return 'ru' }
}

let currentLanguage = readLanguage()

export function getLanguage() {
  return currentLanguage
}

export function translate(language: Language): Translate {
  return (message, values) => {
    const text = language === 'en' ? english[message] : message
    return values ? text.replace(/\{(\w+)\}/g, (token, key) => String(values[key] ?? token)) : text
  }
}

const LanguageContext = createContext({
  language: 'ru' as Language,
  t: translate('ru'),
  chooseLanguage: (_language: Language) => {},
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(getLanguage)
  useLayoutEffect(() => {
    document.documentElement.lang = language
  }, [language])
  const value = useMemo(() => ({
    language,
    t: translate(language),
    chooseLanguage(next: Language) {
      currentLanguage = next
      try { localStorage.setItem(storageKey, next) } catch { /* The current session can still switch languages. */ }
      setLanguage(next)
    },
  }), [language])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useTranslation() {
  return useContext(LanguageContext)
}

export function desktopName(desktop: { id: number; name: string; default_name?: boolean }, t: Translate) {
  return desktop.default_name ? t('Рабочий стол {number}', { number: desktop.id }) : desktop.name
}

export function pluginText<T extends { translations?: Partial<Record<Language, { name: string; description: string }>> }>(
  plugin: T, language: Language,
): T {
  const localized = plugin.translations?.[language]
  return localized ? { ...plugin, ...localized } : plugin
}
