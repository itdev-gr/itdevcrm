# Data fix: website-form lead contact names (2026-07-02)

## What was wrong
Leads from the Meta **🌐 WEBSITE LEAD FORM — ITDEV-copy** form had their contact
name set to a **form answer** (`Όχι, χρειάζομαι νέο website`, `Ναι, αλλά θέλει
αναβάθμιση`, …) instead of the person's name.

## Root cause
The columnar Meta→Excel→Zapier payload (`COL$…`) lists name/phone/email *after* the
form's custom-question answers. The website form has **two** question columns, which
shifted the name into `COL$O` while the parser hard-read the name from `COL$N`
(correct only for single-question forms). Fixed in `api/meta-lead.ts`
(`parseColumnarMetaLead` now anchors on the email column). Email/phone were already
repaired downstream by DB extractors; the name had no repairer.

## Data correction
Matched all 50 website-form leads to the source Excel by email/phone and set the
contact name from the `ονοματεπώνυμο` column. 47 rows changed, 3 already correct,
0 unmatched. The 1 converted deal (005523) already had a correct client name — untouched.

### Forward (applied)
```sql
UPDATE leads SET contact_first_name='Giorgos', contact_last_name='Paraschou', updated_at=now() WHERE id='d1a990f6-00f6-4105-8af3-bc6b1a1036a7';
UPDATE leads SET contact_first_name='Vangelis', contact_last_name='Kintis', updated_at=now() WHERE id='9f5951e5-bcc7-4eb1-8716-78e58f5e51b1';
UPDATE leads SET contact_first_name='Panagiwtis', contact_last_name='Kotsinis', updated_at=now() WHERE id='3dc7c340-2b34-4962-aa3c-61eb6e7bb702';
UPDATE leads SET contact_first_name='Georgios', contact_last_name='Gamvroudis', updated_at=now() WHERE id='25b3f1d5-6175-478a-a8f2-b4b2f523ce75';
UPDATE leads SET contact_first_name='Νικολεττα', contact_last_name='Βασιλατου', updated_at=now() WHERE id='36cd5c55-4d3d-4d2c-bb1c-c1c0e076a2ee';
UPDATE leads SET contact_first_name='Κάτια', contact_last_name='Μενούνου', updated_at=now() WHERE id='61b41d33-820a-4f7d-841b-ec769cf10188';
UPDATE leads SET contact_first_name='Aimilia', contact_last_name='Nezi', updated_at=now() WHERE id='dd5ece6d-4c6f-44aa-aaa9-acf944cb5293';
UPDATE leads SET contact_first_name='Damianoula', contact_last_name='Kotsou', updated_at=now() WHERE id='e889c303-6e15-46a3-843e-7fb7aac363df';
UPDATE leads SET contact_first_name='Foula', contact_last_name='Fenia Kiritsi', updated_at=now() WHERE id='110dfb2b-d854-496f-bda5-59f7e61ecd26';
UPDATE leads SET contact_first_name='Andreas', contact_last_name='Demetriou', updated_at=now() WHERE id='2f388bff-2bb2-498c-ac24-33c14466157c';
UPDATE leads SET contact_first_name='Petros', contact_last_name='Imeraj', updated_at=now() WHERE id='de6f904f-4c17-41ed-8f73-9f6d401e93a1';
UPDATE leads SET contact_first_name='Αλεξάνδρα', contact_last_name='Σαγανά', updated_at=now() WHERE id='48c8d67b-cc43-44b2-af78-aa4c8a33534a';
UPDATE leads SET contact_first_name='Andreas', contact_last_name='Pitsikoulakis', updated_at=now() WHERE id='125acb4e-8a04-4651-8f40-b28793e09419';
UPDATE leads SET contact_first_name='ΑΝΔΡΕΑΣ', contact_last_name='ΛΕΚΚΑΣ', updated_at=now() WHERE id='5922cf74-a8ea-4392-8001-b721282738e8';
UPDATE leads SET contact_first_name='Βασιλική', contact_last_name='Νικοπούλου', updated_at=now() WHERE id='9d31e728-38bb-4e00-9ea5-3ef8a53b72f2';
UPDATE leads SET contact_first_name='ΕΠΙΠΛΑ', contact_last_name='ΠΛΕΥΡΗΣ', updated_at=now() WHERE id='40da52bc-c464-4214-9809-7bccec791785';
UPDATE leads SET contact_first_name='Maria', contact_last_name='Papapanayiotou Tekki', updated_at=now() WHERE id='44489257-b738-433d-8f2a-44b5824c0863';
UPDATE leads SET contact_first_name='MarilenaTzannetatou', contact_last_name=NULL, updated_at=now() WHERE id='6297c2d1-ca3d-449e-b7c7-d9df8c509b82';
UPDATE leads SET contact_first_name='Fotis', contact_last_name='Ekmetzoglou', updated_at=now() WHERE id='10a26cd7-561b-43c1-8cd9-a427d4cc06ab';
UPDATE leads SET contact_first_name='Clairy', contact_last_name='Benou', updated_at=now() WHERE id='a0715658-f925-4aae-bb0f-6afffc1cb135';
UPDATE leads SET contact_first_name='Anna', contact_last_name='Psylla | Entrepreneur', updated_at=now() WHERE id='e90bb9c6-11a4-4833-8167-abc5fa2df73b';
UPDATE leads SET contact_first_name='Fanis', contact_last_name='Mpakas', updated_at=now() WHERE id='c06164d5-7da5-4151-b594-830a4596a6f5';
UPDATE leads SET contact_first_name='matthaios', contact_last_name='lamparas', updated_at=now() WHERE id='8fcaa7ec-17b1-434d-8f2e-dba8ae80e014';
UPDATE leads SET contact_first_name='Anastasios', contact_last_name='Koumariotis', updated_at=now() WHERE id='9f883e5d-b66d-4a1f-a2ab-78c6c312101e';
UPDATE leads SET contact_first_name='Μαρτσέλα', contact_last_name='Μανάι', updated_at=now() WHERE id='9790ebf4-3852-48c8-bd77-8ce6a66df604';
UPDATE leads SET contact_first_name='Αμαλία', contact_last_name='Γιολδάση Τσοπανά', updated_at=now() WHERE id='b1646f84-9387-422f-bfb3-95ed77b7d88a';
UPDATE leads SET contact_first_name='θεμις', contact_last_name='Κουλλια', updated_at=now() WHERE id='65e52a13-91e6-492a-9411-3b5d69f7ebd8';
UPDATE leads SET contact_first_name='Γιωργος', contact_last_name='Κρανιτης', updated_at=now() WHERE id='626faf03-0a45-4561-a2e1-50c29de9da9d';
UPDATE leads SET contact_first_name='Pantelis', contact_last_name='D Savvides', updated_at=now() WHERE id='e00ab4ba-4783-4c82-b3ad-f66d6fe5f39d';
UPDATE leads SET contact_first_name='Marino', contact_last_name='Marino', updated_at=now() WHERE id='67ebfe7b-2e1b-4592-959a-be308f08f993';
UPDATE leads SET contact_first_name='Στεφανίδης', contact_last_name='Βασίλης', updated_at=now() WHERE id='7f0c58bc-112b-4da7-8ba6-995a822883ec';
UPDATE leads SET contact_first_name='Panagiotis', contact_last_name='Chatzikyriakos', updated_at=now() WHERE id='520c1b10-5dd6-4487-9bed-aeede5409127';
UPDATE leads SET contact_first_name='Zoi', contact_last_name='Antoniadou', updated_at=now() WHERE id='c84000f3-7114-407a-895b-e132367a7b34';
UPDATE leads SET contact_first_name='Maria', contact_last_name='Koutsokosta', updated_at=now() WHERE id='9612da07-9f51-4f4e-8851-dbce3b431174';
UPDATE leads SET contact_first_name='Ipapanti', contact_last_name='Aivalioti', updated_at=now() WHERE id='abfa9e00-34e2-4262-99b9-5eea7ed2a1c8';
UPDATE leads SET contact_first_name='Nonis', contact_last_name='Mouxo', updated_at=now() WHERE id='1c73f7cc-7ac0-4497-a9d9-45df4bfda37c';
UPDATE leads SET contact_first_name='ΜΑΝΩΛΗΣ', contact_last_name='ΜΑΘΙΟΥΔΑΚΗΣ', updated_at=now() WHERE id='592eb9d0-5c1a-4119-8a6d-868a7865729c';
UPDATE leads SET contact_first_name='Maria', contact_last_name='Digenaki', updated_at=now() WHERE id='51e7958e-4ae1-4c8a-b97a-cc654a07cba1';
UPDATE leads SET contact_first_name='Πηγή', contact_last_name='Χριστίνα Ανδρεοπούλου', updated_at=now() WHERE id='a461300a-9eb3-424a-b88e-0cbc11af6222';
UPDATE leads SET contact_first_name='Giorgos', contact_last_name='Pappas', updated_at=now() WHERE id='666bd3ab-848a-4a9b-b43a-3b5391a5b976';
UPDATE leads SET contact_first_name='Vasilopoulos', contact_last_name='wedding and portrait photography', updated_at=now() WHERE id='ca815d83-efed-4045-a21d-378d6d45bddf';
UPDATE leads SET contact_first_name='Alexis', contact_last_name='Martzaklis', updated_at=now() WHERE id='33d2af05-20bf-4d19-9f31-5edbfb402d0f';
UPDATE leads SET contact_first_name='George', contact_last_name='Galaios', updated_at=now() WHERE id='976d5f54-df99-4537-a521-d323e5c336b6';
UPDATE leads SET contact_first_name='Κωνσταντινος', contact_last_name='Σαραντακος', updated_at=now() WHERE id='4419b2e7-e77d-4514-a1b0-0a24fe082816';
UPDATE leads SET contact_first_name='Aliki', contact_last_name=NULL, updated_at=now() WHERE id='6d7b32c0-a65e-454d-a10a-ac966b50cb7f';
UPDATE leads SET contact_first_name='Thomas', contact_last_name='Epitropakis', updated_at=now() WHERE id='150636df-892d-460d-b1d0-ed5b6ca17d12';
UPDATE leads SET contact_first_name='Petros', contact_last_name='Tsampouris', updated_at=now() WHERE id='e57d29a8-125e-4475-b263-23a9d740e15e';
```

