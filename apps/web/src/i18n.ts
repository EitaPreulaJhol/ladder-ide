import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ptBR from './locales/pt-BR.json';
import en from './locales/en.json';
import es from './locales/es.json';

export const LANGUAGES = [
  { id: 'pt-BR', label: 'Português (BR)', short: 'PT' },
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'es', label: 'Español', short: 'ES' },
] as const;
export type Language = (typeof LANGUAGES)[number]['id'];

const KEY = 'ladder-ide:lang';

/** Saved choice, else the browser language, else Portuguese. */
function detect(): Language {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGUAGES.some((l) => l.id === saved)) return saved as Language;
  } catch {
    /* storage blocked */
  }
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('pt')) return 'pt-BR';
  if (nav.startsWith('es')) return 'es';
  if (nav.startsWith('en')) return 'en';
  return 'pt-BR';
}

const initial = detect();
document.documentElement.lang = initial;

/** To add a language: create locales/<lang>.json with the same keys (see apps/web/test/locales.test.ts). */
void i18n.use(initReactI18next).init({
  resources: { 'pt-BR': { translation: ptBR }, en: { translation: en }, es: { translation: es } },
  lng: initial,
  fallbackLng: 'pt-BR',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: Language) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage blocked: applies to this session only */
  }
  document.documentElement.lang = lang;
  void i18n.changeLanguage(lang);
}

/** Locale for dates and numbers (follows the interface language). */
export const locale = () => i18n.language || 'pt-BR';

export default i18n;
