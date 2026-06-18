import { useState } from 'react';
import { infoFieldsFor, type InfoField } from './serviceInfoFields';
import { useUpdateJobDetails } from './hooks/useUpdateJobDetails';
import { useAutoSave } from '@/lib/autosave';

function FieldInput({
  field, value, onChange,
}: { field: InfoField; value: string; onChange: (v: string) => void }) {
  const [reveal, setReveal] = useState(false);
  if (field.type === 'textarea') {
    return (
      <textarea className="w-full rounded border px-2 py-1 text-sm" rows={4}
        value={value} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (field.type === 'password') {
    return (
      <div className="flex items-center gap-2">
        <input type={reveal ? 'text' : 'password'} className="w-full rounded border px-2 py-1 text-sm"
          value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="text-xs text-muted-foreground"
          onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide' : 'Reveal'}>
          {reveal ? '🙈' : '👁'}
        </button>
      </div>
    );
  }
  return (
    <input type={field.type === 'url' ? 'url' : 'text'} className="w-full rounded border px-2 py-1 text-sm"
      value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

export function JobInfoPanel({
  jobId, serviceType, initialDetails,
}: { jobId: string; serviceType: string; initialDetails: Record<string, unknown> }) {
  const fields = infoFieldsFor(serviceType);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = initialDetails[f.key] != null ? String(initialDetails[f.key]) : '';
    return v;
  });
  const update = useUpdateJobDetails(jobId);
  const status = useAutoSave(values, async (next) => { await update.mutateAsync(next); });

  const sections = Array.from(new Set(fields.map((f) => f.section ?? '')));
  return (
    <div className="max-w-2xl space-y-6">
      {sections.map((section) => (
        <div key={section} className="space-y-3">
          {section && <h3 className="text-sm font-semibold text-muted-foreground">{section}</h3>}
          {fields.filter((f) => (f.section ?? '') === section).map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs text-muted-foreground">{f.labelEn}</label>
              <FieldInput field={f} value={values[f.key] ?? ''}
                onChange={(val) => setValues((p) => ({ ...p, [f.key]: val }))} />
            </div>
          ))}
        </div>
      ))}
      <p className="h-4 text-xs text-muted-foreground">
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Save failed' : ''}
      </p>
    </div>
  );
}
