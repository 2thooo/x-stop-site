# X Entertainment Activity Passport

An installable, wallet-fee-free loyalty website for **X Entertainment RAK Mall**. It runs from the phone home screen on iPhone, Samsung and other modern mobile devices; it is not an Apple Wallet or Samsung Wallet pass.

The customer experience is one X Passport with five independent activity cards:

- Laser Tag
- Bowling
- Billiard
- PC Gaming
- PlayStation

Each card has its own points, reward rule, last scan and short-lived QR. The staff dashboard keeps raw scans separate from confirmed point awards and shows up to 1,000 recent accepted events in Dubai time.

## Security and product behavior

- New accounts require an owner-generated, one-use enrollment code.
- Customers sign in with a UAE-normalized phone number and a six-digit PIN.
- PINs use PBKDF2-SHA-256 with a unique salt; readable PINs are never stored.
- Customer sessions and QR credentials are stored in the database only as SHA-256 hashes.
- Every displayed QR is activity-specific, expires in five minutes and is consumed atomically on first scan.
- Staff must review the member and activity before confirming points.
- Duplicate point confirmation is prevented by both an idempotency key and a database uniqueness rule.
- PIN recovery requires a one-use, 15-minute code issued after in-person staff verification. The customer chooses the replacement PIN privately.
- Direct anonymous and ordinary authenticated access to every public table/function is revoked. The Edge Function is the only data boundary.
- Owner authorization is checked against an active `operator_profiles` row for every privileged action.

The website does **not** send an OTP, so it does not independently prove ownership of the phone number. Staff should verify the number in person before issuing an enrollment or reset code.

## Architecture

GitHub Pages hosts only the static interface. Supabase provides Auth, PostgreSQL and one Edge Function. Never put customer records, owner passwords, refresh tokens, private/secret keys or the service-role key into GitHub, `config.js`, browser storage or a public JSON file.

The browser stores only the current customer's random session/QR credentials in `localStorage`. The staff access JWT is kept only in JavaScript memory and is never written to browser storage; refreshing or closing the page signs staff out. This is deliberate because the existing X Stop site shares the same GitHub Pages origin. The bundled in-app QR decoder lets iPhone staff scan without opening a new Camera-app tab in the normal flow.

Because browser storage is isolated by origin rather than URL path, any compromised script elsewhere on `2thooo.github.io` could read customer credentials. Treat the GitHub Pages build as a preview until the existing root site has been security-audited, or deploy the `loyalty/` directory from this same repository to an isolated custom origin such as `rewards.xgroup.ae` before enrolling real customers.

The intended existing-repository location is:

```text
2thooo/x-stop-site
└── loyalty/
```

With GitHub Pages publishing the repository root, the site URL is:

```text
https://2thooo.github.io/x-stop-site/loyalty/
```

This preserves the existing X Stop website while adding the loyalty app as a separate path.

## 1. Create and connect Supabase

Create a free Supabase project in the region approved for the business. The current Supabase region list does not include the UAE, so confirm the data-hosting location and legal requirements before loading real customer data.

Install or run the Supabase CLI, then from this project directory:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase secrets set SITE_ORIGIN=https://2thooo.github.io SITE_BASE_PATH=/x-stop-site/loyalty DEFAULT_COUNTRY_CODE=971
npx supabase functions deploy loyalty-api --no-verify-jwt
```

`--no-verify-jwt` is intentional: enrollment, customer login, recovery and member-summary are public HTTP actions with their own validation. The function itself verifies the Supabase bearer token and owner role before any staff action.

The hosted Edge Function automatically receives `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key must remain server-side. If it is ever exposed, rotate it and redeploy immediately.

## 2. Create the first owner

In **Supabase Dashboard → Authentication → Users**, create the owner's email/password user. Copy the user's UUID, then run in SQL Editor:

```sql
insert into public.operator_profiles
  (user_id, display_name, role, branch_name, is_active)
values
  ('OWNER-AUTH-USER-UUID', 'X Entertainment Owner', 'owner', 'RAK Mall', true);
```

Use a long, unique password. Enable MFA in Supabase Auth as a separate hardening step if the chosen owner sign-in flow is configured to enforce it; this starter currently uses email/password and does not claim MFA enforcement.

## 3. Configure the public website

Open `config.js` and replace only these placeholders:

