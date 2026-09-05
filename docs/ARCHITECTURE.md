# Architecture

The decisions that shaped this codebase, and the reasoning behind the ones that
went against the obvious choice.

---

## 1. What this product is

A person has lost their wallet. They are standing in the street, on a phone,
probably on a slow connection, probably annoyed. Everything below follows from
that.

The product does one thing: it connects people who lost something with people
who found something. It is not a marketplace, a municipality portal, a social
network, or an emergency service, and the schema is deliberately too narrow to
become one by accident.

---

## 2. Data model

### Entities

`User`, `Session`, `OtpChallenge`, `Category`, `Area`, `Report`, `ReportImage`,
`Match`, `VerificationRequest`, `Conversation`, `Message`, `Notification`,
`Recovery`, `Flag`, `AdminAction`, `RateLimit`.

### Two deviations from a textbook design, and why

**No separate `Item` table.** A report describes exactly one item, always. A
`Report → Item` join would be a mandatory extra row and an extra join on the
hottest read path in the product, in exchange for modelling a
one-to-one relationship as though it might one day be one-to-many. The item's
attributes — title, category, colour, brand, description — live on `Report`.

**No separate `Location` table.** Locations divide cleanly into two kinds and
they are stored differently on purpose:

- `Area` is reference data: 51 seeded Mosul neighbourhoods with a centroid.
  It is a real table because reports are grouped and filtered by it.
- The report's own position is two pairs of columns on `Report` —
  `preciseLat`/`preciseLng` (private) and `approxLat`/`approxLng` (public).
  Splitting these into a `Location` row would put the private and public
  coordinates in the same joined object, which is exactly the shape that
  leads to leaking one while meaning to return the other.

### Status is two fields, not one

`status` (`ACTIVE` / `RECOVERED` / `CLOSED`) is the author's view: what happened
to the thing. `moderation` (`VISIBLE` / `UNDER_REVIEW` / `HIDDEN` / `REJECTED`)
is staff's view: whether it may be shown. Collapsing them into one enum makes
"hidden by a moderator" indistinguishable from "closed by its author", and the
author is entitled to know which happened to their report.

### Matches and duplicates share a table

`Match` carries a `kind`: `POTENTIAL_MATCH` (lost ↔ found) or
`POSSIBLE_DUPLICATE` (two reports of the same thing). The rows have identical
shape — two report ids, a score, reasons, a status, a dismissal — so two tables
would be two of everything for one behavioural difference. For a
`POTENTIAL_MATCH`, side A is always the LOST report; for a duplicate, the two
ids are sorted, so the unique constraint holds regardless of which was filed
second.

### Indexes

Chosen from the actual queries, not sprinkled:

- `(type, status, moderation, publishedAt)` — the search page and home feed.
- `(userId, createdAt)` — "my reports".
- `(categoryId, type, status)`, `(areaId)` — filters.
- A partial index on `publishedAt` for visible+active rows — the home feed's
  hot path.
- A **GIN trigram index** on `searchText`. This is the one that matters:
  PostgreSQL ships no Arabic text-search configuration, so full-text search is
  not an option, and `ILIKE '%…%'` without trigrams is a sequential scan.

---

## 3. Arabic search

Two people describing the same wallet will not spell it the same way. The
variation is not noise; it is the norm:

| what varies | example |
|---|---|
| diacritics | مَحْفَظَة / محفظة |
| hamza seat | أحمد / احمد / إحمد |
| ta-marbuta | محفظة / محفظه |
| alef maqsura | مصطفى / مصطفي |
| Iraqi letters | لگيتها / لكيتها, چنطة / جنطه |
| digits | ١٥ / 15 |
| script | ايفون / iPhone |
| vocabulary | هاتف / موبايل / تلفون / جوال |

`normalizeArabic` folds the first six. The seventh — vocabulary — is a curated
synonym table of about twenty groups covering what people actually lose. It is
short and legible on purpose: a non-engineer can extend it, and precision
matters more than coverage.

Brand groups deliberately include the generic term, so "موبايل" finds a report
titled "آيفون ١٣". That gap was found by a test, not by reading the code.

**Storage.** `Report.searchText` is a denormalised blob: normalised title,
description, brand, category, area and landmark, plus every synonym of every
token. Expanding at write time rather than read time means the query only has
to expand the handful of words the user typed.

