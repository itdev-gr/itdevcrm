# Web Development board (`/tech/web-dev`)

Cards are **jobs** for website/app builds — usually one-time projects with
an optional maintenance tail.

## How cards arrive

A deal containing a Web Dev service reaches **Partial Payment** → the job
spawns in **Awaiting Brief**, and **unblocked** (unlike every other
service): build work starts on the deposit. Auto-assigned to the Web Dev
team lead when set.

## Stages

| #   | Stage              | Greek              | Meaning                                                                                               |
| --- | ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | Awaiting Brief     | Αναμονή Brief      | Entry column. Waiting for the client's brief/content/requirements.                                    |
| 2   | Discovery          | Ανακάλυψη          | Requirements analysis: sitemap, features, integrations, scope confirmation.                           |
| 3   | Wireframes         | Wireframes         | Page structure and UX skeleton for approval.                                                          |
| 4   | Design             | Σχεδιασμός         | Visual design on the approved wireframes.                                                             |
| 5   | Development        | Ανάπτυξη           | Build: templates, CMS, content entry, integrations.                                                   |
| 6   | Internal QA        | Εσωτερικός Έλεγχος | Internal testing: devices, browsers, forms, performance, SEO basics.                                  |
| 7   | Client Review      | Έλεγχος Πελάτη     | Client reviews the staging build.                                                                     |
| 8   | Revisions          | Διορθώσεις         | Working through the client's change requests.                                                         |
| 9   | **Live** ✅        | Παραδόθηκε         | Terminal (outcome **completed**). Site launched. Dropping the card here stamps the job completed (✓). |
| 10  | **Maintenance** ✅ | Συντήρηση          | Terminal (outcome **completed**). Post-launch care plan; also counts as completed delivery.           |

## Automations & rules

- Web Dev is the only service that spawns **unblocked** on partial payment.
- Accounting can still manually block the job (overdue balance before
  launch); the 🔒 badge shows in place.
- Live/Maintenance stamp `completed_at` (✓ on the card); dragging a card
  back out clears it.
