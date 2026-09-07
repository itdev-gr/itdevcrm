# Email Marketing UI (Φάση 1β) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Το περιβάλλον όπου ο ιδιοκτήτης στήνει και παρακολουθεί μια καμπάνια: νέα ενότητα **Company → Email marketing** (μόνο admin), οδηγός τεσσάρων βημάτων με ανέβασμα Excel, δοκιμαστική αποστολή, και πίνακας στοιχείων ανά καμπάνια.

**Architecture:** Καθαρό frontend πάνω στις RPC που ήδη υπάρχουν και είναι εφαρμοσμένες στην παραγωγή. Καμία νέα migration, καμία αλλαγή στη μηχανή αποστολής. Όλες οι εγγραφές περνούν από τις SECURITY DEFINER συναρτήσεις — οι πίνακες είναι SELECT-only υπό RLS, οπότε απευθείας `insert`/`update` από τον client **θα αποτύχει σιωπηλά**.

**Tech Stack:** React 19 + TypeScript, TanStack Query v5, react-router, zustand (`useAuthStore`), i18next (el/en), recharts, vitest + @testing-library/react.

## Global Constraints

- **Ο θεμελιώδης κανόνας του ιδιοκτήτη παραμένει:** μηδενική σχέση με τα αυτόματα email. Καμία αλλαγή σε `src/features/email/**`, `api/unsubscribe.ts`, `supabase/functions/send-email/**`, ή σε οτιδήποτε αφορά `email_outbox`/`email_log`.
- **Admin-only παντού.** Η ενότητα, οι διαδρομές και κάθε ερώτημα. Μη-admin δεν πρέπει ούτε να εκτελεί το query — `enabled: isAdmin`, όχι απλώς κρυμμένο κουμπί.
- Όλα τα ορατά κείμενα **και στα δύο** locale αρχεία. Νέο namespace `email_marketing`, δηλωμένο στο `src/lib/i18n.ts` **και** στα δύο `resources`.
- Καμία απευθείας εγγραφή σε πίνακα καμπάνιας. Μόνο `supabase.rpc(...)`.
- Κάθε RPC επιστρέφει `{ok:true,...}` ή `{ok:false,errors:[...]}` — **το `ok:false` δεν είναι εξαίρεση του δικτύου**, πρέπει να ελέγχεται ρητά και να εμφανίζεται μεταφρασμένο μήνυμα. Μη ελεγμένο `ok:false` = κουμπί που δεν κάνει τίποτα χωρίς εξήγηση (έχει ήδη συμβεί δύο φορές σε αυτό το repo).
- Οι αριθμοί λένε την αλήθεια: όσο τα ανοίγματα δεν μετρώνται, εμφανίζονται ως **«δεν μετράται»**, ποτέ `0`.

## Οι RPC που υπάρχουν και καλούμε

Δημιουργία/επεξεργασία: `campaign_create(p_name,p_subject,p_body_md,p_preheader,p_hero_image_url,p_reply_to)`, `campaign_update(p_campaign_id,p_patch jsonb)`, `campaign_delete`, `campaign_reset_to_draft`.
Λίστες: `audience_create(p_name,p_consent_basis,p_kind,p_source_file,p_source_note)`, `audience_add_members(p_audience_id,p_rows jsonb)` → `{added,invalid,duplicate}`, `audience_delete`, `campaign_attach_audience`, `campaign_detach_audience`.
Εκτέλεση: `build_campaign_recipients` → `{built,suppressed,by_reason}`, `campaign_launch/pause/resume/cancel`, `campaign_stats` → `{by_status,by_suppression_reason,sent,delivered,bounced,complained,unsubscribed}`.
Ρυθμίσεις: `marketing_settings_update(p_patch jsonb)`.
Δοκιμαστικό: edge function `send-campaign` με `{campaignId, test:true, to}`.

---

## File Structure

Όλα κάτω από `src/features/email_marketing/`:

