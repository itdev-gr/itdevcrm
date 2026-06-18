import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';
import { cn } from '@/lib/utils';
import { useDealJobs, type DealJob } from './hooks/useDealJobs';
import type { DealRow } from './hooks/useDeals';

function noteFrom(
  jobs: DealJob[],
  types: string[],
  key: string,
): { present: boolean; value: string } {
  const job = jobs.find((j) => types.includes(j.service_type));
  if (!job) return { present: false, value: '' };
  const v = job.details?.[key];
  return { present: true, value: v == null ? '' : String(v) };
}

export function DealNotesArea({ deal }: { deal: DealRow }) {
  const { t, i18n } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const qc = useQueryClient();
  const { data: jobs = [] } = useDealJobs(deal.id);

  const [salesNote, setSalesNote] = useState(deal.sales_note ?? '');

  const webSeo = noteFrom(jobs, ['web_seo', 'ai_seo'], 'seo_notes');
  const local = noteFrom(jobs, ['local_seo', 'ai_seo'], 'local_notes');
  const website = noteFrom(jobs, ['web_dev'], 'webdev_notes');

  const patch = useMemo(() => ({ sales_note: salesNote.trim() || null }), [salesNote]);
  const status = useAutoSave(patch, async (next) => {
    const { error } = await supabase
      .from('deals')
      .update({ sales_note: next.sales_note })
      .eq('id', deal.id);
    if (error) throw new Error(error.message);
    void qc.invalidateQueries({ queryKey: queryKeys.deal(deal.id) });
  });

  const readOnlyNote = (label: string, value: string) => (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">
        {value || <span className="text-muted-foreground/60">{t('notes_area.empty')}</span>}
      </div>
    </div>
  );

  return (
    <section className="mt-4 space-y-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold">{t('notes_area.title')}</h2>
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
      {webSeo.present && readOnlyNote(t('notes_area.web_seo_notes'), webSeo.value)}
      {local.present && readOnlyNote(t('notes_area.local_notes'), local.value)}
      {website.present && readOnlyNote(t('notes_area.website_notes'), website.value)}
      <div className="flex h-5 items-center text-xs text-muted-foreground">
        {autoSaveLabel(status, lang)}
      </div>
    </section>
  );
}
