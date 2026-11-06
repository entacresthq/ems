# EMS (Entacrest MFB Solution) — frontend

EMS is an Entacrest Nexus product for lending cooperatives and thrift businesses. This is its web frontend. The demo organisation has a headquarters that oversees five branches (Egbeda, Olugbede, Ikotun, Ipaja, Igando). One codebase serves two experiences:

- **Back office** (`/`) for the MD, general manager, branch managers, accountants, cashiers and admins. Desktop-first and responsive.
- **Field app** (`/field`) for account officers. A mobile-first PWA that can be installed on Android and opens offline behind a 6-digit PIN.

EMS is sold as a subscription. Its backend is SynchGate's `ems` Django app (in the SynchGate repo, `gateway/ems/`): businesses sign up, pay monthly, and their staff sign in with SynchGate accounts. For development and demos the app can instead run on [MSW](https://mswjs.io) mock handlers backed by seeded Nigerian data (`VITE_USE_MOCKS=true`).

## Setup

Requires Node 20 or later.

```bash
npm install
cp .env.example .env     # mocks are on by default
npm run dev              # http://localhost:5173
```

### Demo accounts (mock mode)

Every account uses the password `Demo@2026`. The SMS code is always `123456`. The sign-in screen lists these accounts, and clicking one fills in the form.

| Email             | Role              | Notes                                 |
| ----------------- | ----------------- | ------------------------------------- |
| md@ems.ng         | Managing director | Headquarters, everything              |
| gm@ems.ng         | General manager   | Headquarters, all branch operations   |
| manager@ems.ng    | Branch manager    | Egbeda                                |
| accountant@ems.ng | Accountant        | Egbeda                                |
| cashier@ems.ng    | Cashier           | Egbeda                                |
| officer@ems.ng    | Account officer   | Opens the field app                   |
| admin@ems.ng      | Administrator     | Headquarters, system setup            |
| newstaff@ems.ng   | Cashier           | Must change password on first sign-in |
| suspended@ems.ng  | Account officer   | Suspended; sign-in is refused         |

To try the field app on a phone, run `npm run dev -- --host` and open `http://<your-computer-ip>:5173/field` on the same Wi-Fi.

## Scripts

| Script              | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Browser demo with mocks and hot reload             |
| `npm run build`     | Type-check, then build the browser demo to `dist/` |
| `npm run preview`   | Serve the browser demo build                       |
| `npm run typecheck` | TypeScript only                                    |
| `npm run lint`      | ESLint                                             |
| `npm run format`    | Prettier                                           |
| `npm test`          | Vitest: unit tests and the mock API                |

## Backend and deployment

The app is a static site (Vercel) talking to SynchGate (`https://api.synchgate.com/v1/ems`).

| Setting (build time) | Live                               | Local                            |
| -------------------- | ---------------------------------- | -------------------------------- |
| `VITE_API_BASE_URL`  | `https://api.synchgate.com/v1/ems` | `http://localhost:8000/v1/ems`   |
| `VITE_USE_MOCKS`     | `false`                            | `false` (or `true` for the demo) |

- Vite fixes these when it builds, so after changing them, rebuild and redeploy. Use `https://` for the API: a page served over HTTPS can't call an `http://` address.
- Locally, use `localhost` (not `127.0.0.1`) for both the app and SynchGate, so the sign-in cookie is sent between ports 5173 and 8000.
- SynchGate's own settings for EMS (cookie, frontend address, SMS, trial and grace days) are listed in `gateway/ems/README.md` there.
- With mocks off, the app's service worker caches the app for offline use. After a deploy, people see an "update available" prompt; to force it in a browser, unregister the worker under DevTools → Application → Service workers.

Sign-up is at `/signup`. A new business gets a free trial and its owner becomes the managing director. Plans set how many branches and staff a business may have, and **Administration → Subscription** is where it pays (Paystack). When the paid time ends, EMS keeps working for a few grace days, then only the subscription page answers until someone renews.