| Αρχείο | Ευθύνη |
|---|---|
| `hooks/useCampaigns.ts` | λίστα, ένα, στατιστικά, παραλήπτες |
| `hooks/useCampaignMutations.ts` | create/update/delete/attach/detach/build/launch/pause/resume/cancel/reset |
| `hooks/useAudiences.ts` | λίστες + import + delete |
| `hooks/useSuppressions.ts` | λίστα αποκλεισμού + αφαίρεση |
| `CampaignsListPage.tsx` | πίνακας καμπανιών |
| `CampaignBuilderPage.tsx` | οδηγός 4 βημάτων |
| `steps/StepContent.tsx` `steps/StepAudience.tsx` `steps/StepReview.tsx` `steps/StepSchedule.tsx` | τα βήματα |
| `components/ImportAudienceDialog.tsx` | ανέβασμα Excel → αντιστοίχιση στηλών → εισαγωγή |
| `components/CampaignStatusBadge.tsx` `components/RecipientFunnel.tsx` `components/SuppressionBreakdown.tsx` | κοινά |
| `CampaignDetailPage.tsx` | στοιχεία + έλεγχος + παραλήπτες |
| `AudiencesPage.tsx` `SuppressionsPage.tsx` | διαχείριση |
| `campaignCopy.ts` + test | καθαρές συναρτήσεις κειμένου/ποσοστών |

Τροποποιούνται: `src/lib/queryKeys.ts`, `src/app/router.tsx`, `src/components/layout/Sidebar.tsx`, `src/lib/i18n.ts`, `src/i18n/locales/{el,en}/email_marketing.json` (νέα), `src/i18n/locales/{el,en}/common.json` (`nav.section.company`).

---

### Task 1: Θεμέλια — query keys, hooks, καθαρές συναρτήσεις

**Files:** `hooks/useCampaigns.ts`, `hooks/useCampaignMutations.ts`, `hooks/useAudiences.ts`, `hooks/useSuppressions.ts`, `campaignCopy.ts`, `campaignCopy.test.ts`, modify `src/lib/queryKeys.ts`

**Produces:**
- `queryKeys.campaigns()`, `.campaign(id)`, `.campaignStats(id)`, `.campaignRecipients(id)`, `.audiences()`, `.suppressions()`
- `useCampaigns()`, `useCampaign(id)`, `useCampaignStats(id)`, `useCampaignRecipients(id, filter)` — όλα `enabled: isAdmin`
- Ένα mutation ανά RPC. **Κάθε mutation ελέγχει `ok:false` και κάνει `throw new Error(errors[0])`** ώστε το UI να δείχνει μεταφρασμένο μήνυμα.
- `campaignCopy.ts`: `rate(numerator, denominator): number | null` (null όταν ο παρονομαστής είναι 0 — ποτέ διαίρεση με μηδέν, ποτέ `NaN%`), `formatRate(v: number|null): string` («—» όταν null), `openRateDisplay(stats, trackingEnabled): string` που επιστρέφει τη λέξη «δεν μετράται» όταν το tracking είναι κλειστό.

- [ ] **Step 1** Γράψε `campaignCopy.test.ts` με τις περιπτώσεις: παρονομαστής 0 → `null` → «—»· κανονικό ποσοστό· tracking κλειστό → «δεν μετράται» και **όχι** «0%».
- [ ] **Step 2** Τρέξε — πρέπει να αποτύχει.
- [ ] **Step 3** Υλοποίησε τα hooks και τις καθαρές συναρτήσεις.
- [ ] **Step 4** `npx vitest run src/features/email_marketing` πράσινο· `npx tsc --noEmit -p tsconfig.app.json`.
- [ ] **Step 5** Commit: `feat(marketing): campaign data hooks and honest rate helpers`

---

### Task 2: Η ενότητα Company και η λίστα καμπανιών

**Files:** `CampaignsListPage.tsx`, `components/CampaignStatusBadge.tsx`, modify `src/app/router.tsx`, `src/components/layout/Sidebar.tsx`, `src/lib/i18n.ts`, τα τέσσερα locale αρχεία

**Sidebar** (`src/components/layout/Sidebar.tsx`): νέο block **ανάμεσα στο `/dashboard` NavLink (~:167-173) και το block του Sales (~:174)**, με `{isAdmin && (...)}`, τίτλος `t('common:nav.section.company')` = «Εταιρεία», ένας σύνδεσμος «Email marketing» → `/company/email-marketing`. Χρησιμοποίησε `sidebarSectionClass()` / `sidebarLinkClass(isActive)` από το `./sidebar-nav-styles` και ένα εικονίδιο `Send` ή `Mails` από `lucide-react`.

**Routing** (`src/app/router.tsx`): κλάδος `{ path: 'company', element: <AdminGuard><Outlet /></AdminGuard>, children: [...] }` μέσα στο ίδιο επίπεδο με τα υπόλοιπα. Σελίδες με `lazyPage()`. **Τα στατικά μονοπάτια πριν το `:campaignId`** — αλλιώς το `/company/email-marketing/audiences` θα ερμηνευτεί ως id.