**Query.** Tokens are normalised and expanded, then every token must appear
(AND across tokens, OR across that token's synonyms). Requiring all of them is
what stops "محفظة جلد" returning every wallet in the city.

The definite-article strip (`الهاتف` → `هاتف`) is a heuristic and it does
occasionally misfire — `ألوان` becomes `وان`. That is acceptable because the
same function runs over both the query and the stored haystack, so the two
sides always agree; the cost is a rare collision, never a missed match.

---

## 4. Location privacy

The most sensitive thing in the database is not a phone number. It is the
answer to "where does this person go every day".

- The map pin is stored as `preciseLat`/`preciseLng`. It is read by exactly
  two things: the matcher, and staff tooling.
- `coarsenPoint` snaps it to a ~300 m grid. That result is what any public
  consumer sees.
- The snapping is **deterministic**, not random jitter. Random offsets can be
  averaged back to the true point across repeated reads, and would make the
  public marker move between page loads.
- The longitude step is derived from the *snapped* latitude, not the input —
  otherwise every point gets its own slightly-different grid and two neighbours
  can land in different cells. (Also found by a test.)
- A user who picks a neighbourhood instead of dropping a pin has no precise
  location stored at all. The centroid is the entire record.
- Public UI shows a **circle**, never a pin: the shape has to match the
  precision of the data behind it.

## 5. Sensitive reports

A lost national ID is a different object from a lost umbrella. Categories carry
a `sensitive` flag; a report in one gets:

- a generic public title (`وثيقة شخصية`) from the category's `publicLabelAr`
- no public description — that is where the numbers are
- no public images — the photo may be *of* the document
- `noindex`, and exclusion from the sitemap

It stays fully readable to its author, works normally via a shared link, and
staff can apply or remove the flag on any report.

---

## 6. Matching: rules, not a model

The matcher is arithmetic over facts a person can check:

| signal | weight |
|---|---|
| same category | 30 |
| text similarity (synonym-folded token overlap) | 25 |
| distance (full marks under 500 m, decaying to 15 km) | 15 |
| colour affinity | 12 |
| brand | 10 |
| time proximity | 8 |
| AI keyword overlap | 5 |

Plus hard gates that rule a pair out rather than scoring it low: more than
15 km apart; found more than 72 hours *before* it was lost; a different
category without a strong textual match.

Why not embeddings or a vision model:

1. **The UI has to explain itself anyway.** "87% — same category, same colour,
   600 m apart, two hours later" is what a person needs to decide. A model that
   produces a number without those facts still leaves us computing them.
2. **It costs nothing and can be tested.** `tests/unit/matching.test.ts` pins
   the behaviour, including the cases that must *not* match.
3. **It degrades honestly.** No API to be down, no rate limit, no bill.

Colour uses an affinity table rather than string equality: black/navy and
grey/silver score 0.6, because those are genuinely confused in bad light and in
a hurried description. A missing colour scores 0 — no evidence, not a mismatch.

Everything is worded as *تطابق محتمل*. The product never says it found your
item.

---

## 7. Ownership verification

The failure this exists to prevent: someone reads a public report, says "that's
mine", and is handed a stranger's phone.

The flow:

1. The finder records a detail they deliberately left out of the public report.
2. A claimant describes what they think that detail is.
3. **The finder only sees the claimant's answer after committing their own.**
4. The finder decides. The platform shows a similarity hint, clearly advisory.

Step 3 is the whole mechanism. Without that ordering the finder could read the
answer first and then "remember" whether it was right — the check would be
theatre. The finder's secret is also snapshotted onto each claim when it is
filed, so editing it afterwards cannot move the goalposts for a claim already
in flight.

Staff can decide a disputed claim, but the same ordering applies to them.

---

## 8. Recovery

Both sides confirm, separately. A single "mark as recovered" button would let
one person close a case the other never agreed to — and would make the recovery
count, the number this project will be judged by, meaningless. Only when both
have confirmed does the report move to `RECOVERED` and the duration get
recorded.

---

## 9. Authentication

An account is created once — name, address, password — with a one-time code in
the middle to prove the address exists. After that, signing in is the password.

The one-time code did not go away, it moved. One delivery mechanism, three
purposes, and the purpose is part of the lookup, so a code issued to confirm an
address cannot be redeemed to reset a password:

| purpose | used for |
|---|---|
| `SIGNUP` | proving the address is real, once |
| `PASSWORD_RESET` | choosing a new password without an old one |
| `LOGIN` | accounts with no password set — created before passwords existed, or by staff |

**Why both.** A code-only flow means every sign-in waits on an inbox: the
person reporting a lost wallet from a borrowed phone has to open mail they may
not have access to. A password-only flow means an unverified address can hold
an account, and a forgotten password has no way back. Each covers the other's
failure.

**The sign-up payload lives on the challenge, not on `users`.** The display
name and the already-hashed password ride on the `OtpChallenge` row until the
address answers. Until then the address has not earned the unique key, so a
sign-up nobody finishes cannot park on someone else's address, and there are no
half-built accounts to clean up. The payload is cleared by the same write that
spends the code.

**Passwords** are scrypt (RFC 7914) from Node's own crypto module, at
N=16384, r=8, p=1 — roughly 100 ms and 64 MB per verification. Not bcrypt or
argon2: both are native addons, and this application already pays that cost
once for sharp; a second one is another thing that can fail to build on a host
we do not control, for a primitive the standard library already implements. The
digest is self-describing (`scrypt$N$r$p$salt$hash`), so the parameters can be
raised later without invalidating anyone's password — `needsRehash` upgrades a
digest transparently on the next successful sign-in.

The strength rule is length plus variety plus a common-password list, and
deliberately *not* a character-class checklist: requiring a symbol produces
`Password1!`, which is long enough to look strong and first in every cracking
dictionary.

**What the screens refuse to reveal.** A wrong password and an address with no
account produce the same sentence. The forgotten-password screen reports
success for an address that has no account, and sends nothing. Neither form can
be used to find out who has an account here.

- Sessions are opaque 32-byte random tokens stored as SHA-256 hashes. The raw
  token exists only in the user's cookie, and any session can be revoked
  server-side — which a stateless JWT cannot do. Suspending an account deletes
  its sessions in the same transaction, so the action takes effect immediately
  rather than at the next token expiry. Resetting a password does the same, so
  whoever knew the old one loses access at that moment.
- IP addresses are stored hashed. They are needed for abuse limits, not
  identity.
- The profile photo and neighbourhood collected at sign-up are both optional,
  and the neighbourhood is coarsened to the same ~300 m grid as a report before
  it is stored. The platform has no business knowing which house someone lives
  in.

Not NextAuth: there is no OAuth provider, the code channel is
deployment-configurable (email or SMS), and DB-backed revocable sessions were
wanted anyway — which is most of what that library would have brought.

---

## 8a. The console is a separate product

`/admin` shares a deployment with the member site and nothing else. Nothing on
the member side links to it, it has its own sign-in at `/admin/login`, and the
guard lives in an `(console)` route group so that sign-in page is reachable
without already being past the guard.

The two refusals differ deliberately. No session redirects to the console's
sign-in, because staff arrive from a bookmark. A signed-in member who is not
staff gets a plain **404**: "forbidden" would confirm there is something there,
and they have no reason to learn that.

Deletion lives here and only here. Every other staff action is reversible —
hide, unhide, suspend, reopen — so deleting a report or an account is
admin-only, requires the reference or the account name typed back, requires a
written reason, and says on the dialog that hiding is usually enough. `Recovery`
rows survive both deletions by design (§2), so a takedown cannot quietly
rewrite the impact statistics.

---

## 9a. Identity verification

Publishing a report requires a national ID card (البطاقة الموحدة) behind the
account: both sides, uploaded once, reviewed by a person.

**The gate is "submitted and not rejected", not "approved".** Blocking every
report until a human has looked at a card would mean a wallet lost at midnight
cannot be reported until the morning, which is the opposite of what this
product is for. The deterrent is having handed over a real identity, not the
review having finished. A card that turns out to be false takes the account's
ability to publish with it *and* pulls its live reports back into
`UNDER_REVIEW` — the consequence is retroactive rather than pre-emptive.

This is the one place the V1 exclusion list moved: §12 still rules out
*automatic* identity verification. What is built is the opposite of automatic —
a person comparing a photograph with a name.

**These are the most sensitive images the platform will ever hold, so the
design is built around getting rid of them:**

1. **They are columns, not objects.** Object storage authorises by URL —
   whoever holds the link holds the document — and an identity card has to be
   authorised by *role*. A `bytea` column has no URL to leak, expire, or forget
   to protect. It is also simply the right shape for this data: two images per
   member, a couple of hundred kilobytes each, deleted within days. That is the
   profile where a column beats a bucket, and it means a deployment with no
   object storage configured at all can still verify members.
2. The only reader is a staff route that checks a role and writes an
   `AdminAction` naming the viewer *before* it reads a byte. Opening someone's
   ID card is an event, not a page view.
3. The images are cleared in the same transaction that records the decision —
   not by a scheduled job that might not run, and not in a second system that
   could be unreachable at that moment. A verified account keeps a decision and
   a date, never the document. `purgeDecidedIdentityImages()` exists only for a
   row restored from a backup taken before its purge.
4. The card *number* is never asked for and has no column. A number we do not
   collect cannot leak.

Every query selects explicit fields, because Prisma would otherwise pull both
images into a list of pending cards.

What another user ever sees of all this is one boolean on the report author.

---

## 10. Abuse prevention

Rules and a moderation queue, not a fraud model:

- Fixed-window rate limits in Postgres — a single atomic upsert, so concurrent
  requests cannot both read a stale count (tested).
- Report creation, OTP requests (per number *and* per IP), uploads, messages,
  claims and flags each have their own bucket.
- Three independent flags pull a report into `UNDER_REVIEW` automatically.
  Dismissing the last open flag returns it to public view, so the threshold is
  not a one-way door.
- Duplicate candidates are surfaced, never merged automatically. Two people
  reporting the same phone from opposite ends of a street is a real scenario,
  and an automatic merge silently deletes one person's report.
- Every staff action writes an `AdminAction` in the same transaction as the
  change, so the audit log cannot drift from what happened. Account-level
  actions require a written reason, enforced by the schema.

---

## 11. Uploads

Every image is decoded and re-encoded to WebP by sharp. That is the security
boundary as much as the optimisation: whatever the client claims the MIME type
is, what lands in storage is a freshly encoded image, so a polyglot file or a
renamed script does not survive the round trip. EXIF — including GPS — is
dropped in the process, after orientation is applied.

An 8 MB phone photo becomes roughly 150 KB, plus a 400 px thumbnail. Uploads go
through a route handler rather than a server action because the browser needs
progress events and only XHR reports them.

**Where they land** depends on the host, and the `local` driver is the trap: it
writes to the filesystem, which a serverless host does not have. On Vercel the
application is bundled into a read-only `/var/task`, so every upload failed with
`ENOENT: mkdir '/var/task/storage'` from inside a request — a stack trace naming
the symptom and nothing else. `storage()` now refuses that combination at the
boundary and says which of the two alternatives to pick, and `/api/health`
reports it before anyone tries to upload. The alternatives are `blob` (Vercel
Blob, which needs no second account) and `s3` (any S3-compatible bucket).

Identity documents deliberately take none of this path; see §9a.

---

## 11a. Motion, and why there is any

The interface was reported as feeling رigid — "جامد". The cause was not a
shortage of animation; it was that **`hover:` does not fire on a touch screen**.
Every button styled only for hover was inert from the moment it was tapped
until the server answered, which on the connections this product is used on is
a second or more of a screen that looks broken.

So the motion here does three jobs and no others, defined once in
`globals.css`:

| utility | job |
|---|---|
| `.press` | the tap registered — a 3% scale on `:active`, plus killing the Android tap highlight that would otherwise fight it |
| `.rise` | content arrived rather than appeared, staggered 40 ms per item via `--i` so a list reads top to bottom |
| `.lift` | a card acknowledges a press the way a physical button does |

Route-level `loading.tsx` skeletons matter for the same reason: a navigation
without one is the previous screen sitting there, indistinguishable from a
frozen app.

All of it sits under the existing `prefers-reduced-motion` block, which is
what makes it safe — nothing here carries meaning, so removing it leaves the
product fully usable rather than ambiguous.

---

## 12. What was left out of V1

| left out | why |
|---|---|
| Push notifications | needs a service worker, key pair, delivery service and a permission prompt; changes nothing about whether the product works. In-app notifications carry a structured payload, so adding push later is a transport, not a migration. |
| Native apps | the web app is the product; a wrapper adds two store review queues |
| Government / police integration | no such API exists to integrate with |
| Facial recognition, *automatic* ID verification | not available, and not appropriate for a civic tool handling lost documents. Identity cards are checked by a person instead — see §9a. |
| Live video, blockchain, real-time tracking | solve no problem this product has |
| A background job queue | matching is bounded and arithmetic; running it inline means the user sees the result on the confirmation screen instead of us operating a worker. `runMatchingForReport` is the single place to move behind a queue if the corpus outgrows it. |
| A charting library | the admin has one bar list and one column chart, both a few lines of CSS, both with an accessible table underneath |
| A component library | native `<dialog>` gives focus trapping, Escape and inertness for free |

---

## 13. Known limitations

- **Search relevance ranking** is applied to the fetched page, not in SQL.
  Ordering by trigram similarity across the whole table would cost far more
  than it is worth at this size. Revisit past ~100k reports.
- **Rate limiting is per-database, fixed-window.** Correct across app
  processes; a burst can straddle a window boundary. Move to Redis with a
  sliding window when there is more than one region.
- **Grid clustering** on the admin map can split two points that straddle a
  cell boundary. Inherent to the approach, acceptable for an operations map;
  the tested invariant is that no report ever disappears from it.
- **Geocoding is a nearest-centroid lookup** over 51 seeded neighbourhoods.
  Deliberate — it is exactly the granularity we are allowed to publish — but a
  pin more than 6 km from any of them gets no area name rather than a wrong one.
- **Identity review is a person, and does not scale on its own.** One
  moderator can clear a queue of tens per shift, not thousands. The gate lets a
  queued card publish precisely so that a backlog delays trust rather than the
  product; if submissions outpace reviewers for long, the honest options are
  more reviewers or a narrower gate, not a model.
- **`prisma generate` must run before typechecking** a fresh clone, since the
  client is generated into `src/generated/`. `npm run build` does this.