The earlier EMS server (desktop app, office network, licence codes, multi-business hub) has been retired; it is in the git history before this change.

## Folder structure

```
src/
  api/            Typed API client, one module per resource
    client.ts     fetch wrapper: JWT, refresh, snake↔camel, DRF error mapping
    decode.ts     decimal strings → integer kobo
    forms.ts      puts DRF field errors onto React Hook Form fields
  components/     Shared UI: ui/, form/, data/ (DataTable), states/
  features/       One folder per feature (auth, dashboard, field, organisation, …)
  hooks/          Small shared hooks
  layouts/        BackOfficeShell, FieldShell, navigation config
  lib/            money, dates, phone, BVN, permissions, query client
  mocks/          MSW handlers, in-memory db, deterministic seed generator
  routes/         Router and guards (auth, role, permission)
  types/          Types for every API entity
```

## Conventions

- **Money** is integer kobo (`Kobo`, a branded number) inside the app, and DRF decimal strings (`"1250000.00"`) on the wire. `api/decode.ts` converts incoming amounts, and `lib/money.ts` formats them as `₦1,250,000.00`. Floats are never used for amounts.
- **Dates** display in Africa/Lagos as `25 Sep 2026` (`lib/dates.ts`).
- **API shape** follows DRF: snake_case JSON, `{ count, next, previous, results }` pages, and `{ "field": ["message"] }` errors. The client converts keys to camelCase.
- **Permissions**: the server returns `permissions` on the user. The UI uses `<Can>` / `useCan()` to hide what a role can't do, and `RequirePermission` guards routes. `lib/permissions.ts` holds the default role map, which the mocks also use.
- **Design tokens** live in `src/index.css`. Tailwind's default palette and type scale are cleared, so only these tokens can be used. In dev or mock mode, see them in the running app under **Design system** (`/ui-kit`).

## Authentication

1. `POST /auth/login/` checks the email and password, then emails a 6-digit code (the demo uses 123456). Someone who works for more than one business is asked which one (`choose_business`).
2. `POST /auth/otp/verify/` returns an access token and the user, and sets the refresh token as a cookie.
3. The access token is kept in memory only. On a 401, the client calls `POST /auth/token/refresh/` once (using the cookie) and retries. If the refresh also fails, the session ends.
4. Users with `must_change_password` can't leave `/change-password` until they choose a new password.
5. The back office signs staff out after 15 minutes idle, with a one-minute warning. This is synced across tabs.
6. The field app asks for a 6-digit PIN on first use, on reopening, and after 5 minutes idle. The PIN is stored on the phone only, as a salted PBKDF2 hash. Five wrong attempts erase it and require a full sign-in. If the app opens with no network, the officer's cached profile plus the PIN let them in, and the app reconnects when the network returns.

### What the backend needs to provide

- Refresh token in an **`HttpOnly` cookie** scoped to `/v1/ems/`, `Secure` and `SameSite=None` when the app and API are on different sites. CORS with credentials for the app's address.
- The endpoints under `/auth/` listed in `src/api/auth.ts`, with `permissions` on the user payload.
- Money fields as `DecimalField` (serialised as strings), and timestamps in ISO 8601 with offset.

## Mocks and the real API

With mocks off, the mock code is not included in the bundle, and the app's own service worker (offline caching and update prompts) is registered. The mocks stay for the demo mode and the tests; SynchGate ports their rules, so a rule change goes in both places.

MSW's worker and the PWA service worker cannot share a scope, so in mock mode the PWA worker is not registered. Installability and offline caching are therefore only testable with mocks off.

## Mock data

`src/mocks/seed/generate.ts` builds the same data on every load (fixed seed), relative to today's date:

