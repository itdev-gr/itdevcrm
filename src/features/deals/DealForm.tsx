import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpsertDeal, type DealUpsert } from './hooks/useUpsertDeal';
import { useClients } from '@/features/clients/hooks/useClients';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import type { DealRow } from './hooks/useDeals';

// Number fields are treated as strings in RHF (HTML inputs always return strings).
// Conversion to number happens in onSubmit to avoid exactOptionalPropertyTypes conflicts
// between zod coerce and @hookform/resolvers with TS6.
const schema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  client_id: z.string().min(1),
  stage_id: z.string().min(1),
  expected_close_date: z.string().optional(),
  probability: z.string().optional(),
  lead_source: z.string().optional(),
  one_time_value: z.string().optional(),
  recurring_monthly_value: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  initial?: Partial<DealRow>;
  defaultClientId?: string;
  onDone?: (id: string) => void;
  onCancel?: () => void;
};

function toNum(v: string | undefined): number | undefined {
  if (v === '' || v === undefined) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

export function DealForm({ initial, defaultClientId, onDone, onCancel }: Props) {
  const { t, i18n } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const upsert = useUpsertDeal();
  const { data: clients = [] } = useClients();
  const { data: stages = [] } = usePipelineStages();

  const salesStages = stages
    .filter((s) => s.board === 'sales' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const defaultClientId_ = initial?.client_id ?? defaultClientId ?? '';
  const defaultStageId = initial?.stage_id ?? salesStages[0]?.id ?? '';

  const [clientId, setClientId] = useState(defaultClientId_);
  const [stageId, setStageId] = useState(defaultStageId);

  const { register, handleSubmit, formState, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      client_id: defaultClientId_,
      stage_id: defaultStageId,
      expected_close_date: initial?.expected_close_date ?? '',
      probability: initial?.probability !== undefined ? String(initial.probability) : '50',
      lead_source: initial?.lead_source ?? '',
      one_time_value:
        initial?.one_time_value !== undefined ? String(Number(initial.one_time_value)) : '0',
      recurring_monthly_value:
        initial?.recurring_monthly_value !== undefined
          ? String(Number(initial.recurring_monthly_value))
          : '0',
    },
  });

  async function onSubmit(values: FormValues) {
    // Build typed payload — strip empty strings, convert number strings to numbers.
    const payload: Partial<DealUpsert> & { client_id: string; title: string; stage_id: string } = {
      client_id: values.client_id,
      title: values.title,
      stage_id: values.stage_id,
    };
    if (values.description) payload.description = values.description;
    if (values.expected_close_date) payload.expected_close_date = values.expected_close_date;
    if (values.lead_source) payload.lead_source = values.lead_source;
    const prob = toNum(values.probability);
    if (prob !== undefined) payload.probability = prob;
    const otv = toNum(values.one_time_value);
    if (otv !== undefined) payload.one_time_value = otv;
    const rmv = toNum(values.recurring_monthly_value);
    if (rmv !== undefined) payload.recurring_monthly_value = rmv;
    if (initial?.id) payload.id = initial.id;

    const id = await upsert.mutateAsync(payload);
    onDone?.(id);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label htmlFor="title">{t('form.title')}</Label>
        <Input id="title" {...register('title')} />
      </div>
      <div>
        <Label>{t('form.client')}</Label>
        <Select
          value={clientId}
          onValueChange={(v) => {
            setClientId(v);
            setValue('client_id', v);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t('form.stage')}</Label>
        <Select
          value={stageId}
          onValueChange={(v) => {
            setStageId(v);
            setValue('stage_id', v);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {salesStages.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {(s.display_names as { en: string; el: string })[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="probability">{t('form.probability')}</Label>
        <Input id="probability" type="number" min="0" max="100" {...register('probability')} />
      </div>
      <div>
        <Label htmlFor="ecd">{t('form.expected_close_date')}</Label>
        <Input id="ecd" type="date" {...register('expected_close_date')} />
      </div>
      <div>
        <Label htmlFor="otv">{t('form.one_time_value')}</Label>
        <Input id="otv" type="number" step="0.01" min="0" {...register('one_time_value')} />
      </div>
      <div>
        <Label htmlFor="rmv">{t('form.recurring_monthly_value')}</Label>
        <Input
          id="rmv"
          type="number"
          step="0.01"
          min="0"
          {...register('recurring_monthly_value')}
        />
      </div>
      <div>
        <Label htmlFor="src">{t('form.lead_source')}</Label>
        <Input id="src" {...register('lead_source')} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="desc">{t('form.description')}</Label>
        <Input id="desc" {...register('description')} />
      </div>

      <div className="md:col-span-2 flex gap-2">
        <Button type="submit" disabled={upsert.isPending || formState.isSubmitting}>
          {upsert.isPending ? t('form.submitting') : t('form.submit')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
