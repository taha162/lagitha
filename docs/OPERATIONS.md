# Operations

What a small team needs to know to run LAGAITHA.

---

## Deploying

Any Node 20.11+ host with a PostgreSQL database. There is nothing
platform-specific in the codebase.

```bash
npm ci
npx prisma migrate deploy     # applies migrations, including the pg_trgm index
npm run build
npm run start
```

`prisma generate` runs as part of `npm run build` — the client is generated
into `src/generated/`, which is gitignored, so a fresh clone must build before
it can typecheck.

### Environment

Everything the server reads is declared in `src/lib/env.ts` and fails loudly at
startup if it is missing or wrong. Before going live you must set:

| variable | note |
|---|---|
| `DATABASE_URL` | |
| `SESSION_SECRET` | 32+ random chars — `openssl rand -base64 48`. Startup refuses a dev placeholder or anything shorter. |
| `OTP_PROVIDER` | **not** `console` — startup refuses it in production, because that driver prints login codes to the log |
| `STORAGE_DRIVER` | `s3` for anything with more than one app node |
| `NEXT_PUBLIC_SITE_URL` | used for canonical URLs, Open Graph and the sitemap |

`OTP_DEV_FIXED_CODE` must be unset in production; startup refuses it.

Set `SITE_NOINDEX=1` on staging. It switches `robots.txt` to disallow
everything and empties the sitemap.

### Sending the login code

Nobody can sign in until a delivery driver is configured. `OTP_PROVIDER`
selects it, and the driver decides whether the sign-in screen asks for an
email address or a phone number:

| value | channel | use |
|---|---|---|
| `smtp` | email | Gmail, Brevo, any SMTP host. **Free, no domain needed** |
| `resend` | email | best deliverability, requires a verified domain |
| `twilio` | SMS | works internationally including Iraq (paid) |
| `http` | SMS | any gateway with a plain HTTP API — local Iraqi aggregators |
| `console` | either | prints the code to the server log; **development only**, refused at startup in production |
| `disabled` | either | login is refused with a clear message (the default) |

**SMTP — the free path**

```
OTP_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx     # a Gmail App Password, not your password
MAIL_FROM=لَگيتها <you@gmail.com>
```

Gmail requires 2-factor authentication on the account before it will issue an
App Password, and caps sending at roughly 500 a day. Brevo
(`smtp-relay.brevo.com`) allows 300 a day free and lets you verify a single
sender address rather than a whole domain — useful before you own a domain.

Deliverability is the thing to watch: a code sent from a free Gmail address
lands in spam more often than one from a verified domain. The code screen
tells users to check their spam folder for exactly this reason. Move to
`resend` with your own domain once you have one.

**Resend — once you own a domain**

```
OTP_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxx
MAIL_FROM=لَگيتها <no-reply@yourdomain.iq>
```

Verify the domain in the Resend dashboard first; until you do, it will only
deliver to the address you signed up with.

**A note on the choice.** Email was chosen over SMS because SMS is never free —
carriers bill for every message. The cost is reach: some of the people this
platform is for will report a lost item from a phone without using email. The
SMS drivers below remain wired up and tested; switching is one variable.

**Twilio**

```
OTP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxx   # or TWILIO_FROM=+15551234567
```

Two things to know before relying on it for Mosul:

- A trial account only delivers to numbers you have verified in the Twilio
  console. Upgrade before real users try to sign in.
- International A2P traffic into Iraq is filtered by the local carriers more
  than most markets, and per-message cost is comparatively high. Test with a
  real Zain / Asiacell / Korek number before launch — do not assume it works.

**A local Iraqi gateway** (usually cheaper and more reliable for Iraqi numbers)

Most resellers expose one endpoint. No code needed — describe it in
environment variables. `{phone}`, `{message}` and `{code}` are substituted:

```
OTP_PROVIDER=http
SMS_HTTP_URL=https://gateway.example.iq/api/send
SMS_HTTP_METHOD=POST
SMS_HTTP_BODY={"to":"{phone}","text":"{message}","sender":"LAGAITHA"}
SMS_HTTP_HEADERS={"Authorization":"Bearer xxxxxxxx"}
```

For a GET-style gateway, put the placeholders in the URL and set
`SMS_HTTP_METHOD=GET`; the phone number is percent-encoded automatically.

Most Iraqi gateways require a registered **sender ID** (alphanumeric, e.g.
`LAGAITHA`) before they will deliver. Arrange that with the vendor first — it
usually takes a few days.

**Anything more unusual** — implement `OtpDeliveryProvider` in
`src/lib/providers/otp.ts` and add one branch to `otp()`. A driver must return
`false` on failure rather than throwing; login shows the user a human message
instead of a stack trace.

