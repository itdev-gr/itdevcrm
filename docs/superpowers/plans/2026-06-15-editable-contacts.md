# Editable Contacts with Click-to-Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the primary contact and every additional contact (on leads and jobs, and additional contacts everywhere) default to a read-only view whose phone is a click-to-call link, with a per-contact ✏️ edit button (and ✓ Done) — autosaving as before.

**Architecture:** One reusable `EditableContact` (view/edit toggle, phone via the existing `CallLink`, email as `mailto:`) drives both the primary and additional contacts. `AdditionalContactsField` renders each row through it; `LeadForm` and the job `ContactsCard` wrap their primary contact in it. No schema change — saving stays with the parents' autosave.

**Tech Stack:** Vite + React 19 + TS strict, Vitest + Testing Library + user-event, Tailwind, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-15-editable-contacts-design.md`

**ClientForm note (scope decision deferred to handoff):** `ClientForm` keeps its contact fields in a flat `PermissionAwareInput` grid and **already has a click-to-call link under the phone** (from the PBX work). Wrapping it in the toggle is disruptive and low-value, so it's intentionally **not** in this plan — see the handoff question.

---

## File Structure

| File | Responsibility | New/Modify |
| --- | --- | --- |
| `src/features/contacts/EditableContact.tsx` | reusable view/edit contact card | Create |
| `src/features/contacts/EditableContact.test.tsx` | component test | Create |
| `src/features/contacts/AdditionalContactsField.tsx` | rows → `EditableContact` | Modify |
| `src/features/leads/LeadForm.tsx` | primary contact → `EditableContact` | Modify |
| `src/features/jobs/ContactsCard.tsx` | primary contact → `EditableContact` | Modify |

---

## Task 1: `EditableContact` component

**Files:** Create `src/features/contacts/EditableContact.tsx`, `src/features/contacts/EditableContact.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/contacts/EditableContact.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditableContact } from './EditableContact';

const val = { full_name: 'Maria P', email: 'maria@acme.gr', phone: '6912345678', info: 'CEO' };