- Headquarters (code 00) plus 5 branches, and 41 staff: every role, with 4–5 officers per branch
- 400 customers with Yoruba, Igbo, Hausa and other names, valid-format phones and BVNs, and next of kin
- Savings, thrift and loan accounts with 10-digit numbers (branch + product + serial)
- 60 days of transactions: field collections with GPS and cash/transfer, commissions, payouts, disbursements
- Loans in good standing, in arrears (with penalties) and fully repaid, with guarantors
- Remittances confirmed for the last week (a few with shortfalls), and about half of today's submitted
- Pending approvals: field registrations, reversals and closures, plus some decided history

Changes you make (new customers, collections, approvals, remittance sign-offs) are saved in the browser's IndexedDB. They survive a reload and are shared between tabs, so you can sign in as the officer in one tab and the accountant in another. A new day starts from fresh seed data. To start over, use **Reset demo data** on the Design system page.

## Headquarters

Headquarters is a special branch (`kind: "headquarters"`, code `00`) that oversees every branch.

- The MD, general manager and administrators always sit at headquarters. Every other role must belong to an operational branch.
- Headquarters has no collection areas and no customers, and it can't be closed. Its manager is the general manager.
- The general manager has every operational permission across all branches (branch switcher, customers, accounts, loans, remittance, approvals, reports, audit log). They can also add staff and choose their permissions. By default they don't have settings or branch management, which stay with the MD and administrators, and they don't collect in the field.
- Dashboards, reports and branch pickers only list operational branches.

## Field app offline behaviour

- Every collection is written to IndexedDB on the phone **before** it is sent. Each one carries a client-generated idempotency key, so a retry after a dropped response never creates a second transaction.
- The outbox syncs when the app opens, when the phone comes back online, every 30 seconds while anything is waiting, and when the officer taps the status pill in the header.
- Network and server errors leave a collection **pending**. A rejection from the office (for example, a frozen account) marks it **failed** with the reason. Failed collections appear under End of day, where the officer can retry or remove them after handing the cash to the accountant.
- Today's list and the officer's whole portfolio (customers, accounts, loans) are downloaded as soon as the app opens and kept on the phone, so every screen works if the signal drops.
- End of day will not submit the remittance until every collection on the phone has synced.

To try it in Chrome DevTools, open the field app, let Today load, then set **Network → Offline**. MSW answers from inside the browser, so also tick **Application → Service workers → Offline**, or use a real phone with mobile data off.

## Loans

Loan arithmetic lives in `src/lib/loans.ts` and is shared by the application form (live quote) and the mock server. The backend must produce the same figures.

- **Interest.** A month is 26 working days, or 52/12 weeks. _Flat_: principal × monthly rate × months, spread evenly. _Reducing balance_: equal installments, with interest charged on the balance still owed.
- **Due dates.** Daily loans fall due on each working day. Weekly and monthly installments that land on a closed day move to the next working day. Working days and holidays come from Settings.
- **Processing fee.** A percentage of the principal, taken from the amount paid out.
- **Top-up.** A new loan whose payout first settles what is left on the old one. The customer receives principal − fee − old balance.
- **Arrears.** Payments go to installments in order. Arrears are unpaid installments that fell due before today.
- **Penalty.** The product's percentage of arrears for each day late after the grace days, capped at a percentage of arrears. It builds up as "penalty not yet charged" until a manager charges it, which adds it to the balance.
- **Extension.** Spreads what is left over more installments, with no extra interest. It needs approval.
- **Workflow.** Application → approval by someone other than the applicant → payout by the cashier, which fixes the schedule from the payout date → repayments.
- **Borrowing rules.** One loan per customer at a time; use a top-up to borrow more. BVN and next of kin are required, and a guarantor when the product needs one.

## Dashboards and reports