### Rollback
```sql
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='d1a990f6-00f6-4105-8af3-bc6b1a1036a7';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='9f5951e5-bcc7-4eb1-8716-78e58f5e51b1';
UPDATE leads SET contact_first_name='Ναι,', contact_last_name='αλλά θέλει αναβάθμιση' WHERE id='3dc7c340-2b34-4962-aa3c-61eb6e7bb702';
UPDATE leads SET contact_first_name='Ναι, αλλά θέλει αναβάθμιση', contact_last_name=NULL WHERE id='25b3f1d5-6175-478a-a8f2-b4b2f523ce75';
UPDATE leads SET contact_first_name='nikol vasilatou', contact_last_name=NULL WHERE id='36cd5c55-4d3d-4d2c-bb1c-c1c0e076a2ee';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='61b41d33-820a-4f7d-841b-ec769cf10188';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='dd5ece6d-4c6f-44aa-aaa9-acf944cb5293';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='e889c303-6e15-46a3-843e-7fb7aac363df';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='110dfb2b-d854-496f-bda5-59f7e61ecd26';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='2f388bff-2bb2-498c-ac24-33c14466157c';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='de6f904f-4c17-41ed-8f73-9f6d401e93a1';
UPDATE leads SET contact_first_name='Ναι, αλλά θέλει αναβάθμιση', contact_last_name=NULL WHERE id='48c8d67b-cc43-44b2-af78-aa4c8a33534a';
UPDATE leads SET contact_first_name='Pitsikoulakis', contact_last_name=NULL WHERE id='125acb4e-8a04-4651-8f40-b28793e09419';
UPDATE leads SET contact_first_name='Μια φορά και έναν καιρό', contact_last_name=NULL WHERE id='5922cf74-a8ea-4392-8001-b721282738e8';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='9d31e728-38bb-4e00-9ea5-3ef8a53b72f2';
UPDATE leads SET contact_first_name='Αλεξανδρα πλευρη', contact_last_name=NULL WHERE id='40da52bc-c464-4214-9809-7bccec791785';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='44489257-b738-433d-8f2a-44b5824c0863';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='6297c2d1-ca3d-449e-b7c7-d9df8c509b82';
UPDATE leads SET contact_first_name='Φώτης Εκμετζογλου ΕΕ', contact_last_name=NULL WHERE id='10a26cd7-561b-43c1-8cd9-a427d4cc06ab';
UPDATE leads SET contact_first_name='Beat the diet', contact_last_name=NULL WHERE id='a0715658-f925-4aae-bb0f-6afffc1cb135';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='e90bb9c6-11a4-4833-8167-abc5fa2df73b';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='c06164d5-7da5-4151-b594-830a4596a6f5';
UPDATE leads SET contact_first_name='Λαμπάρας', contact_last_name=NULL WHERE id='8fcaa7ec-17b1-434d-8f2e-dba8ae80e014';
UPDATE leads SET contact_first_name='dynamic blasting', contact_last_name=NULL WHERE id='9f883e5d-b66d-4a1f-a2ab-78c6c312101e';
UPDATE leads SET contact_first_name='Ναι,', contact_last_name='αλλά δεν με εκφράζει' WHERE id='9790ebf4-3852-48c8-bd77-8ce6a66df604';
UPDATE leads SET contact_first_name='Ναι, αλλά θέλει αναβάθμιση', contact_last_name=NULL WHERE id='b1646f84-9387-422f-bfb3-95ed77b7d88a';
UPDATE leads SET contact_first_name='themh koullia', contact_last_name=NULL WHERE id='65e52a13-91e6-492a-9411-3b5d69f7ebd8';
UPDATE leads SET contact_first_name='George Kranitis', contact_last_name=NULL WHERE id='626faf03-0a45-4561-a2e1-50c29de9da9d';
UPDATE leads SET contact_first_name='- The royal Cigars pantelis', contact_last_name=NULL WHERE id='e00ab4ba-4783-4c82-b3ad-f66d6fe5f39d';
UPDATE leads SET contact_first_name='Ναι,', contact_last_name='αλλά θέλει αναβάθμιση' WHERE id='67ebfe7b-2e1b-4592-959a-be308f08f993';
UPDATE leads SET contact_first_name='Stefanidhs', contact_last_name=NULL WHERE id='7f0c58bc-112b-4da7-8ba6-995a822883ec';
UPDATE leads SET contact_first_name='Χατζηκυριακος Παναγιωτης', contact_last_name=NULL WHERE id='520c1b10-5dd6-4487-9bed-aeede5409127';
UPDATE leads SET contact_first_name='- Αντωνιαδου Ζωή ψυχολογος', contact_last_name=NULL WHERE id='c84000f3-7114-407a-895b-e132367a7b34';
UPDATE leads SET contact_first_name='ΜΑΡΙΑ ΚΟΥΤΣΟΚΩΣΤΑ', contact_last_name=NULL WHERE id='9612da07-9f51-4f4e-8851-dbce3b431174';
UPDATE leads SET contact_first_name='Ναι,', contact_last_name='αλλά θέλει αναβάθμιση' WHERE id='abfa9e00-34e2-4262-99b9-5eea7ed2a1c8';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='1c73f7cc-7ac0-4497-a9d9-45df4bfda37c';
UPDATE leads SET contact_first_name='Ναι,', contact_last_name='αλλά δεν με εκφράζει' WHERE id='592eb9d0-5c1a-4119-8a6d-868a7865729c';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='51e7958e-4ae1-4c8a-b97a-cc654a07cba1';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='a461300a-9eb3-424a-b88e-0cbc11af6222';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='666bd3ab-848a-4a9b-b43a-3b5391a5b976';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='ca815d83-efed-4045-a21d-378d6d45bddf';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='33d2af05-20bf-4d19-9f31-5edbfb402d0f';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='976d5f54-df99-4537-a521-d323e5c336b6';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='4419b2e7-e77d-4514-a1b0-0a24fe082816';
UPDATE leads SET contact_first_name='Όχι,', contact_last_name='χρειάζομαι νέο website' WHERE id='6d7b32c0-a65e-454d-a10a-ac966b50cb7f';
UPDATE leads SET contact_first_name='Sihanoukville', contact_last_name=NULL WHERE id='150636df-892d-460d-b1d0-ed5b6ca17d12';
UPDATE leads SET contact_first_name='Όχι, χρειάζομαι νέο website', contact_last_name=NULL WHERE id='e57d29a8-125e-4475-b263-23a9d740e15e';
```