Check the result at `/api/health`: the `OTP_PROVIDER` row reports whether the
selected driver has everything it needs.

### Map tiles

The default tile URL points at `tile.openstreetmap.org`, whose usage policy is
not written for production traffic. Before launch, point `MAP_TILE_URL` at your
own cache or a commercial provider, and keep the attribution.

---

## Routine work

### Moderation queue

`/admin` is the start of the shift. "يحتاج انتباه" collects everything actually
waiting on a person:

- open flags
- reports auto-pulled into `UNDER_REVIEW` by the 3-flag threshold
- verification claims older than three days, where a finder has gone quiet

Empty queue is the normal state and the dashboard says so rather than showing
a chart.

### Reports

`/admin/reports` — filter by type, moderation state and status, or paste a
reference. The drawer holds the full record, including the precise coordinates
(staff tooling is the one place they surface) and a masked phone number:
enough to correlate a support call, not enough to hand out.

Available: hide, unhide, put under review, approve, reject, re-classify, mark
sensitive, close, reopen, re-run the matcher.

Re-classifying into a sensitive category also changes what the report
publishes — a correction that only changed the label would be cosmetic.

### Duplicates

`/admin/duplicates` lists same-type pairs the matcher considers near-identical.
Nothing is merged automatically. "Merge" closes the report you chose to drop,
notifies its author which report survived, and deletes nothing — a wrongly
merged report has to be recoverable.

### Users

`/admin/users` — admin-only. Suspend, ban, promote to moderator, demote. Every
action requires a written reason, and a suspension or ban deletes that user's
sessions in the same transaction, so it takes effect immediately.

### Audit log

`/admin/audit`. Append-only by construction — nothing in the application
updates or deletes an `AdminAction`. Every staff action writes one in the same
transaction as the change it describes.

---

## What to watch

The numbers on `/admin/analytics` are the ones that tell you whether the
product is working:

- **Recovery rate.** The point of the whole thing.
- **Median time to recovery.** Median, not mean — a few very old cases would
  otherwise dominate.
- **Match conversion.** What share of suggested matches became a recovery. If
  this is near zero, the matcher is generating noise: raise `MATCH_THRESHOLD`
  in `src/lib/matching.ts`.
- **Top categories and areas.** Where to focus outreach, and which categories
  need better wording in the wizard.

### Tuning the matcher

All in `src/lib/matching.ts`:

- `MATCH_THRESHOLD` (35) — below this no match is created. Raise it if users
  report irrelevant suggestions.
- `HIGH_CONFIDENCE` (70) — where the UI says "احتمال تطابق مرتفع".
- `WEIGHTS` — the per-signal contributions.

Change a number, run `npm test`; the matching tests pin the behaviour that
must not regress.

### Vocabulary

`SYNONYM_GROUPS` in `src/lib/arabic.ts` is a short, plain list. If users
consistently fail to find things by a word, add it. It needs no migration —
but existing reports keep the haystack they were written with, so run a
backfill of `refreshSearchText` if the change matters retroactively.

Neighbourhoods live in `prisma/seed.ts`. Adding one and re-running
`npm run db:seed` is idempotent.

---

## Housekeeping

- `pruneExpiredRateLimits()` (`src/lib/rate-limit.ts`) clears spent counters.
  Safe at any time; a daily cron is plenty.
- Expired sessions and consumed OTP challenges accumulate slowly. Both are
  indexed on `expiresAt` and safe to delete once past.
- Orphaned uploads: an image uploaded in an abandoned wizard stays parked
  against the `__pending__` sentinel. Deleting `ReportImage` rows with that
  `reportId` older than a day, along with their storage objects, is safe.

## Backups

`reports`, `users`, `recoveries` and `admin_actions` are the irreplaceable
tables. Uploaded images are in object storage and should be backed up on the
bucket's own schedule.

Recovery records are the project's evidence that it works — keep them longest.

---

## Data protection

- Phone numbers are never exposed to another user by any code path, and staff
  see them masked. `maskPhone` exists so that any future contact surface has to
  go out of its way to leak one.
- Precise coordinates never reach a browser outside the admin drawer.
- Users can edit their display name and sign out everywhere from
  `/me/account`.
- Deleting a user cascades to their reports, sessions, messages and
  notifications. `Recovery` rows are the exception: their report and
  participant references are set to null rather than cascading, so the record
  that an item was returned survives while carrying no personal data. This is
  what keeps the impact statistics honest after an account is removed.
- **Self-service account deletion is not built yet.** The data model supports
  it (see above), but there is no user-facing action — removing an account
  today means deleting the `users` row directly, which triggers the cascades
  described above. Building the button is the natural next task.
