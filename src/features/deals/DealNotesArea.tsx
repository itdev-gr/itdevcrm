import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';
import { cn } from '@/lib/utils';
import type { DealRow } from './hooks/useDeals';

// Job-sourced notes (seo/local/webdev/ads) render in DealServiceInfo, which
// walks every job — the per-key excerpts that used to live here read the empty
// AI SEO parent first and showed "—" (removed 2026-07-13, owner decision).

export function DealNotesArea({ deal }: { deal: DealRow }) {
  const { t, i18n } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const qc = useQueryClient();

  const [salesNote, setSalesNote] = useState(deal.sales_note ?? '');
  const [businessProfileUrl, setBusinessProfileUrl] = useState(deal.business_profile_url ?? '');
  const [businessProfileName, setBusinessProfileName] = useState(deal.business_profile_name ?? '');

  const patch = useMemo(
    () => ({
      sales_note: salesNote.trim() || null,
      business_profile_url: businessProfileUrl.trim() || null,
      business_profile_name: businessProfileName.trim() || null,
    }),
    [salesNote, businessProfileUrl, businessProfileName],
  );
  const status = useAutoSave(patch, async (next) => {
    const { error } = await supabase
      .from('deals')
      .update({
        sales_note: next.sales_note,
        business_profile_url: next.business_profile_url,
        business_profile_name: next.business_profile_name,
      })
      .eq('id', deal.id);
    if (error) throw new Error(error.message);
    void qc.invalidateQueries({ queryKey: queryKeys.deal(deal.id) });
  });

  return (
    <section className="mt-4 space-y-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold">{t('notes_area.title')}</h2>
      <div>
        <Label htmlFor="deal-bpurl">{t('notes_area.business_profile_url')}</Label>
        <Input
          id="deal-bpurl"
          type="url"
          placeholder="https://"
          value={businessProfileUrl}
          onChange={(e) => setBusinessProfileUrl(e.target.value)}
          className="mt-1.5"
        />
      </div>
      <div>
        <Label htmlFor="deal-bpname">{t('notes_area.business_profile_name')}</Label>
        <Input
          id="deal-bpname"
          value={businessProfileName}
          onChange={(e) => setBusinessProfileName(e.target.value)}
          className="mt-1.5"
        />
      </div>
      <div>
        <Label htmlFor="sales-note">{t('notes_area.sales_note')}</Label>
        <textarea
          id="sales-note"
          value={salesNote}
          onChange={(e) => setSalesNote(e.target.value)}
          className={cn(
            'mt-1.5 block min-h-[88px] w-full resize-y rounded-lg border border-input/80 bg-background px-3 py-2 text-sm shadow-sm',
            'transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20',
          )}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">{t('notes_area.sales_note_hint')}</p>
      </div>
      <div className="flex h-5 items-center text-xs text-muted-foreground">
        {autoSaveLabel(status, lang)}
      </div>
    </section>
  );
}