describe('EditableContact', () => {
  it('view mode shows phone as tel: and email as mailto:', () => {
    render(<EditableContact value={val} onChange={() => {}} />);
    expect(screen.getByRole('link', { name: /6912345678/ })).toHaveAttribute('href', 'tel:+306912345678');
    expect(screen.getByRole('link', { name: 'maria@acme.gr' })).toHaveAttribute('href', 'mailto:maria@acme.gr');
  });
  it('edit button reveals inputs; Done returns to view', async () => {
    const u = userEvent.setup();
    render(<EditableContact value={val} onChange={() => {}} />);
    await u.click(screen.getByLabelText('Edit contact'));
    expect(screen.getByDisplayValue('Maria P')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Done/ }));
    expect(screen.getByRole('link', { name: /6912345678/ })).toBeInTheDocument();
  });
  it('hides the edit button when disabled', () => {
    render(<EditableContact value={val} onChange={() => {}} disabled />);
    expect(screen.queryByLabelText('Edit contact')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/features/contacts/EditableContact.test.tsx`
Expected: FAIL — cannot resolve `./EditableContact`.

- [ ] **Step 3: Implement**

```tsx
// src/features/contacts/EditableContact.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CallLink } from '@/components/CallLink';

export type ContactValue = { full_name: string; email: string; phone: string; info: string };

type Props = {
  value: ContactValue;
  onChange: (next: ContactValue) => void;
  onRemove?: () => void;
  disabled?: boolean;
  startEditing?: boolean;
  idPrefix?: string;
};

export function EditableContact({
  value, onChange, onRemove, disabled, startEditing, idPrefix = 'c',
}: Props) {
  const [editing, setEditing] = useState(!!startEditing);
  const set = (patch: Partial<ContactValue>) => onChange({ ...value, ...patch });

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border bg-slate-50 p-3">
        <div className="min-w-0 space-y-0.5 text-sm">
          <div className="font-medium">{value.full_name || '—'}</div>
          {value.email && (
            <div>
              <a href={`mailto:${value.email}`} className="text-blue-700 hover:underline">{value.email}</a>
            </div>
          )}
          {value.phone && <div><CallLink phone={value.phone} /></div>}
          {value.info && <div className="text-slate-500">{value.info}</div>}
        </div>
        {!disabled && (
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="sm" variant="outline" aria-label="Edit contact"
              onClick={() => setEditing(true)}>✏️</Button>
            {onRemove && (
              <Button type="button" size="sm" variant="destructive" aria-label="Remove contact"
                onClick={onRemove}>×</Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border bg-slate-50 p-3">
      <div className="col-span-2">
        <Label htmlFor={`${idPrefix}-name`} className="text-xs">Full name</Label>
        <Input id={`${idPrefix}-name`} value={value.full_name} disabled={disabled}
          onChange={(e) => set({ full_name: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-email`} className="text-xs">Email</Label>
        <Input id={`${idPrefix}-email`} type="email" value={value.email} disabled={disabled}
          onChange={(e) => set({ email: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-phone`} className="text-xs">Phone</Label>
        <Input id={`${idPrefix}-phone`} value={value.phone} disabled={disabled}
          onChange={(e) => set({ phone: e.target.value })} />
      </div>
      <div className="col-span-2">
        <Label htmlFor={`${idPrefix}-info`} className="text-xs">Info</Label>
        <Input id={`${idPrefix}-info`} value={value.info} disabled={disabled}
          placeholder="e.g. CFO · best after 5pm"
          onChange={(e) => set({ info: e.target.value })} />
      </div>
      <div className="col-span-2 flex justify-end gap-1">
        {onRemove && (
          <Button type="button" size="sm" variant="destructive" onClick={onRemove}>× Remove</Button>
        )}
        <Button type="button" size="sm" onClick={() => setEditing(false)}>✓ Done</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/features/contacts/EditableContact.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/contacts/EditableContact.tsx src/features/contacts/EditableContact.test.tsx
git commit -m "feat(contacts): EditableContact view/edit card with click-to-call"
```

---

## Task 2: `AdditionalContactsField` rows → `EditableContact`

**Files:** Modify `src/features/contacts/AdditionalContactsField.tsx`; Create `src/features/contacts/AdditionalContactsField.test.tsx`.

- [ ] **Step 1: Replace the row body**

Replace the whole `<ul>…</ul>` block (the `value.map(...)` rendering the grid of `Input`s + remove button) with rows rendered through `EditableContact`. The new component body becomes:

```tsx
import { Button } from '@/components/ui/button';
import { EditableContact } from './EditableContact';

export type AdditionalContact = {
  full_name: string;
  email: string;
  phone: string;
  info: string;
};

type Props = {
  value: AdditionalContact[];
  onChange: (next: AdditionalContact[]) => void;
  disabled?: boolean;
};

const EMPTY: AdditionalContact = { full_name: '', email: '', phone: '', info: '' };

export function AdditionalContactsField({ value, onChange, disabled }: Props) {
  function addRow() {
    onChange([...value, { ...EMPTY }]);
  }
  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function patchRow(idx: number, next: AdditionalContact) {
    onChange(value.map((row, i) => (i === idx ? next : row)));
  }

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="space-y-3">
          {value.map((row, idx) => (
            <li key={idx}>
              <EditableContact
                value={row}
                onChange={(next) => patchRow(idx, next)}
                onRemove={disabled ? undefined : () => removeRow(idx)}
                disabled={disabled}
                startEditing={!row.full_name && !row.email && !row.phone && !row.info}
                idPrefix={`ac-${idx}`}
              />
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          + Add contact
        </Button>
      )}
    </div>
  );
}
```

Keep the existing `parseAdditionalContacts` export at the bottom of the file **unchanged**. Remove the now-unused `Input` and `Label` imports.

- [ ] **Step 2: Write a test for the new structure**

```tsx
// src/features/contacts/AdditionalContactsField.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdditionalContactsField } from './AdditionalContactsField';

describe('AdditionalContactsField', () => {
  it('shows a saved contact in view mode with a click-to-call phone', () => {
    render(
      <AdditionalContactsField
        value={[{ full_name: 'Bob', email: '', phone: '6912345678', info: '' }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: /6912345678/ })).toHaveAttribute('href', 'tel:+306912345678');
  });
  it('adds a new row that starts in edit mode', async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(<AdditionalContactsField value={[]} onChange={onChange} />);
    await u.click(screen.getByRole('button', { name: /Add contact/ }));
    expect(onChange).toHaveBeenCalledWith([{ full_name: '', email: '', phone: '', info: '' }]);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/features/contacts/AdditionalContactsField.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add src/features/contacts/AdditionalContactsField.tsx src/features/contacts/AdditionalContactsField.test.tsx
git commit -m "feat(contacts): additional contacts use EditableContact (view/edit + click-to-call)"
```

---

## Task 3: LeadForm primary contact → `EditableContact`

**Files:** Modify `src/features/leads/LeadForm.tsx`.

- [ ] **Step 1: Add the import**

Near the other imports add:

```tsx
import { EditableContact } from '@/features/contacts/EditableContact';
```

- [ ] **Step 2: Replace the primary-contact inputs**

Replace the primary-contact block — the `Full name` / `Email` / `Phone` / `Info` `<Input>` group (the section rendering `fullName`, `email`, `phone`, `contactInfo` via `<Input>`/`<Label>`) — with:

```tsx
            <EditableContact
              value={{ full_name: fullName, email, phone, info: contactInfo }}
              onChange={(c) => {
                setFullName(c.full_name);
                setEmail(c.email);
                setPhone(c.phone);
                setContactInfo(c.info);
              }}
              disabled={!!lead.converted_at}
              startEditing={!fullName && !email && !phone && !contactInfo}
              idPrefix="lead-primary"
            />
```

Remove any now-unused `Input`/`Label` imports only if no other field in the file still uses them (the file has other fields — verify with the linter; keep imports that are still referenced).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run src/features/leads`
Expected: typecheck clean; lead tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/leads/LeadForm.tsx
git commit -m "feat(leads): primary contact uses EditableContact (view/edit + click-to-call)"
```

---

## Task 4: Job ContactsCard primary contact → `EditableContact`

**Files:** Modify `src/features/jobs/ContactsCard.tsx`.

- [ ] **Step 1: Add the import**

```tsx
import { EditableContact } from '@/features/contacts/EditableContact';
```

- [ ] **Step 2: Replace the Primary-contact `<section>` body**

Replace the inner `<div className="grid grid-cols-2 gap-3">…</div>` of the "Primary contact" section (the `cc-name` / `cc-email` / `cc-phone` / `cc-info` inputs) with:

```tsx
          <EditableContact
            value={{ full_name: fullName, email, phone, info: contactInfo }}
            onChange={(c) => {
              setFullName(c.full_name);
              setEmail(c.email);
              setPhone(c.phone);
              setContactInfo(c.info);
            }}
            startEditing={!fullName && !email && !phone && !contactInfo}
            idPrefix="cc-primary"
          />
```

Remove the now-unused `Input` import if nothing else in the file uses it (the file still imports `Label`/`Input` for the old inputs — keep `Label` only if still used; the additional-contacts section no longer uses them here).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run src/features/jobs && npm run lint`
Expected: typecheck clean; jobs tests PASS; 0 lint warnings.

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/ContactsCard.tsx
git commit -m "feat(jobs): contact card primary contact uses EditableContact"
```

---

## Task 5: Gate, push, verify

- [ ] **Step 1: Full suite**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: all green, 0 lint warnings.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Production verify** — as admin: open a **lead** → primary contact shows read-only with the phone as a click-to-call link; ✏️ reveals inputs, edit + ✓ Done returns to view, change persists on reload. An **additional contact** → same behaviour; "Add contact" opens a new editable row. Open a **job** → ContactsCard primary contact behaves the same.

---

## Changes / Revert
- **New:** `EditableContact.tsx` (+ test), `AdditionalContactsField.test.tsx`.
- **Modified:** `AdditionalContactsField.tsx`, `LeadForm.tsx`, `ContactsCard.tsx`.
- **Revert:** restore the previous inline `<Input>` grids in those three files and delete `EditableContact` + the new test.
