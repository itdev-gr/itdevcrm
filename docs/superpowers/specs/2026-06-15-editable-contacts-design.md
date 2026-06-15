# Editable Contacts with Click-to-Call — Design Spec

**Date:** 2026-06-15

**Goal:** Everywhere contacts appear (leads, clients, jobs), the **primary** contact and **each additional** contact default to a **read-only view** whose **phone is a click-to-call link**. Each contact has an **✏️ edit button** that flips just that contact into the existing editable fields (autosave), and a **✓ Done** button to flip back to view.

**Why:** the contact phone is currently an always-editable `<input>`, so clicking it edits instead of triggering a call. A view/edit toggle makes the phone clickable (via the existing `CallLink`) while keeping editing one button away.

**Non-goals (YAGNI):** schema/migration changes; bulk edit; contact reordering; new validation.

---

## Architecture

One reusable component drives the behaviour everywhere:

**`src/features/contacts/EditableContact.tsx`** — view/edit toggle for a single contact.
- **Props:** `value: { full_name; email; phone; info }`, `onChange(next)`, `onRemove?()`, `disabled?: boolean`, `startEditing?: boolean`.
- **Internal state:** `editing` (defaults to `startEditing ?? false`).
- **View mode:** name in bold; email as a `mailto:` link (when present); **phone via `<CallLink phone={value.phone} />`** (the existing `@/components/CallLink`, renders a `tel:` link); info as muted text. An **✏️ edit** button (hidden when `disabled`); a **× remove** button when `onRemove` is provided and not `disabled`.
- **Edit mode:** four inputs (`full_name`, `email` [type=email], `phone`, `info`) wired to `onChange`; a **✓ Done** button that sets `editing=false`; remove button as above.
- Empty/just-added contacts start in edit mode (`startEditing`).

It is purely a **display toggle** — saving stays with the parent (autosave), so there's a single source of truth and no schema change.

---

## Where it's applied

**Additional contacts (shared) — `src/features/contacts/AdditionalContactsField.tsx`:** each row becomes an `EditableContact` (`value=row`, `onChange=patchRow`, `onRemove=removeRow`). "Add contact" appends a row that starts in edit mode. The `disabled` prop makes all rows view-only (no edit/remove/add). This single change covers additional contacts on **leads, clients, and jobs**.

**Primary contact — wrapped in `EditableContact` in:**
- `src/features/jobs/ContactsCard.tsx` (`ContactsForm`) — maps `{ full_name: joined name, email, phone, info: contact_info }` ↔ the form's `setFullName/setEmail/setPhone/setContactInfo`, which already autosave to the client.
- `src/features/leads/LeadForm.tsx` and `src/features/clients/ClientForm.tsx` — the primary-contact section (name/email/phone/contact-info) moves into `EditableContact`, wired to the form's existing autosaved state. Where those fields are permission-gated read-only, pass `disabled` so no edit button shows. (Other, non-contact form fields are unchanged.)

---

## Data flow & saving
- No schema change. `EditableContact` raises `onChange` on every keystroke in edit mode; the parent's existing `useAutoSave` persists to the `leads` / `clients` row exactly as today.
- `✓ Done` and `✏️ edit` only toggle local display state.

## Error handling
- Saving errors surface through the parent's existing autosave status indicator (unchanged).
- A contact with an empty/short phone renders as plain text (the `CallLink` already falls back to a non-link placeholder).

## Testing
- `EditableContact.test.tsx`: view mode renders the phone as a `tel:` link and email as a `mailto:` link; clicking **✏️** reveals the inputs; editing a field fires `onChange`; clicking **✓ Done** returns to view.
- Update `AdditionalContactsField` tests to the new per-row view/edit structure.

## Changes / Revert
- **New:** `EditableContact.tsx` (+ test).
- **Modified:** `AdditionalContactsField.tsx` (rows → EditableContact), `ContactsCard.tsx`, `LeadForm.tsx`, `ClientForm.tsx` (primary contact → EditableContact).
- **Revert:** restore the always-editable inputs in those four files and delete `EditableContact`.
