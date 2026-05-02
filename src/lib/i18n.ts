import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enCommon from '@/i18n/locales/en/common.json';
import elCommon from '@/i18n/locales/el/common.json';
import enAuth from '@/i18n/locales/en/auth.json';
import elAuth from '@/i18n/locales/el/auth.json';
import enUsers from '@/i18n/locales/en/users.json';
import elUsers from '@/i18n/locales/el/users.json';
import enAdmin from '@/i18n/locales/en/admin.json';
import elAdmin from '@/i18n/locales/el/admin.json';
import enClients from '@/i18n/locales/en/clients.json';
import elClients from '@/i18n/locales/el/clients.json';
import enDeals from '@/i18n/locales/en/deals.json';
import elDeals from '@/i18n/locales/el/deals.json';
import enSales from '@/i18n/locales/en/sales.json';
import elSales from '@/i18n/locales/el/sales.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'el'],
    defaultNS: 'common',
    ns: ['common', 'auth', 'users', 'admin', 'clients', 'deals', 'sales'],
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        users: enUsers,
        admin: enAdmin,
        clients: enClients,
        deals: enDeals,
        sales: enSales,
      },
      el: {
        common: elCommon,
        auth: elAuth,
        users: elUsers,
        admin: elAdmin,
        clients: elClients,
        deals: elDeals,
        sales: elSales,
      },
    },
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'itdevcrm.locale',
    },
  });

export { i18n };
