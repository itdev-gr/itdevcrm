import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, beforeAll } from 'vitest';
import { i18n } from '@/lib/i18n';
import { CampaignStatusBadge } from './CampaignStatusBadge';
import type { CampaignStatus } from '../hooks/useCampaigns';

const GREEK_LABELS: Record<CampaignStatus, string> = {
  draft: 'Πρόχειρη',
  ready: 'Έτοιμη',
  scheduled: 'Προγραμματισμένη',
  sending: 'Σε αποστολή',
  paused: 'Σε παύση',
  sent: 'Απεστάλη',
  cancelled: 'Ακυρώθηκε',
};

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('CampaignStatusBadge', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  (Object.keys(GREEK_LABELS) as CampaignStatus[]).forEach((status) => {
    it(`renders the Greek label for "${status}"`, () => {
      render(wrap(<CampaignStatusBadge status={status} />));
      expect(screen.getByText(GREEK_LABELS[status])).toBeInTheDocument();
    });
  });
});