```js
supabaseUrl: "https://YOUR-PROJECT.supabase.co",
supabaseAnonKey: "YOUR-PUBLIC-PUBLISHABLE-OR-ANON-KEY",
```

Use the project's **publishable key** (or legacy `anon` key), never a secret key or service-role key. The remaining X Entertainment values are already configured for the existing GitHub Pages path and RAK Mall branch.

The official X Entertainment logo is preserved in `assets/x-entertainment-logo.jpg`. Activity icons and PWA icons are included locally, so the installed experience does not depend on third-party image hosts.

Bundled Poppins and jsQR licensing/provenance is recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## 4. GitHub Pages

For the existing `2thooo/x-stop-site` repository, place this project under `loyalty/`. In **Settings → Pages**, use the repository's existing Pages source or publish `main` from `/ (root)`. Do not configure a workflow that publishes only `loyalty/`, because that would replace the existing root website.

The included `.github/workflows/deploy-pages.yml` is a standalone-project template. It is intentionally inactive when stored inside `loyalty/.github/` in the existing repository. The existing branch-based Pages deployment serves the subdirectory.

After Pages updates, verify:

- `/loyalty/` opens over HTTPS.
- the manifest and service worker load from `/x-stop-site/loyalty/`.
- iPhone Safari offers **Share → Add to Home Screen**.
- Android/Chrome offers **Install app** or **Add to Home screen**.

## Customer flow

1. Staff signs in and creates a one-use join code after checking the customer in person.
2. The customer scans the displayed enrollment QR (or copies the code), then enters their name, UAE phone number and a private six-digit PIN.
3. The customer selects one of the five activity cards.
4. The app creates a one-use QR for that exact activity, valid for five minutes.
5. Staff scans, verifies the member and activity, then confirms points, redeems an available reward or records no transaction.
6. A login from another browser rotates the long-lived QR credential and invalidates the previous credential.

## PIN recovery

1. Staff verifies the customer in person.
2. From the dashboard member row, staff selects **Reset PIN**.
3. The verified customer scans the displayed recovery QR or receives the one-time code directly.
4. The customer opens the prefilled recovery screen (or **My passport → Use a reset code**) and chooses a new PIN.
5. Successful recovery revokes all old customer sessions and QR credentials.

## Reward rules

The dashboard allows the owner to set, independently for each activity:

- points awarded per confirmed visit (`1–20`)
- points required for a reward (`2–1000`)
- the customer-facing reward message

The initial migration seeds one point per visit and a ten-point target for every activity. Review the commercial offer before launch; the default reward text is illustrative, not a customer contract.

## Local preview

The site uses browser modules and must be served over HTTP:

```bash
python -m http.server 4173
```

Open `http://localhost:4173`. Backend actions remain in preview mode until `config.js` contains a real Supabase URL and public key.

## Validation

Run the deterministic frontend tests and syntax checks:

```bash
npm test
node --check src/app.js
node --check src/api.js
node --check src/core.js
```

The eleven included tests cover UAE/international phone normalization, PIN shape, HTML escaping and QR parsing. They are not a substitute for testing the migration, RLS, Edge Function, camera permissions and complete customer/staff flow against a dedicated Supabase test project.

Before production, follow [SECURITY.md](SECURITY.md), test replay/expiry/concurrency paths on real iPhone and Samsung devices, and have the privacy/retention wording reviewed for the business's UAE obligations.

## Free-tier and operational limits

- Free Supabase projects may pause after inactivity and have limited backup/retention guarantees.
- Supabase currently offers no UAE hosting region; obtain an explicit hosting decision before storing real customer data.
- Browsers without native `BarcodeDetector` use the bundled, locally hosted jsQR decoder. The normal phone Camera app remains a backup, but a new tab may require the owner to sign in again.
- The app disables all controls when embedded in an iframe. GitHub Pages cannot add a response-header `frame-ancestors` policy, so use an isolated, header-capable staff origin if stronger browser-enforced clickjacking protection is required.
- Customer sessions last 30 days; displayed scan tokens last five minutes.
- Accepting a staff scan consumes that one-time token before the award screen. If the page closes or loses its response, the raw scan remains auditable with no points attached and the customer must refresh their activity QR.
- The dashboard pages through 250 active members at a time and shows 1,000 recent events, while the database retains the full audit history.
- This PWA does not appear in Apple Wallet or Samsung Wallet.
