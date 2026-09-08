import { createI18n } from 'vue-i18n';
import fr from './locales/fr.json';
import en from './locales/en.json';

const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = new Set(['fr', 'en']);
const STORAGE_KEY = 'localePreference';

function normalizeLocale(locale) {
  return String(locale || '').toLowerCase().split('-')[0];
}

function detectBrowserLocale() {
  if (typeof navigator === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const candidates = [...(navigator.languages || []), navigator.language].filter(Boolean);
  for (const locale of candidates) {
    const normalized = normalizeLocale(locale);
    if (SUPPORTED_LOCALES.has(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_LOCALE;
}

/**
 * Préférence de langue stockée dans le navigateur.
 * Valeurs : 'auto' (détection navigateur), 'fr', 'en'.
 */
export function getLocalePreference() {
  if (typeof localStorage === 'undefined') return 'auto';
  const stored = localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LOCALES.has(stored) ? stored : 'auto';
}

function resolveLocale(preference) {
  return SUPPORTED_LOCALES.has(preference) ? preference : detectBrowserLocale();
}

const i18n = createI18n({
  legacy: false,          // composition API mode
  locale: resolveLocale(getLocalePreference()),
  fallbackLocale: 'fr',
  messages: { fr, en },
  // Suppress "missing translation" warnings in production
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});

/**
 * Met à jour la préférence de langue : persiste dans le navigateur
 * et applique immédiatement la locale active.
 */
export function setLocalePreference(preference) {
  const normalized = SUPPORTED_LOCALES.has(preference) ? preference : 'auto';
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, normalized);
  }
  i18n.global.locale.value = resolveLocale(normalized);
}

export default i18n;
