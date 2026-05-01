import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enCommon from '@/i18n/locales/en/common.json';
import elCommon from '@/i18n/locales/el/common.json';
import enAuth from '@/i18n/locales/en/auth.json';
import elAuth from '@/i18n/locales/el/auth.json';
import enUsers from '@/i18n/locales/en/users.json';
import elUsers from '@/i18n/locales/el/users.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'el'],
    defaultNS: 'common',
    ns: ['common', 'auth', 'users'],
    resources: {
      en: { common: enCommon, auth: enAuth, users: enUsers },
      el: { common: elCommon, auth: elAuth, users: elUsers },
    },
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'itdevcrm.locale',
    },
  });

export { i18n };
