import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enCommon from '@/i18n/locales/en/common.json';
import elCommon from '@/i18n/locales/el/common.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'el'],
    defaultNS: 'common',
    ns: ['common'],
    resources: {
      en: { common: enCommon },
      el: { common: elCommon },
    },
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'itdevcrm.locale',
    },
  });

export { i18n };
