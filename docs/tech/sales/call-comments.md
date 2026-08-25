# Αυτόματα σχόλια κλήσεων (2026-08-25)

Κάθε κλήση από/προς πελάτη γίνεται αυτόματο σχόλιο στη σωστή καρτέλα. Πηγή
είναι το sales.itdevcrm (`call_records`, τροφοδοτείται από το PBX box κάθε 2'
μέσω `push_stats_sales.php`) — κανένα νέο script στο box.

## Ροή

```
Yeastar PBX → box (push_stats_sales.php, */2) → sales DB call_records
  → CRM edge fn pull-calls (pg_cron pull_calls, */2, bearer call_pull_secret)
  → CRM call_log (on conflict yeastar_uid do nothing)
  → trigger call_log_route_comment → comments
```

Συνολική καθυστέρηση κλήση → σχόλιο: ~2–4 λεπτά.

## Δρομολόγηση (trigger `call_log_route_comment`, migration 20260825190000)

1. Απέναντι αριθμός → 10ψήφιο κλειδί (`<10` ψηφία → `route_error='short-number'`).
2. `extension → profiles.phone_extension` → agent (άγνωστο → `no-agent`).
3. `find_contact_by_phone`: client πρώτα, μετά lead. Κανένα match → μόνο log,
   κανένα σχόλιο.
4. Τμήμα από τα groups του agent (προτεραιότητα όπως `resolve_email_filing`):
   sales → sales· accounting → accounting· ακριβώς ένα technical group →
   κανάλι (web_dev→dev, ads→ads, social_media→social, *seo→seo)· αλλιώς sales.
5. Στόχος: lead → σχόλιο στο lead. Client: sales/accounting → πιο πρόσφατο
   ανοιχτό deal (κύριο thread), fallback οποιοδήποτε deal, αλλιώς client·
   technical → `deal_<channel>` (κανάλι από group ή inference από τα jobs).
6. Σώμα στα ελληνικά, ώρα Αθήνας· `task_key = 'call:'||yeastar_uid` (το UI το
   αποδίδει ως system comment), `mentioned_user_ids='{}'` (κανένα notification),
   `created_at = ώρα κλήσης` — τα σχόλια μπαίνουν χρονολογικά στη ροή.

Κάθε βήμα μετά το (2) τρέχει σε exception handler: σε σφάλμα το row μένει στο
`call_log` με `route_error = sqlerrm` — audit trail για κάθε κλήση, πάντα.

## Backfill ιστορικού (2026-08-25)

Όλο το ιστορικό (13.445 Inbound/Outbound κλήσεις με uid, από 02/06/2026)
περάστηκε ως backdated σχόλια: 12.902 σχόλια (8.370 leads, 4.522 deals, 10
clients), 537 άγνωστοι αριθμοί μόνο ως log. Το bulk έγινε με απευθείας paging
(created_at, yeastar_uid) γιατί ο cursor του puller (keyset μόνο σε
created_at, limit 500) δεν προσπερνά clusters >500 ίδιων timestamps — στο
real-time trickle αυτό δεν συμβαίνει.

## Λειτουργικά

- Cursor/έλεγχος: `call_pull_config` (pulled_through, με 15' overlap ανά pull).
- Έλεγχος υγείας: `select coalesce(comment_parent_type, route_error, 'no-match'),
  count(*) from call_log group by 1;`
- Secrets: vault `call_pull_secret` = edge `CALL_PULL_SECRET`· το pull-calls
  διαβάζει το sales DB με τα υπάρχοντα `SALES_SUPABASE_URL`/`SALES_SERVICE_ROLE_KEY`.
- Internal κλήσεις και rows χωρίς `yeastar_uid` αγνοούνται στο pull.
- Box cron `/etc/cron.d/push-stats-sales`: `*/2` (σφίχτηκε από `*/10` στις
  25/08/2026, μέσω `ssh srv1`).
