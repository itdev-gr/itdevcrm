import { describe, it, expect } from 'vitest';
import {
  normalizeServiceLabel,
  leadServiceLabel,
  leadBaseName,
  leadNameWithService,
} from './leadService';

describe('normalizeServiceLabel', () => {
  it('collapses the noisy real form names to the short labels', () => {
    expect(normalizeServiceLabel('📍 LOCAL SEO LEAD FORM — ITDEV')).toBe('Local SEO');
    expect(normalizeServiceLabel('🧲 SOCIAL MEDIA LEAD FORM (ITDEV)')).toBe('Social Media');
    expect(normalizeServiceLabel('🧲 WEB SEO LEAD FORM — ITDEV-copy')).toBe('Web SEO');
    expect(normalizeServiceLabel('AI SEO για σύγχρονες επιχειρήσεις')).toBe('AI SEO');
    expect(normalizeServiceLabel('Νεα φορμα 03 website')).toBe('Website');
  });

  it('tests the SEO variants before the bare website keyword', () => {
    expect(normalizeServiceLabel('local seo for your website')).toBe('Local SEO');
  });

  it('returns null for anything that is not a service we sell', () => {
    // Real junk found in prod titles from years of hand editing.
    expect(normalizeServiceLabel('Syros')).toBeNull();
    expect(normalizeServiceLabel('possible')).toBeNull();
    expect(normalizeServiceLabel('ITDEV SALE WHATEVER')).toBeNull();
    expect(normalizeServiceLabel('')).toBeNull();
    expect(normalizeServiceLabel(null)).toBeNull();
  });
});

describe('leadServiceLabel', () => {
  it('prefers what sales actually priced over anything inferred', () => {
    expect(
      leadServiceLabel({
        title: 'Μαρία Π. (Website)',
        services_planned: [{ service_type: 'social_media', monthly_amount: 300 }],
      }),
    ).toBe('Social Media');
  });

  it('reads the label the Meta ingestion wrote into the title', () => {
    expect(leadServiceLabel({ title: 'Μαργαρίτα Γραβέζα (Local SEO)' })).toBe('Local SEO');
  });

  it('rescues imported leads whose form only survives in the notes', () => {
    // The 128 Social Media leads that arrived as ClickUp imports.
    expect(
      leadServiceLabel({
        title: 'coffeeboss_corfu',
        notes: 'Φόρμα: 🧲 SOCIAL MEDIA LEAD FORM (ITDEV)\nέχεις google business profile: ναι',
      }),
    ).toBe('Social Media');
    expect(
      leadServiceLabel({ title: 'Art Filatov', notes: 'Form: 🧲 WEB SEO LEAD FORM — ITDEV-copy' }),
    ).toBe('Web SEO');
  });

  it('labels franchise leads even with no form at all', () => {
    expect(leadServiceLabel({ title: 'Κάποιος', source: 'franchise' })).toBe('Franchise');
  });

  it('says nothing for a plain import — we do not invent a service', () => {
    expect(leadServiceLabel({ title: 'Akteon', notes: 'clickup task id: 86ca724dj' })).toBeNull();
  });
});

describe('leadNameWithService', () => {
  it('produces ΟΝΟΜΑ ΕΠΩΝΥΜΟ (SERVICE)', () => {
    expect(
      leadNameWithService({
        contact_first_name: 'Μαργαρίτα',
        contact_last_name: 'Γραβέζα',
        title: 'Μαργαρίτα Γραβέζα (Local SEO)',
      }),
    ).toBe('Μαργαρίτα Γραβέζα (Local SEO)');
  });

  it('never doubles a label already present in the title', () => {
    expect(leadNameWithService({ title: 'Γιώργος Παπάς (Website)' })).toBe(
      'Γιώργος Παπάς (Website)',
    );
  });

  it('keeps a parenthesis that is not a service', () => {
    expect(leadBaseName({ title: 'Καφέ Ουζερί (Σύρος)' })).toBe('Καφέ Ουζερί (Σύρος)');
    expect(leadNameWithService({ title: 'Καφέ Ουζερί (Σύρος)' })).toBe('Καφέ Ουζερί (Σύρος)');
  });

  it('falls back to the company when there is no contact name', () => {
    expect(
      leadNameWithService({
        company_name: 'Paintball Nafplio',
        notes: 'Φόρμα: 🧲 SOCIAL MEDIA LEAD FORM (ITDEV)',
      }),
    ).toBe('Paintball Nafplio (Social Media)');
  });

  it('leaves a plain lead exactly as it is', () => {
    expect(leadNameWithService({ contact_first_name: 'Στέλιος', title: 'Στέλιος' })).toBe('Στέλιος');
  });
});