**CampaignsListPage**: πίνακας με όνομα, κατάσταση (badge), πλήθος παραληπτών, στάλθηκαν, παραδόθηκαν, bounce, ημερομηνία· κουμπί «+ Νέα καμπάνια» → `campaign_create` και μετάβαση στον οδηγό· σύνδεσμοι προς Λίστες και Αποκλεισμένους.

- [ ] Steps: test για το badge (κάθε κατάσταση → σωστό ελληνικό κείμενο) → υλοποίηση → tests/tsc/eslint → commit `feat(marketing): Company section and campaigns list`

---

### Task 3: Οδηγός, βήματα 1-2 (περιεχόμενο και παραλήπτες)

**Files:** `CampaignBuilderPage.tsx`, `steps/StepContent.tsx`, `steps/StepAudience.tsx`, `components/ImportAudienceDialog.tsx`

**StepContent**: θέμα, preheader, κείμενο (markdown-lite), URL εικόνας, reply-to. Αυτόματη αποθήκευση μέσω `campaign_update`. Προεπισκόπηση δίπλα.

**StepAudience**: συνδεδεμένες λίστες με πλήθος· «+ Εισαγωγή από Excel» → `ImportAudienceDialog`· αποσύνδεση.

**ImportAudienceDialog** — το κρίσιμο κομμάτι:
1. Αρχείο → `parseLeadFile(file)` από `src/features/leads/leadImport.ts` (**επαναχρησιμοποίηση, ήδη χειρίζεται ελληνικές κεφαλίδες**· μην γράψεις δεύτερο parser).
2. Προεπισκόπηση των πρώτων 10 γραμμών με την αντιστοίχιση στηλών ώστε ο χρήστης να δει τι κατάλαβε το σύστημα **πριν** δεσμευτεί.
3. **Υποχρεωτικό πεδίο «Βάση συναίνεσης»** (υπάρχων πελάτης / αίτημα / δημόσια επιχειρηματική / αγορασμένη / άλλο) + προαιρετική σημείωση προέλευσης. Το κουμπί εισαγωγής παραμένει ανενεργό όσο δεν έχει επιλεγεί — είναι το ίχνος που δικαιολογεί γιατί στέλνουμε σε αυτούς τους ανθρώπους.
4. `audience_create` → `audience_add_members` **σε παρτίδες των 500** (ένα Excel μπορεί να έχει χιλιάδες· ένα τεράστιο jsonb σε μία κλήση θα σκάσει).
5. Εμφάνισε την **αληθινή** αναφορά: «μπήκαν N, άκυρες N, διπλές N».

- [ ] Steps: tests για το dialog (το κουμπί ανενεργό χωρίς συναίνεση· η αναφορά εμφανίζεται· οι παρτίδες κόβονται στα 500) → υλοποίηση → tests/tsc/eslint → commit `feat(marketing): campaign builder content and audience steps`

---

### Task 4: Οδηγός, βήματα 3-4 (έλεγχος και εκκίνηση)

**Files:** `steps/StepReview.tsx`, `steps/StepSchedule.tsx`, `components/RecipientFunnel.tsx`, `components/SuppressionBreakdown.tsx`

**StepReview**: κουμπί «Υπολογισμός παραληπτών» → `build_campaign_recipients` → εμφάνιση χωνιού: χτίστηκαν / αποκλείστηκαν **ανά λόγο, στα ελληνικά** / τελικός στόχος. Κουμπί «**Δοκιμαστικό σε μένα**» που καλεί το `send-campaign` με `{campaignId, test:true, to}` — προσυμπληρωμένο με το email του συνδεδεμένου χρήστη.

**StepSchedule**: ημερήσιο/ωριαίο πλαφόν, παράθυρο ωρών, ημέρες. **Εκτιμώμενη ημερομηνία ολοκλήρωσης** υπολογισμένη από το πλαφόν και το πλήθος στόχου — ο ιδιοκτήτης πρέπει να δει ότι μια καμπάνια 10.000 θέλει μέρες, όχι ώρες. Κουμπί «Εκκίνηση» με **παράθυρο επιβεβαίωσης που δείχνει το ακριβές πλήθος**: «Θα σταλεί σε 4.312 άτομα. Δεν αναιρείται.»

- [ ] Steps: test για την εκτίμηση ολοκλήρωσης (πλήθος + πλαφόν → σωστός αριθμός ημερών) και για το ότι το κουμπί εκκίνησης απαιτεί επιβεβαίωση → υλοποίηση → tests/tsc/eslint → commit `feat(marketing): review, test send and scheduled launch`

