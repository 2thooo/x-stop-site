# X Group Activity Passport

An installable, wallet-fee-free loyalty and booking website for **X Group**. It runs from the phone home screen on iPhone, Samsung and other modern mobile devices; it is not an Apple Wallet or Samsung Wallet pass.

The customer experience is one X Group Passport with six independent activity cards:

- Laser Tag
- Bowling
- Escape Room
- Billiard
- PC & PlayStation
- Others

Each card has its own points, reward rule, last scan and short-lived QR. The staff dashboard keeps raw scans separate from confirmed point awards and shows up to 1,000 recent accepted events in Dubai time. A compact dark booking panel presents all three venues side by side with direct WhatsApp, phone and Google Maps actions. The deployed interface includes a persistent English/Arabic toggle across customer, booking, privacy, scanner and admin screens, with native right-to-left layout in Arabic.

## Security and product behavior

- Customers register directly; no join code is requested.
- The database automatically creates a non-sequential member code such as `X-7A4C-9F2E-D681-3B05`; uniqueness is enforced and rare collisions are retried.
- Customers sign in with a UAE-normalized phone number and a six-digit PIN.
- PINs use PBKDF2-SHA-256 with a unique salt; readable PINs are never stored.
- Customer sessions and QR credentials are stored in the database only as SHA-256 hashes.
- Every displayed QR is activity-specific, expires in five minutes and is consumed atomically on first scan.
- Staff must review the member and activity before confirming points.
- A customer may request a reward, but only authenticated staff can scan the current activity QR, confirm the redemption and atomically deduct one available reward.
- Duplicate point confirmation is prevented by both an idempotency key and a database uniqueness rule.
- PIN recovery requires a one-use, 15-minute code issued after in-person staff verification. The customer chooses the replacement PIN privately.
- Direct anonymous and ordinary authenticated access to every public table/function is revoked. The Edge Function is the only data boundary.
- Admin authorization requires Supabase email/password sign-in and is checked against an active `operator_profiles` owner row for every privileged action. Public Supabase Auth signup and anonymous sign-in are disabled.

The website does **not** send an OTP, so it does not independently prove ownership of the customer phone number. Staff should verify the customer before awarding the first points or issuing a PIN-reset code. Direct registration is rate-limited, but an OTP remains the correct future control for proving phone ownership.

## Live entry points

- Customer Passport: `https://2thooo.github.io/x-stop-site/loyalty/#/passport`
- Password-protected Admin: `https://2thooo.github.io/x-stop-site/loyalty/#/admin`

The bare `/loyalty/` URL redirects into the Passport route, making it the stable target for a printed in-shop QR. The visible product name is X Group; removing `2thooo` from the free GitHub Pages address requires an X Group custom domain such as `loyalty.xgroup.ae`.

## Venue booking and location routes