- Dashboards are role-specific. The MD and managers see collections against expected, cash, disbursements, PAR 1/7/30, top and bottom officers, and approvals. The accountant sees remittance and income. The cashier sees counter activity and loans ready to pay out. The admin sees staff and recent activity.
- **PAR n** is the outstanding balance of loans at least _n_ days late, as a percentage of the whole active portfolio.
- All 12 reports come from one endpoint (`GET /reports/{key}/`) that returns typed columns, rows and totals. The report page renders any of them and exports CSV (plain decimals), Excel (numeric cells), PDF (landscape when wide) or a print layout.
- **Income** counts interest as repayments arrive, in proportion to each loan's interest share. It also includes processing fees, charged penalties and thrift commissions.

## Administration

- **Settings:** business details, SMS sender ID, working days and holidays, the large-withdrawal limit, **transaction charges**, the reversal window, the field sync age limit, SMS templates (with a placeholder check and SMS part count) and **what each role allows** (MD only). The MD always keeps every permission, and administrators can't lose access to settings and staff.
- **Transfers** (Transactions → Transfer, or Transfer on an account page):
  - Money goes from a savings, target savings or thrift account to another of the same customer's accounts, or to another customer's account in any branch by account number.
  - The receiving customer's name is shown before sending.
  - Paid into a loan, it counts as a repayment.
  - Both sides share a transfer id. Reversing either side reverses both, and neither side's amount can be edited alone.
  - Transfers at or above the large-withdrawal limit wait for approval.
  - The same rules as withdrawals apply: enough balance, target locks and thrift cycles.
  - There's no transfer charge.
