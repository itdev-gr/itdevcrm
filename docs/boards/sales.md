# Sales pipeline (`/sales/kanban`)

The sales board is where every prospect is worked from first contact to a
closed sale. Cards are **leads** (a deal-in-progress). Salespeople work their
own leads; admins see everyone's and can filter by owner. Winning a lead
converts it into a **client + deal** and hands it off to Accounting — see
[Winning a lead](#winning-a-lead--conversion) below.

## How cards arrive

A lead can enter the board three ways, recorded in its **Source** (used by the
Source filter):

- **Manual** — "Add lead" on the pipeline (or from Sales → My Clients). The
  salesperson types in the contact + company details.
- **Meta** — Facebook/Instagram lead-form submissions land automatically with
  source = **Meta** (the raw form payload is kept on the lead for reference).
- **Import** — leads brought in through a bulk import carry source = **Import**.

Every lead is stamped with:

- a **unique sequential code** (shown on the card, click to copy) that the
  client and deal **inherit** when the lead is won, so one number follows the
  customer end-to-end;
- an **owner** (the responsible salesperson);
- **planned services** with pricing — each line is one-time, monthly, or yearly,
  and VAT is applied by the client's country;
- **contacts** (primary + additional) and **company data** (industry, country,
  address, VAT number, website).

## The lead card

Each card surfaces, at a glance:

- **Code** (copyable) and the **contact or company name**, with industry as a subtitle;
- **Value** — the one-time amount, plus `€X/month` when there's a recurring line;
- **Owner** (👤) — or "unassigned";
- **Phone** — a click-to-call link (dials through the agent's softphone);
- **Planned services** — the service types attached to the lead;
- **Scheduled / Follow-up** (📞) — the booked date+time when set;
- **Converted** (✓ green) — once the lead has been won;
- **"Sales person: …"** — who closed it (admins only);
- a **relative date** (🗓 "X days ago").

Cards update **live**: when anyone moves or edits a lead, every open board
reflects it without a refresh.

## Stages

| #   | Stage              | Greek              | What it means / what the team does                                                                                                                                  |
| --- | ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **New Lead**       | Νέος Πελάτης       | Fresh, untouched lead — first call pending. The lead page's "next new lead" button jumps straight to the next unworked one so reps can dial through them.            |
| 2   | **No Answer**      | Δεν Απαντά         | Called once or twice, no contact yet. Keep retrying.                                                                                                                |
| 3   | **Constant NA**    | Σταθερά Δεν Απαντά | Repeatedly unreachable. Low-priority retry pool; candidates for Dead End after enough attempts.                                                                     |
| 4   | **Working On It**  | Σε Εξέλιξη         | Contact made — analysis, pricing discussion, and proposal prep happen here.                                                                                         |
| 5   | **Offer Sent**     | Προσφορά Στάλθηκε  | A proposal/offer went out; awaiting the client's answer. Creating an offer moves the lead here automatically (see [Offers](#offers)).                               |
| 6   | **Scheduled**      | Προγραμματισμένο   | A call/meeting is booked. Setting a "Scheduled for" date on the lead moves the card here automatically and puts the appointment on the home calendar.               |
| 7   | **Hot**            | Καυτό              | Strong verbal interest; closing is imminent. Prioritise daily.                                                                                                      |
| 8   | **Won** ✅         | Κερδισμένο         | Terminal (outcome **won**). Converts the lead to a **client + deal**, locks the deal, records who closed it, and opens a card on the Accounting onboarding board. See below. |
| 9   | **Not Interested** | Μη Ενδιαφέρον      | Terminal (outcome **lost**). A clean "no".                                                                                                                          |
| 10  | **Dead End**       | Αδιέξοδο           | Terminal (outcome **lost**). Unreachable or invalid leads.                                                                                                          |

You move a card by dragging it (with the right permission) or via the
**"Move to stage"** dropdown on the lead page.

## Automatic stage moves

Two actions move a card for you, so the board reflects reality without manual
dragging:

- **Set a "Scheduled for" date** → the lead jumps to **Scheduled** (unless it's
  already at a terminal stage) and the appointment appears on the home calendar.
- **Create an offer** → the lead moves to **Offer Sent**, and a follow-up date
  can be set automatically based on the owner's "offer follow-up days" setting.
  (Leads already at Scheduled/Won/Not Interested/Dead End are left where they are.)

## Offers

Offers are built per lead and tracked separately:

- **Offer Builder** (`/leads/:id/offers/new`) — pre-fills from the lead's
  planned services and the offer catalogue (default packages per service type).
  You adjust line items, quantities, custom prices, discount, VAT %, validity
  days, and notes, then save.
- Saving an offer **moves the lead to Offer Sent** automatically.
- **Send offer** — on a lead that's in Offer Sent, the "Send offer" button opens
  an email draft (from your own account) to send the proposal to the client.
- **Offer status** — draft → sent → accepted / rejected / expired. Each offer
  has its own number, a **Download PDF**, and shows up in the lead's **Offers**
  tab.

## Winning a lead — conversion

Dropping a card on **Won** (or choosing Won from the lead's stage dropdown) runs
the conversion. It requires the closing permission and that the lead passes a
few checks — otherwise it's blocked with a clear reason:

- not already converted, not archived;
- has at least one value (one-time or recurring > 0);
- has at least one planned service;
- has an **email**, a **phone or address**, and a **company name**.

On success it, in one step:

1. **creates a client** from the lead's details (inheriting owner + code);
2. **creates a deal** for that client with the planned services and values,
   and **locks it** against edits (so the sold scope can't drift);
3. **copies the lead's comments and attachments** onto the deal;
4. **marks the lead converted** — stamps `converted_at`, links the new client +
   deal, and records **who closed it** ("Sales person: …");
5. **opens a card on the Accounting onboarding board** (stage *New*) and
   notifies the owner. A welcome-email draft becomes available on the deal.

No contract attachment is required to win.

## After the sale

The new deal flows on without further sales action:

- It sits on **Accounting → Onboarding** until paid. When accounting marks it
  **Paid In Full**, the deal's services **spawn jobs** on the relevant tech
  boards (Web SEO, Local SEO, Web Dev, …) at their first column.
- Recurring (monthly/yearly) amounts feed **Accounting → Recurring** and the
  MRR figure on the report.

So one won lead becomes: a **client**, a **locked deal**, an **accounting
onboarding card**, and eventually **delivery jobs** — all carrying the same code.

## Scheduled calls & the calendar

- Setting **"Scheduled for"** on a lead books the call: the card moves to
  **Scheduled** and the appointment shows on the **home calendar** for the owner.
- Leads in **Offer Sent** with a follow-up date show as a **"Follow-up"** on the
  card and calendar instead of a plain meeting.

## Email automations

Leads can be worked by automated email (with a global kill switch and per-lead
control):

- **Welcome email** — sent when a new manual/Meta lead is created (if that
  automation is enabled).
- **Scheduled confirmation** — sent when a "Scheduled for" date is set.
- **Sequences** — multi-step email cadences tied to specific stages; a lead's
  sequence starts/stops as it moves between stages.
- **Opt-out** — every automated email carries an unsubscribe link. Clicking it
  sets the lead to **opted out** (shown as a red badge on the lead). Each lead
  also has an **automations on/off** toggle.

## Who sees what

Visibility follows the **Sales** permissions:

- **Salespeople** see the leads they own by default; the **"Mine" / "All"**
  toggle switches between their own and every lead they're allowed to view.
- **Admins** see all leads and can **filter by owner**.
- Moving a card needs the *move-stage* permission; **winning** a lead needs the
  *close/convert* permission; **deleting** a lead is admin-only. Converted leads
  become read-only.

## Filters, search & saved views

- **Filter** by owner and by source (Manual / Meta / Import).
- **Search** across code, contact name, company, industry, email, and phone.
- **Sort** by newest, oldest, or value (high→low).
- Save any combination as a **named view** from the saved-filters bar and switch
  between views in one click.