- X Entertainment RAK Mall — Laser Tag, Bowling, Escape Room, Billiard, PC & PlayStation, Others — RAK Mall, Al Qurum, Ras Al Khaimah — `+971 54 731 0073` — [Map](https://www.google.com/maps?cid=12180427487395956802)
- Masters Bowling — Bowling — Opposite Naeem Mall, Al Nakheel, Ras Al Khaimah — `+971 54 731 0073` — [Map](https://www.google.com/maps?cid=6477996226481961738)
- Expert Billiards — Billiard — LULU Buhairah, 1st Floor, Al Majaz 3, Sharjah — `+971 58 624 9734` — [Map](https://www.google.com/maps?cid=21444396744758821)

The numbers, addresses, activity availability and direct map links are centralized in `config.js`. Bowling offers separate WhatsApp actions for X Entertainment and Masters Bowling; Billiard offers X Entertainment and Expert Billiards. Laser Tag is available only at X Entertainment, while Expert Billiards never appears for Bowling, Escape Room or Laser Tag. The supplied Masters Bowling WhatsApp number differs from the current Google listing, so confirm that routing number before printing permanent signage.

## Architecture

GitHub Pages hosts only the static interface. Supabase provides Auth, PostgreSQL and one Edge Function. Never put customer records, owner passwords, refresh tokens, private/secret keys or the service-role key into GitHub, `config.js`, browser storage or a public JSON file.

The browser stores only the current customer's random session/QR credentials in `localStorage`. The staff access JWT is kept only in JavaScript memory and is never written to browser storage; refreshing or closing the page signs staff out. This is deliberate because the existing X Stop site shares the same GitHub Pages origin. The bundled in-app QR decoder lets iPhone staff scan without opening a new Camera-app tab in the normal flow.

The GitHub Pages build is fully connected to the dedicated production backend. Because browser storage is isolated by origin rather than URL path, a compromised script elsewhere on `2thooo.github.io` could still read customer credentials. Audit the existing root site before enrolling real customers, and plan an isolated custom origin such as `rewards.xgroup.ae` for stronger separation.

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

The live project is **X Group Loyalty** in Supabase's South Asia (Mumbai) region, the closest specific region currently offered to the UAE. Confirm the cross-border data-hosting and legal requirements before loading real customer data.

Install or run the Supabase CLI, then from this project directory:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase secrets set SITE_ORIGIN=https://2thooo.github.io SITE_BASE_PATH=/x-stop-site/loyalty DEFAULT_COUNTRY_CODE=971
npx supabase functions deploy loyalty-api --no-verify-jwt
```

`--no-verify-jwt` is intentional: enrollment, customer login, recovery and member-summary are public HTTP actions with their own validation. The function itself verifies the Supabase bearer token and owner role before any staff action.

The hosted Edge Function reads the managed `SUPABASE_SECRET_KEYS` dictionary and uses the named `default` secret key only on the server. A legacy `SUPABASE_SERVICE_ROLE_KEY` fallback remains for older Supabase projects. Never place either credential in the browser or repository; rotate and redeploy immediately if one is exposed.

## 2. Create the first owner

In **Supabase Dashboard → Authentication → Users**, create the admin's email/password user. Copy the user's UUID, then run in SQL Editor:

```sql
insert into public.operator_profiles
  (user_id, display_name, role, branch_name, is_active)
values
  ('OWNER-AUTH-USER-UUID', 'X Group Admin', 'owner', 'RAK Mall', true);
```

Use a long, unique password. Enable MFA in Supabase Auth as a separate hardening step if the chosen owner sign-in flow is configured to enforce it; this starter currently uses email/password and does not claim MFA enforcement.

## 3. Configure the public website

`config.js` contains the live project's URL and browser-safe publishable key. To connect a fork to another Supabase project, start from `config.example.js` and replace only these placeholders:

```js
supabaseUrl: "https://YOUR-PROJECT.supabase.co",
supabaseAnonKey: "YOUR-PUBLIC-PUBLISHABLE-OR-ANON-KEY",
```

Use the project's modern **publishable key**, never a secret key or service-role key. The remaining X Group values are already configured for the existing GitHub Pages path and RAK Mall branch.

The bundled X Group umbrella mark is `assets/x-group-logo.jpg`, sourced from the existing X Stop repository. The matching PWA icon and three dark venue illustrations were created with OpenAI image generation and optimized locally. Activity icons, venue artwork and PWA icons are bundled, so the installed experience does not depend on third-party image hosts. The venue images are promotional illustrations, not photographs of the physical shops.

Bundled Poppins and jsQR licensing/provenance is recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## 4. GitHub Pages

For the existing `2thooo/x-stop-site` repository, place this project under `loyalty/`. In **Settings → Pages**, use the repository's existing Pages source or publish `main` from `/ (root)`. Do not configure a workflow that publishes only `loyalty/`, because that would replace the existing root website.

The included `.github/workflows/deploy-pages.yml` is a standalone-project template. It is intentionally inactive when stored inside `loyalty/.github/` in the existing repository. The existing branch-based Pages deployment serves the subdirectory.

After Pages updates, verify:

- `/loyalty/` opens the Passport route over HTTPS.
- `/loyalty/#/admin` shows an email/password gate before any staff tools.
- the manifest and service worker load from `/x-stop-site/loyalty/`.
- iPhone Safari offers **Share → Add to Home Screen**.
- Android/Chrome offers **Install app** or **Add to Home screen**.

## Customer flow

1. The customer enters their first name, UAE phone number and a private six-digit PIN—no join code is needed.
2. The database assigns a random, non-enumerable member code with no small numeric ceiling.
3. The customer selects one of the six activity cards.
4. The app creates a one-use QR for that exact activity, valid for five minutes.
5. Staff scans and verifies the member and activity, then confirms points or records no transaction. If the customer requests a reward, authenticated staff confirms the redemption and the database deducts one available reward atomically.
6. A login from another browser rotates the long-lived QR credential and invalidates the previous credential.

## PIN recovery

1. Staff verifies the customer in person.
2. From the dashboard member row, staff selects **Reset PIN**.
3. The verified customer scans the displayed recovery QR or receives the one-time code directly.
4. The customer opens the prefilled recovery screen (or **Passport → Use a reset code**) and chooses a new PIN.
5. Successful recovery revokes all old customer sessions and QR credentials.

## Reward rules

The dashboard allows the owner to set, independently for each activity:

- points awarded per confirmed visit (`1–20`)
- points required for a reward (`2–1000`)
- the customer-facing reward message in English
- the customer-facing reward message in Arabic

Both reward messages are required and saved together with the activity settings; the customer and staff views show the message for the selected interface language. The initial migration seeds one point per visit and a ten-point target for every activity. Review the commercial offer before launch; the default reward text is illustrative, not a customer contract.

## Staff guide and rollout poster

The employee guide is English-only. The customer poster remains bilingual:

- [Employee Guide — PowerPoint](docs/X-Group-Employee-Guide-English.pptx)
- [Employee Guide — PDF](docs/X-Group-Employee-Guide-English.pdf)
- [Customer Loyalty Poster — PDF](docs/X-Group-Loyalty-Poster-Bilingual.pdf)
- [Customer Loyalty Poster — PNG](docs/X-Group-Loyalty-Poster-Bilingual.png)

## Local preview

The site uses browser modules and must be served over HTTP:

```bash
python -m http.server 4173
```

Open `http://localhost:4173` for static visual review. The production Edge Function accepts browser requests only from the published GitHub Pages origin, so localhost cannot change production loyalty data. For functional development, use a separate checkout, copy `config.example.js` to `config.js`, and connect it to a dedicated test Supabase project.

## Validation

Run the deterministic frontend tests and syntax checks:

```bash
npm test
node --check src/app.js
node --check src/api.js
node --check src/core.js
```

The included tests cover UAE/international phone normalization, PIN shape, HTML escaping, QR parsing and key registration/booking contracts. They are not a substitute for testing the migration, RLS, Edge Function, camera permissions and complete customer/staff flow against a dedicated Supabase test project.

Before production, follow [SECURITY.md](SECURITY.md), test replay/expiry/concurrency paths on real iPhone and Samsung devices, and have the privacy/retention wording reviewed for the business's UAE obligations.

## Moving to an X Group custom domain

When a domain such as `rewards.xgroup.ae` is ready, update all origin-dependent values together: `SITE_ORIGIN` and `SITE_BASE_PATH` in Edge Function secrets, `basePath` in `config.js`, the Auth Site URL/redirect allow-list, and GitHub Pages custom-domain settings. Then redeploy the Edge Function, bump the service-worker cache name, and repeat the CORS, manifest, customer-login and admin-login checks from the new origin.

## Free-tier and operational limits

- Free Supabase projects may pause after inactivity and have limited backup/retention guarantees.
- Supabase currently offers no UAE hosting region; obtain an explicit hosting decision before storing real customer data.
- Browsers without native `BarcodeDetector` use the bundled, locally hosted jsQR decoder. The normal phone Camera app remains a backup, but a new tab may require the owner to sign in again.
- The app disables all controls when embedded in an iframe. GitHub Pages cannot add a response-header `frame-ancestors` policy, so use an isolated, header-capable staff origin if stronger browser-enforced clickjacking protection is required.
- Customer sessions last 30 days; displayed scan tokens last five minutes.
- Accepting a staff scan consumes that one-time token before the award screen. If the page closes or loses its response, the raw scan remains auditable with no points attached and the customer must refresh their activity QR.
- The dashboard pages through 250 active members at a time and shows 1,000 recent events, while the database retains the full audit history.
- This PWA does not appear in Apple Wallet or Samsung Wallet.
