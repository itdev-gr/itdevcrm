import { describe, expect, it } from 'vitest';
import { cleanEmailBody } from './cleanEmailBody';

describe('cleanEmailBody', () => {
  it('strips a Zoho "---- On … wrote ----" quote chain and the client signature', () => {
    const raw = [
      'Καλημέρα σας οκ ευχαριστώ. ',
      '',
      '',
      'Με ιδιαίτερη εκτίμηση,',
      '',
      'Νικόλαος Κανάκης',
      'ΚΑΝΑΚΗΣ Δ. ΝΙΚΟΛΑΟΣ',
      'Τ: (+30) 210 3219362',
      '',
      ' ---- On Fri, 17 Jul 2026 08:40:20 +0300  marios@itdev.gr  wrote ----',
      '',
      'Καλημέρα σας,',
      'Μετά από την ρύθμιση που κάναμε ανεβήκαμε αρκετά!',
    ].join('\n');
    const { visible, hasHidden } = cleanEmailBody(raw);
    expect(visible).toBe('Καλημέρα σας οκ ευχαριστώ.');
    expect(hasHidden).toBe(true);
  });

  it('strips a Gmail "On … wrote:" chain with > quoted lines and keeps our image-free text', () => {
    const raw = [
      'Καλημέρα σας,',
      'Μετά από την ρύθμιση που κάναμε ανεβήκαμε αρκετά!',
      '',
      '[image: image.png]',
      '',
      'On Mon, Jul 13, 2026 at 3:36 PM Marios T <marios@itdev.gr> wrote:',
      '',
      '> Καλησπέρα σας,',
      '> Οκ το αλλάζω.',
    ].join('\r\n');
    const { visible, hasHidden } = cleanEmailBody(raw);
    expect(visible).toBe('Καλημέρα σας,\nΜετά από την ρύθμιση που κάναμε ανεβήκαμε αρκετά!');
    expect(hasHidden).toBe(true);
  });

  it('cuts at our own "Με εκτίμηση," sign-off even when the quote wraps across a line', () => {
    const raw = [
      'Καλησπέρα σας,',
      '',
      'Έχω προωθήσει το email σας στην τεχνική μας ομάδα και θα λάβετε σύντομα',
      'σχετική απάντηση.',
      '',
      'Με εκτίμηση,',
      '',
      'On Tue, Jul 14, 2026 at 12:21 PM NikolaosKanakis TempiHolidays <',
      'nkanakis@tempiholidays.gr> wrote:',
      '',
      '> Καλημέρα σας από το TEMPI HOLIDAYS.',
    ].join('\r\n');
    const { visible, hasHidden } = cleanEmailBody(raw);
    expect(visible).toBe(
      'Καλησπέρα σας,\n\nΈχω προωθήσει το email σας στην τεχνική μας ομάδα και θα λάβετε σύντομα\nσχετική απάντηση.',
    );
    expect(hasHidden).toBe(true);
  });

  it('is a no-op for a clean short message (no quote, no signature)', () => {
    const raw = 'Καλημέρα, οκ το κανονίζουμε. Ευχαριστώ πολύ.';
    const { visible, hasHidden } = cleanEmailBody(raw);
    expect(visible).toBe(raw);
    expect(hasHidden).toBe(false);
  });

  it('falls back to the full body when the message is nothing but a quote', () => {
    const raw = [
      'On Mon, Jul 13, 2026 at 3:36 PM Marios T <marios@itdev.gr> wrote:',
      '> the whole thing is quoted',
    ].join('\n');
    const { visible, hasHidden } = cleanEmailBody(raw);
    expect(visible).toBe(raw.trim());
    expect(hasHidden).toBe(false);
  });

  it('does not treat "Ευχαριστώ πολύ" as a signature anchor', () => {
    const raw = 'Ναι, συμφωνώ.\nΕυχαριστώ πολύ.';
    const { visible, hasHidden } = cleanEmailBody(raw);
    expect(visible).toBe('Ναι, συμφωνώ.\nΕυχαριστώ πολύ.');
    expect(hasHidden).toBe(false);
  });

  it('handles empty / whitespace input safely', () => {
    expect(cleanEmailBody('')).toEqual({ visible: '', hasHidden: false });
    expect(cleanEmailBody('   \n\n ')).toEqual({ visible: '', hasHidden: false });
  });
});