---

### Task 5: Πίνακας στοιχείων καμπάνιας

**Files:** `CampaignDetailPage.tsx`, `components/RecipientDrawer.tsx`

Πλακίδια: στόχος, στάλθηκαν, παραδόθηκαν, bounce (με ποσοστό), παράπονα, απεγγραφές. Ποσοστά με ρητό παρονομαστή. **Ανοίγματα/κλικ: «δεν μετράται»** μέχρι τη Φάση 2.
Έλεγχος: Παύση / Συνέχιση / Ακύρωση με επιβεβαίωση. Αν η καμπάνια έχει σταματήσει αυτόματα, εμφάνισε τον λόγο (`autopause_reason`) εμφανώς — είναι προειδοποίηση για τη φήμη του τομέα.
Ανάλυση αποκλεισμών ανά λόγο. Συρτάρι παραληπτών με φίλτρο ανά κατάσταση και εξαγωγή CSV.
Ανανέωση κάθε 15 δευτερόλεπτα όσο η κατάσταση είναι `sending`.

- [ ] Steps: test ότι τα ανοίγματα δείχνουν «δεν μετράται» και όχι 0, και ότι το `autopause_reason` εμφανίζεται → υλοποίηση → tests/tsc/eslint → commit `feat(marketing): campaign dashboard with honest metrics`

---

### Task 6: Λίστες και Αποκλεισμένοι

**Files:** `AudiencesPage.tsx`, `SuppressionsPage.tsx`

**AudiencesPage**: όλες οι λίστες με πλήθος, βάση συναίνεσης, προέλευση, ημερομηνία· διαγραφή με σαφές μήνυμα όταν η λίστα χρησιμοποιείται (`in_use`).
**SuppressionsPage**: αναζήτηση στις ~450 διευθύνσεις, λόγος, πλήθος bounce, ημερομηνίες· αφαίρεση μέσω `unsuppress_email` με επιβεβαίωση που εξηγεί ότι η διεύθυνση θα ξαναγίνει επιλέξιμη.

- [ ] Steps: tests → υλοποίηση → tests/tsc/eslint → commit `feat(marketing): audiences and suppression management`

---

### Task 7: Deploy και ζωντανή επαλήθευση (controller)

- [ ] Θέσε **νέο** μυστικό `CAMPAIGN_DRAIN_SECRET` (όχι το `EMAIL_DRAIN_SECRET` — πρέπει να μπορούμε να κόψουμε τις καμπάνιες χωρίς να πέσουν τα transactional).
- [ ] Deploy `send-campaign` (**μετά** τις migrations — καλεί `release_unattempted_campaign_recipients` που υπάρχει μόνο από την `260000`).
- [ ] Deploy `resend-webhook` με τον νέο κλάδο καμπάνιας.
- [ ] **Δοκιμαστικό email σε δική μας διεύθυνση** και οπτικός έλεγχος: hero, κείμενο, υπογραφή, **ορατό λινκ απεγγραφής**, και τα δύο headers `List-Unsubscribe` στην πηγή του μηνύματος.
- [ ] Κλικ στο λινκ απεγγραφής → επιβεβαίωση ότι γράφτηκε `unsubscribed_at` **και** εγγραφή στο `email_suppressions`, και ότι **δεν** άλλαξε τίποτα στο `leads`.
- [ ] Επιβεβαίωση ότι το `email_pipeline_health()` παραμένει `ok`.
- [ ] **Καμία αποστολή σε πελάτη χωρίς ρητό GO του ιδιοκτήτη.**

---

## Verification

1. `npx vitest run` και `npx tsc --noEmit -p tsconfig.app.json` πράσινα.
2. **Απομόνωση**: `git diff --stat` δεν δείχνει `src/features/email/**`, `api/unsubscribe.ts`, `supabase/functions/send-email/**`, ούτε νέα migration.
3. Μη-admin: η ενότητα δεν εμφανίζεται, η διαδρομή ανακατευθύνει, και **κανένα query δεν εκτελείται**.
4. Ένα `ok:false` από οποιαδήποτε RPC εμφανίζει μεταφρασμένο μήνυμα, όχι σιωπή.
5. Εισαγωγή Excel 1.000 γραμμών: σπάει σε παρτίδες, η αναφορά συμφωνεί με το τι αποθηκεύτηκε.
6. Τα ανοίγματα δείχνουν «δεν μετράται», ποτέ `0`.
