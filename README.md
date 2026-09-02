# لَگيتها — LAGAITHA

> ضاع منك؟ خلي نلگيه.

A lost & found platform for Mosul. Someone who has lost something files a report
in about a minute; someone who found something does the same; the platform looks
for plausible pairs, makes the claimant prove the item is theirs, and lets the
two arrange a handover without either of them publishing a phone number.

Arabic-first, RTL, mobile-first.

---

## Running it

Requirements: Node 20.11+, PostgreSQL 14+.

```bash
cp .env.example .env          # then edit DATABASE_URL and SESSION_SECRET
npm install
npm run db:migrate            # creates the schema
npm run db:seed -- --demo     # categories + Mosul areas + demo content
npm run dev
```

`--demo` adds demo accounts and reports. Every demo account is labelled
`(حساب تجريبي)` in the name shown on its reports, so demo content is never
mistaken for a real report. Reference data (categories, neighbourhoods) is
seeded without the flag and is safe to run in production.

Sign in with any seeded address — `admin@lagaitha.local` is an admin,
`abu.ahmed@lagaitha.local` and the others are ordinary members — and the
password `lagaitha-demo-2026`. Every demo account is created already verified,
so it can publish.

To exercise the sign-up flow instead, `/signup` sends a six-digit code to the
address given. With `OTP_DEV_FIXED_CODE=000000` that code is always `000000`;
without it the `console` driver prints the real one to the server log.

```bash
npm test          # 261 unit + integration tests (needs TEST_DATABASE_URL)
npm run typecheck
npm run build
```

---

## What it does

**For people**

- Create an account once: name, email, password, and optionally a photo and a
  neighbourhood. After that, signing in is the password; a one-time code is
  there for a forgotten one.
- Report something lost or found — a six-step flow, one question per screen,
  where only *what it is* and *roughly where* are required. Publishing needs a
  verified identity first (below).
- Search in the Arabic people actually type: `ايفون اسود`, `محفظه`, `موبايل`.
- Approximate locations only. The precise pin is stored, never published.
- Potential matches with the reasons behind each score, always worded as
  "تطابق محتمل".
- Ownership verification: describe a detail that was never published.
- Messaging tied to a report. No phone numbers.
- Two-sided recovery confirmation.

**For staff** — a separate desktop-first console at `/admin`: dashboard,
report queue with a review drawer, matches, ownership-verification oversight,
the identity-card queue, duplicate candidates, flags, users, a clustered map,
analytics, and an audit log.

---

## Stack

| | | why |
|---|---|---|
| Next.js 16 (App Router) + React 19 | framework | server components keep the mobile JS payload small |
| TypeScript (strict, `noUncheckedIndexedAccess`) | | |
| Tailwind CSS v4 | styling | CSS-first `@theme` *is* the design-token file |
| PostgreSQL + Prisma 7 | data | `pg_trgm` makes partial-word Arabic search indexable |
| Zod | validation | one schema per mutation, server-side |
| Leaflet + OpenStreetMap | maps | no API key; raster tiles show something immediately on a slow connection |
| sharp | images | re-encoding every upload is the security boundary as well as the optimisation |
| lucide-react | icons | one consistent set |
| Vitest | tests | |

No component library. Modals and sheets use the native `<dialog>` element,
which provides focus trapping, Escape-to-close and inertness without a
dependency.

### Deliberately not included

Push notifications, native apps, facial recognition, blockchain, live video,
government or police integrations, and *automatic* identity verification — all
either unavailable in this context, or unnecessary for the product to work.
Identity cards are read by a person, not by a model. See
`docs/ARCHITECTURE.md` for the reasoning on each.

---

## The five rules the code enforces

1. **Precise coordinates never leave the server.** They are written by
   `createReport`, read by the matcher and by staff tooling, and coarsened to a
   ~300 m grid for anything public. Every public read path goes through
   `src/lib/privacy.ts`.
2. **Sensitive reports publish a generic label.** A lost national ID appears as
   *وثيقة شخصية* with no description and no images — shareable by link, and
   excluded from the search index.
3. **An identity card is deleted the moment it is judged.** Both sides of the
   national ID are required before a person can publish, and they are stored
   under a prefix that the public media route refuses, readable only through a
   staff route that logs every single view. The decision write is the same
   write that clears the keys and deletes the objects — an approved account
   keeps a date, never the document. The card number is never asked for.
4. **A finder must commit before they see a claim.** The claimant answers a
   question about a detail that was never published; the finder only sees that
   answer *after* recording what they expect it to be, and the finder's secret
   is snapshotted onto the claim so a later edit cannot move the goalposts.
5. **Recovery needs both sides.** One person cannot close a case the other
   never agreed to — which is what makes the recovery statistics mean anything.

Each of these has tests in `tests/unit/privacy.test.ts`,
`tests/integration/identity.test.ts`, `tests/integration/verification.test.ts`
and `tests/integration/recovery.test.ts`.

---

## External services

Everything that could be unavailable sits behind an interface with a working
fallback, in `src/lib/providers/`:

| interface | default | swap in |
|---|---|---|
| `OtpDeliveryProvider` | `console` (prints the code to the log) | `smtp` / `resend` (email) or `twilio` / `http` (SMS) |
| `StorageProvider` | `local` (files under `./storage`) | any S3-compatible bucket |
| `AIAnalysisProvider` | `none` | a model, as an *enhancement* only |
| `GeocodingProvider` | local lookup over the seeded Mosul neighbourhoods | a geocoding service |

AI in particular is never on the critical path. `AI_PROVIDER=none` is the
default, analysis is capped at a four-second timeout, and every failure mode —
timeout, rate limit, malformed response, switched off — takes the same path:
the report publishes unchanged. It can nudge a match score by at most five
points out of a hundred and can never create one on its own.

---

## Layout

```
prisma/            schema, migrations, seed
src/
  app/             routes; actions/ holds all server actions
  components/      ui/ primitives, map/ Leaflet wrappers
  lib/
    privacy.ts     the public-serialisation boundary
    authz.ts       every authorization decision
    matching.ts    pure scoring — no database, no network
    arabic.ts      normalisation, synonyms, similarity
    geo.ts         distance, coarsening, clustering
    services/      database access per domain
    providers/     replaceable external services
  i18n/ar.ts       every user-facing string
tests/             unit (pure) + integration (real Postgres)
docs/              architecture and operations notes
```

Adding English is a matter of writing `src/i18n/en.ts` against the exported
`Dictionary` type — no component reads a literal string.

---

## Documentation

- `docs/ARCHITECTURE.md` — the design decisions and what was deliberately left out
- `docs/OPERATIONS.md` — deployment, moderation, and what to watch