- **Thrift withdrawals:** thrift accounts can be withdrawn from at the counter.
  - Before the cycle ends (the contributions since the last payout are fewer than the plan's cycle length), only plans with "Allow early withdrawal" permit it.
  - After the cycle is complete, withdrawing the whole balance is recorded as the thrift payout (with the payout SMS) and starts the next cycle.
- **Editing transactions:** the MD, general managers and branch managers can correct a posted transaction. Branch managers can only correct their own branch's transactions. The permission (`transactions.edit`) can't be given to any other role.
  - Any type can have its date and time, payment method and note changed.
  - These types can also have their amount changed: deposits, withdrawals, withdrawal charges, thrift contributions, commissions and payouts, loan repayments and penalties. Loan payouts and processing fees follow the loan's terms, and reversals mirror the original entry.
  - A reason is required.
  - The account balance, loan figures and every later "balance after" are recalculated.
  - A change that would leave an account short, or overpay a loan, is refused, as is a date in the future or before the account was opened.
  - Reversed transactions, and ones waiting for a reversal decision, can't be edited.
  - Each change is kept on the transaction (shown as "Edited", with the history) and in the audit log.
  - Editing a withdrawal doesn't change its withdrawal charge; edit the charge separately.
- **Transaction charges:** a withdrawal charge for savings and for target savings, each set separately.
  - Options are no charge, a percentage of the amount (with an optional most-per-withdrawal cap), or a flat fee.
  - The charge is posted as its own "Withdrawal charge" entry right after the withdrawal, so statements show both.
  - The balance must cover the withdrawal plus its charge. The cashier sees the charge before posting.
  - Large withdrawals are charged when they are approved.
  - Reversing a withdrawal refunds its charge.
  - Charges count as income on the accountant's dashboard and in the income report.
  - `src/lib/charges.ts` holds the calculation, used by both the server and the screens.
- **Permissions:** two layers. Settings says which permissions each role _can_ have. When the MD or general manager adds someone, they tick some or all of that role's permissions for that person (grouped by area, all ticked to start). The server enforces the person's permissions limited to what the role allows.
  - Nobody can give a permission they don't hold, or change a permission they don't hold on someone else. So the GM can't hand out settings access.
  - Nobody can change their own permissions. Only the MD can add, edit or suspend a managing director.
  - Account officers always keep the field app.
  - Taking a permission away from a role removes it from everyone in that role. Adding one gives it to nobody until it is assigned on each person's staff page (**Edit permissions**). Changing someone's role asks for their permissions again.
  - Every change is in the audit log (`staff.permissions`). Administrators can edit details, suspend and reset passwords, but can't add staff or change permissions.
  - Backend: `Staff.permissions` is returned on staff records; `POST /staff/` and `PATCH /staff/{id}/` accept `permissions` and need `staff.permissions`.
- **Staff:** new staff get a readable temporary password, shown once, and must change it at first sign-in. Suspend, reactivate, deactivate (only once an officer has no customers) and reset password. Officers' customers can be moved in bulk.
- **Audit log:** every sign-in and change is recorded with who, when, IP address and device. It is read-only and exportable.

## API endpoints the backend must provide

All under `VITE_API_BASE_URL`. The JSON is snake_case, money is decimal strings, lists are DRF-paginated, and errors use DRF's shape.

| Area         | Endpoints                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth         | `POST auth/login/`, `auth/otp/verify/`, `auth/otp/resend/`, `auth/token/refresh/` (cookie), `auth/logout/`, `auth/password/change/`, `auth/password/reset/`, `auth/password/reset/confirm/`; `GET auth/me/`                           |
| Organisation | `GET/POST branches/`, `PATCH branches/{id}/`; `GET/POST staff/`, `GET/PATCH staff/{id}/`, `POST staff/{id}/suspend\|reactivate\|deactivate\|reset-password/`; `GET officers/`                                                         |
| Customers    | `GET/POST customers/`, `GET/PATCH customers/{id}/`, `POST customers/{id}/photo/`, `…/signature/`, `…/reassign/`, `POST customers/reassign/` (bulk)                                                                                    |
| Accounts     | `GET/POST accounts/`, `GET accounts/{id}/`, `POST accounts/{id}/freeze\|unfreeze\|reactivate\|closure-request/`                                                                                                                       |
| Products     | `GET/POST thrift-plans/`, `PATCH thrift-plans/{id}/`; `GET/POST loan-products/`, `PATCH loan-products/{id}/`                                                                                                                          |
| Loans        | `GET/POST loans/`, `GET loans/{id}/` (with schedule), `POST loans/{id}/disburse\|extension-request\|charge-penalty/`                                                                                                                  |
| Field        | `GET field/today/`, `field/portfolio/`, `field/day-summary/`, `field/performance/`; `POST collections/` (idempotent on `idempotency_key`)                                                                                             |
| Operations   | `GET/POST transactions/`, `GET transactions/{id}/`, `POST transactions/{id}/reversal-request/`; `GET/POST remittances/`, `POST remittances/confirm/`; `GET approvals/`, `GET approvals/{id}/`, `POST approvals/{id}/approve\|reject/` |
| Insights     | `GET dashboard/`, `GET reports/{key}/`                                                                                                                                                                                                |
| Admin        | `GET/PATCH settings/`, `GET audit/`                                                                                                                                                                                                   |

**Keys that are data, not field names.** `settings.role_permissions` is keyed by role, and `dashboard.approvals.by_type` is keyed by approval type. The client camelCases every key, then restores these ones. If the backend adds its own case conversion (e.g. djangorestframework-camel-case), exclude those maps.

## Build phases

All seven phases are built:

1. **Foundation:** setup, design system, shells, auth, role routing, API client and mocks
2. **Customers and accounts:** customer list, profile, create/edit with KYC photo and signature, guarantors, officer reassignment; accounts list and statement; open, freeze, reactivate, request closure; thrift plans
3. **Field app:** Today list by area, collection flow with GPS and duplicate warning, offline outbox with sync, customer lookup, new thrift customer registration, end of day and remittance submission, my performance
4. **Remittance, transactions, approvals:** evening cash count with variance and sign-off, transaction search and export, counter postings, reversal requests, a single maker-checker queue
5. **Loans:** products, application with live quote, approval, payout, schedule, arrears, penalties, top-up, extension, expiry and arrears views
6. **Dashboards and reports:** role dashboards with charts and PAR, 12 reports with CSV/Excel/PDF export and print
7. **Admin:** branches, staff and permissions, bulk reassignment, audit log, settings and SMS templates
