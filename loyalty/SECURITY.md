# Security and Operations

This checklist is part of deployment, not optional documentation. Complete it in a dedicated Supabase test project before storing real customer data.

## Before launch

- Obtain approval for the chosen Supabase hosting region. Supabase does not currently offer a UAE region.
- Put only the modern public publishable key in `config.js`.
- Keep every secret/service-role key in Supabase-managed server secrets only. The Edge Function prefers the managed `SUPABASE_SECRET_KEYS["default"]` value.
- Set `SITE_ORIGIN=https://2thooo.github.io` and `SITE_BASE_PATH=/x-stop-site/loyalty` exactly.
- Keep production CORS restricted to that exact origin. Use a separate Supabase test project for localhost development; do not point a local browser build at production.
- Keep the built-in iframe refusal enabled. For browser-enforced anti-framing headers, move staff operations to an isolated host that can send a `Content-Security-Policy: frame-ancestors 'none'` response header.
- Before enrolling real customers, audit every script on the shared `2thooo.github.io` origin or deploy this directory to an isolated origin. URL paths do not isolate `localStorage`, so another compromised same-origin page could read customer bearer credentials.
- Keep public Supabase Auth signup and anonymous sign-in disabled. Create separate named Auth users for admins; never share an admin account among staff.
- Use long, unique owner passwords. If MFA is enabled, verify that the actual sign-in flow enforces it before describing the site as MFA-protected.
- Review activity reward rules and customer-facing wording for all six activities.
- Have privacy, retention, data-subject-request and cross-border hosting choices reviewed for applicable UAE requirements.
- Define who verifies a customer before the first point award or a PIN-reset code is issued.
- Test enrollment, login, recovery, scan, cancel, point award, reward redemption, expiry, replay and concurrent confirmation.
- Test installation and camera behavior on real iPhone and Samsung devices.
- Define a database backup/export schedule appropriate to the business; do not assume free-tier backups meet it.

## Direct-access smoke test

Using the browser's public key, direct REST reads and writes to all of these tables must fail or return no rows:

- `business_settings`
- `operator_profiles`
- `customers`
- `loyalty_activities`
- `loyalty_accounts`
- `customer_sessions`
- `qr_credentials`
- `enrollment_invites`
- `pin_reset_codes`
- `scan_tokens`
- `scan_events`
- `auth_attempts`

Anonymous and ordinary authenticated roles must not be able to call the database functions directly. Only the deployed Edge Function's server credential should have the `service_role` grants.

## Required abuse-path tests

1. Register without a join code, confirm that a unique random member code is generated, then confirm duplicate-phone registration fails and enrollment throttling activates.
2. Scan the same QR twice: the second scan must fail even if it occurs immediately or concurrently.
3. Wait beyond five minutes: scanning the old code must fail as expired.
4. Confirm the same scan twice with different idempotency keys: only one point event may exist.
5. Repeat a request with the same idempotency key: it must not award twice.
6. Cancel a scan, then try to confirm it: confirmation must fail.
7. Copy a Laser Tag QR and try to award another activity: the stored scan remains bound to Laser Tag.
8. Log in on a new browser, then use a QR credential from the old browser: the old credential must fail.
9. Fail customer login repeatedly: attempts after the configured threshold must be temporarily blocked.
10. Reuse or expire a PIN-reset code: recovery must fail.
11. Recover successfully, then try old sessions/QR credentials: all must fail.
12. Use an authenticated Supabase user without an active owner profile: every staff action must fail.

## Enrollment and phone-number limitation

The app deliberately avoids SMS fees and does not send OTPs. Registration is public and rate-limited, but it does not prove that the applicant owns the entered phone number. Someone could reserve another person's phone number or create fabricated accounts. Staff must verify the customer before awarding the first points, and a verified OTP provider should be added later if stronger ownership proof is required.

## QR handling

The long-lived QR credential is never displayed. A member-summary request uses it to mint a random, activity-bound scan token that:

- is stored only as a SHA-256 digest
- expires after five minutes
- is atomically marked consumed on the first accepted scan
- is linked to the exact activity selected by the customer

Do not take or retain screenshots of customer QRs. A screenshot has a short lifetime but remains a bearer capability until consumed or expired.

An accepted staff scan consumes the one-time token before point/reward confirmation. If the staff page closes, navigates away or loses the response, leave the raw scan unresolved in the audit history and ask the customer to refresh their selected activity QR. Never create an off-system award to compensate; resolve disputes from the recorded scan and transaction history.

## Lost owner device or suspected owner compromise

1. Change the owner's password immediately.
2. Revoke that user's active Supabase Auth sessions.
3. Set `operator_profiles.is_active=false` for the affected user.
4. Review recent registration, reset-code, scan, point and redemption activity.
5. Create a new named owner user if the device/account cannot be trusted.
6. Re-enable the profile only after the device and account are secured.

The staff bearer token is kept only in page memory and is never placed in browser storage. Refreshing, closing or navigating away from the loyalty page signs staff out. The Admin route is not shown in customer navigation, but its protection comes from Supabase email/password authentication and the active owner profile—not from hiding the URL. This does not replace server-side session revocation after loss or compromise. Use the bundled in-app scanner for normal iPhone operation; opening a loyalty QR in a new Camera-app tab requires another staff sign-in.

## Customer PIN recovery

1. Verify the customer in person using the business's approved procedure.
2. Select **Reset PIN** for the correct member in the owner dashboard.
3. Give the raw code directly to that customer. It is displayed once and expires after 15 minutes.
4. The customer enters it on the recovery screen and privately chooses a new six-digit PIN.
5. Never ask for, write down or try to reveal the old or replacement PIN.

Successful recovery revokes old customer sessions and QR credentials. The database stores only the reset-code hash.

## Key or backend compromise

If a secret/service-role key is exposed:

1. Rotate the key in Supabase immediately.
2. Redeploy the Edge Function with the replacement credential.
3. Review database and function logs plus the complete event history.
4. Assess whether customer notification or regulatory action is required.
5. Do not treat removal from Git history as sufficient remediation; an exposed secret is compromised even after deletion.

If the public publishable key is exposed, that is expected—it is not a secret. Security still depends on RLS, revoked grants, Edge Function validation and owner authorization. Investigate only if those controls were changed or the key had unintended privilege.

## Data retention, backups and recovery

- Decide and document retention periods for customer identity, inactive accounts and audit events.
- Keep the immutable event history needed for disputes, but do not retain personal data indefinitely without a defined purpose.
- Practice restoring or importing a backup before launch.
- Export configuration and record the owner-recovery procedure outside the deployed website.
- Free-tier pause, retention and backup behavior can change; verify the current Supabase plan before relying on it.
