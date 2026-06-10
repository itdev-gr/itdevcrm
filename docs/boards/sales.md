# Sales pipeline (`/sales/kanban`)

Cards are **leads** (deals-in-progress). Sales people work their own leads;
admins see everyone's and can filter by owner, source, and saved filters.

## How cards arrive

- **Manual**: "Add lead" on the pipeline, or via Sales → My Clients.
- **Meta**: Facebook/Instagram lead forms land automatically with
  source = Meta.
- **Import**: bulk imports carry source = Import.

Each lead gets a sequential code (000001…), an owner, planned services with
pricing (one-time / monthly / yearly + VAT by country), contacts, and
company data.

## Stages

| #   | Stage          | Greek              | Meaning                                                                                                                                                                                                                                                                                              |
| --- | -------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | New Lead       | Νέος Πελάτης       | Fresh, untouched lead. First call pending. The lead page's "No more new leads" button jumps to the next unworked one.                                                                                                                                                                                |
| 2   | No Answer      | Δεν Απαντά         | Called once or twice, no contact yet. Keep retrying.                                                                                                                                                                                                                                                 |
| 3   | Constant NA    | Σταθερά Δεν Απαντά | Repeatedly unreachable. Low-priority retry pool; candidates for Dead End after enough attempts.                                                                                                                                                                                                      |
| 4   | Working On It  | Σε Εξέλιξη         | Contact made; needs analysis, pricing discussion, proposal being prepared.                                                                                                                                                                                                                           |
| 5   | Offer Sent     | Προσφορά Στάλθηκε  | A proposal/offer went out (the lead page's "Send offer" button emails it; offers are also built in the Offer Builder). Awaiting the client's answer.                                                                                                                                                 |
| 6   | Scheduled      | Προγραμματισμένο   | A call/meeting is booked. Picking a "Scheduled for" date on the lead page moves the card here automatically and puts the appointment on the home calendar.                                                                                                                                           |
| 7   | Hot            | Καυτό              | Verbal interest is strong; closing is imminent. Prioritize these daily.                                                                                                                                                                                                                              |
| 8   | **Won** ✅     | Κερδισμένο         | Terminal (outcome **won**, triggers **lock_deal**). The lead converts to a **client + deal**: the deal is locked against edits, the sales person is recorded ("Sales person: …"), and a card opens on the **Accounting onboarding** board. A welcome-email draft becomes available on the deal page. |
| 9   | Not Interested | Μη Ενδιαφέρον      | Terminal (outcome lost). Clean "no".                                                                                                                                                                                                                                                                 |
| 10  | Dead End       | Αδιέξοδο           | Terminal (outcome lost). Unreachable/invalid leads.                                                                                                                                                                                                                                                  |

## Automations & rules

- **Won** is the only stage with side effects: conversion, deal lock,
  accounting hand-off. No contract attachment is required to win.
- Scheduled calls appear on the home calendar for the owner.
- Filters (owner, source, search, sort) can be saved as named views.
