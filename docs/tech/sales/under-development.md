# Under Development pipeline — η ροή του ΡΟΗ_ΝΕΟΥ_LEAD.docx

Το UD board υλοποιεί ΕΠΑΚΡΙΒΩΣ το έγγραφο ροής του owner (ευθυγράμμιση
2026-08-28, migration `20260828230000_ud_doc_alignment.sql`). Το κλασικό sales
pipeline ΔΕΝ αγγίχτηκε — templates/χρονισμοί του μένουν ως είχαν (ρητή απόφαση).

## Η ροή

1. **Νέο Lead** (`ud_new_lead`): αυτόματο task «1η Κλήση» στον πωλητή.
   - «Δεν απάντησε» → task «2η Κλήση» **+4 ώρες** (κανόνας του εγγράφου· η
     cadence engine απέκτησε `delay_hours`).
   - «Μίλησα» → χειροκίνητη επιλογή επόμενου βήματος (προσφορά/ραντεβού/κ.λπ.).
   - Εξάντληση → πρόταση μετακίνησης σε **No Answer**.
2. **No Answer** (`ud_no_answer`) — T0 email `ud_noanswer_1` → T+2 task Callback
   → email `ud_noanswer_2` (αν «Δεν απάντησε») → T+4 task 2ο Callback → email
   `ud_noanswer_3` («Τελευταία Προσπάθεια», πριν την τελευταία κλήση) → T+7
   τελευταίο Callback → εξάντληση → πρόταση **Not Found**.
3. **Offer Sent** (`ud_offer_sent`, auto-μετακίνηση όταν δημιουργείται offer):
   T+3 email `ud_offer_checkin` → T+4 task Follow-up Κλήση → email
   `ud_offer_followup_1` ([]«Δεν απάντησε») → T+6 task → T+8 τελευταίο task →
   email `ud_offer_followup_2` («Τελευταία επικοινωνία», ΜΕΤΑ την τελευταία
   κλήση, όπως το έγγραφο) → εξάντληση → πρόταση **Not Interested**.
4. Απάντηση πελάτη (inbound email ή κλήση) → **auto-pause** της αλυσίδας.

## Emails

- Τα 6 `ud_*` templates φέρουν τα ΤΕΛΙΚΑ κείμενα του owner (subjects
  «ITDEV | … - {{name}} ({{code}})», σώμα με `{{phone}}` όπου το έγγραφο λέει
  [ΤΗΛΕΦΩΝΟ] — το `lead_email_payload` απέκτησε `phone`).
- **Κανένα sign-off στα σώματα** — η υπογραφή μπαίνει από το personal-Gmail
  transport (κανόνας 20260828170000).
- Το offer email για UD leads χρησιμοποιεί τα `ud_offer_email_intro/outro`
  (board-aware OfferEmailDialog — lead σε στάδιο `ud_%`), με το
  `{{offer_url}}` (δημόσιο link `/o/<token>`, ανοίγματα → offer_views →
  σχόλιο στο lead). Τα κλασικά `offer_email_intro/outro` μένουν για τα λοιπά.
- **Welcome email**: στέλνεται ΑΜΕΣΩΣ με την είσοδο στο Νέο Lead (`ud_welcome`,
  step 5 της ud_first_call — owner approval 2026-08-28, πριν το task «1η
  Κλήση»)· το ίδιο κείμενο μπήκε και στο κλασικό `lead_welcome` (Unique Lead).

## Admin

`/sales-automations`: μέρες ΚΑΙ ώρες ανά βήμα, enable/disable, thresholds.
Κείμενα: `/admin/email-automations` (DB rows are authoritative).

## Κύκλος ζωής — κανένα task δεν επιζεί του lead του (2026-08-30)

- **Stage move** (και στα terminal Not Interested / Not Found / Dead End): το
  `trg_ud_leads_cadence_upd` σταματά το ζωντανό run και κλείνει το ανοιχτό
  task («superseded»)· τα terminal stages δεν έχουν cadence, άρα δεν ξεκινά
  τίποτα.
- **Archive**: `trg_ud_leads_stop_on_archive` → το run σταματά
  (`stopped_manual`), το task κλείνει. Το unarchive ΔΕΝ ξαναξεκινά αλυσίδα —
  ο πωλητής αποφασίζει μετακινώντας stage.
- **Delete**: `trg_ud_leads_delete_cadence_tasks` σβήνει πρώτα τα cadence
  tasks του lead, ώστε να μην ορφανεύουν στο γενικό tasks board.

(migration `20260830090000_ud_stop_on_archive_delete.sql`, live-verified E2E)

## Parking (2026-08-30)

Πρώτο column του board (`ud_parking`, position 5) — ΝΕΚΡΟ κατά κατασκευή:
κανένα cadence δεν δένει πάνω του, οπότε ό,τι μπαίνει εκεί δεν ανοίγει task
ούτε στέλνει email· και το πάρκάρισμα lead με ζωντανό chain το σταματά
(ο γενικός stage-change trigger). Προορισμός: το μελλοντικό migration του
κλασικού pipeline — τα leads θα μπουν μαζικά στο Parking και θα βγαίνουν
σταδιακά στο Νέο Lead, ώστε να μην ανοίξουν εκατοντάδες tasks μονομιάς.
(migration `20260830120000_ud_parking_stage.sql`, live-verified E2E)

## Go-live: όλα τα νέα leads στο UD (2026-08-31)

Το migration ΕΓΙΝΕ (31/8): όλα τα ζωντανά leads του κλασικού board πήγαν στο
UD (Parking 5.156 μοιρασμένα, Dead End 818, Won 611) και το κλασικό board
έμεινε μόνο με αρχειοθετημένα. Τα ΝΕΑ εισερχόμενα (Meta/φόρμες/imports →
lead_intake) πλέον προσγειώνονται στο **ud_new_lead** (migration
`20260831120000_intake_release_to_ud.sql`): release/bulk/auto-release
δείχνουν εκεί, το re-engage merge ανεβάζει το υπάρχον lead σε ud_new_lead
(η αλυσίδα ξαναρχίζει), και τα guards «είναι ήδη πελάτης» έμαθαν το
`ud_won`. Ροή: intake → auto-release → ud_new_lead → owner από τη ρόδα →
task «1η Κλήση».

## Εκκρεμότητες (2026-08-31, αποφάσεις owner)

- Re-engagement 90 ημερών: ΔΕΝ θα γίνει προς το παρόν (απόφαση 2026-08-30).
- Welcome email (ud_welcome): ΚΛΕΙΣΤΟ με εντολή owner — νέα leads δεν
  παίρνουν κανένα email εισόδου μέχρι να το ξανανοίξει.
- Κλασικά email_sequences (no_answer/offer_sent/reengage): ενεργά αλλά
  αδρανή — κανένα lead δεν κάθεται πια σε κλασικά στάδια.
- `scheduled_confirm` gate: παραμένει OFF στην prod μέχρι να το ανάψει ο owner.
- Το κλασικό board μένει στο sidebar ως αρχείο· απόσυρση όποτε πει ο owner.
