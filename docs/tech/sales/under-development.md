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
- **Welcome email: ΔΕΝ υπάρχει στο UD** — το έγγραφο δεν προβλέπει email στο
  Νέο Lead. Το κείμενο «Welcome» που έδωσε ο owner (28/08) είναι παρκαρισμένο
  εδώ για μελλοντική χρήση, μη εγκατεστημένο πουθενά.

## Admin

`/sales-automations`: μέρες ΚΑΙ ώρες ανά βήμα, enable/disable, thresholds.
Κείμενα: `/admin/email-automations` (DB rows are authoritative).
