# EMS (Entacrest MFB Solution) — frontend

EMS is an Entacrest Nexus product for lending cooperatives and thrift businesses. This is its web frontend. The demo organisation has a headquarters that oversees five branches (Egbeda, Olugbede, Ikotun, Ipaja, Igando). One codebase serves two experiences:

- **Back office** (`/`) for the MD, general manager, branch managers, accountants, cashiers and admins. Desktop-first and responsive.
- **Field app** (`/field`) for account officers. A mobile-first PWA that can be installed on Android and opens offline behind a 6-digit PIN.

The Django REST Framework backend doesn't exist yet. Every request is served by [MSW](https://mswjs.io) mock handlers backed by seeded Nigerian data, so every screen works now.

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

| Script                    | What it does                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`             | Browser demo with mocks and hot reload                                               |
| `npm run build`           | Type-check, then build the browser demo to `dist/`                                   |
| `npm run preview`         | Serve the browser demo build                                                         |
| `npm run typecheck`       | TypeScript only                                                                      |
| `npm run lint`            | ESLint                                                                               |
| `npm run format`          | Prettier                                                                             |
| `npm test`                | Vitest: unit tests, the mock API, and the EMS server on SQLite and PostgreSQL        |
| `npm run web:build`       | Build a web deployment: the app to `dist-web/` and the EMS server to `build/server/` |
| `npm run web:start`       | Run the EMS server for a web deployment (see "Deploying EMS")                        |
| `npm run desktop`         | Build the desktop app and open it in Electron                                        |
| `npm run desktop:package` | Build the Windows installer, `release/EMS-Setup-<version>.exe`                       |
| `npm run licence -- …`    | Entacrest licence tool: `keygen`, `issue`, `verify`                                  |

## Deploying EMS

One codebase gives three ways to deliver EMS to an organisation. Pick one, or combine them.

| Deployment              | Who uses it                                            | Where the data lives                           |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| **Web**                 | Every branch, head office and officers' phones, by URL | Supabase (PostgreSQL), or SQLite on the server |
| **Desktop, standalone** | One office on one computer                             | SQLite on that computer, or Supabase           |
| **Desktop, connected**  | Staff who prefer an installed app                      | The organisation's web deployment              |

"Both" for one organisation means a web deployment plus desktop installs set to **connected**, so everyone shares one set of data.

### The EMS server

Every deployment runs the **EMS server** (`src/server`). It answers the same `/api/v1` endpoints the Django backend will, using the business rules in `src/mocks/handlers`, and serves the web app from the same address.

- **Storage.** The app works on its data in memory. After every request the server writes what changed in one transaction, and replies only once the write is saved. There is one table per collection and one row per record, with the record as JSON (`jsonb` in PostgreSQL), so it can be queried in SQL.
- **One server per database.** In PostgreSQL the server holds an advisory lock, so a second server pointed at the same database refuses to start instead of overwriting the first one's work. More users means more people using the one server, not more servers.
- **Live behaviour.** `src/mocks/platform.ts` swaps the demo behaviour for live behaviour:

  | Area           | Browser demo              | EMS server                                                            |
  | -------------- | ------------------------- | --------------------------------------------------------------------- |
  | Passwords      | Plain text                | scrypt hashes                                                         |
  | Session tokens | Unsigned                  | HMAC-SHA256 signed; the cookie is `HttpOnly`, and `Secure` over HTTPS |
  | Sign-in codes  | Always `123456`           | Random 6-digit codes (`123456` in a demo workspace)                   |
  | Text messages  | Not sent                  | Kept in an SMS outbox; sent through Termii or Africa's Talking if set |
  | Data           | IndexedDB, reset each day | SQLite or PostgreSQL, kept                                            |

- **First run.** **Activate** (licence code) → **Set up** (business details and the MD's account) → **Sign in**. Live data always starts empty.

### Web deployment

```bash
npm run web:build
DATABASE_URL="postgresql://…" npm run web:start       # or with Docker: see Dockerfile
```

Put it behind HTTPS: Render, Railway and Fly provide HTTPS automatically, or use nginx or Caddy on a server. Settings, all environment variables:

| Variable               | Meaning                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | PostgreSQL / Supabase connection string. Without it, SQLite files are kept in `EMS_DATA_DIR`.                                                            |
| `EMS_DB_SCHEMA`        | Schema for the tables (default `ems`). Use another, e.g. `ems_demo`, to run a second server on one database.                                             |
| `DATABASE_CA_CERT`     | Supabase's CA certificate (PEM text or file path) to verify the database. Without it the connection is encrypted but unverified.                         |
| `EMS_DATA_DIR`         | Folder for SQLite (default `./data`). Mount a volume here.                                                                                               |
| `PORT`                 | Port (default 8080).                                                                                                                                     |
| `EMS_TRUST_PROXY=true` | Behind an HTTPS proxy: trust `X-Forwarded-Proto` for secure cookies and HSTS.                                                                            |
| `EMS_MODE=demo`        | A demo server: sample data, demo accounts, code `123456`. Give it its own schema or data folder.                                                         |
| `EMS_SMS_PROVIDER`     | `termii` (`TERMII_API_KEY`, `TERMII_SENDER_ID`), `africastalking` (`AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID`), or `outbox` (default: nothing is sent). |
| `EMS_OUTBOX_KEY`       | Opens the SMS outbox at `/__sms?key=…`. Off without it. Useful before SMS is connected.                                                                  |
| `EMS_WEB_ROOT`         | The built app (default `./dist-web`).                                                                                                                    |

- `GET /healthz` answers `ok`, for uptime checks.
- Web deployments get the field app's service worker, so officers can install it on Android and collect offline.
- Issue web licences **without** `--machine`: servers and containers don't keep a fixed machine code.

### Supabase

1. Create a project at supabase.com, in the region closest to your users.
2. Open **Connect** and copy the **Session pooler** connection string (port 5432). Put your database password in it. The session pooler is needed because the EMS server holds a lock for as long as it runs; the transaction pooler (port 6543) doesn't keep that lock.
3. Use it as `DATABASE_URL` for a web deployment, or in the desktop app under **File → Connection settings…**.
4. Optional: download the CA certificate (**Project Settings → Database → SSL**) and set `DATABASE_CA_CERT`.

- On first start EMS creates its tables in the `ems` schema. Supabase's Data API only publishes the `public` schema, and row-level security is switched on with no policies, so the tables can only be reached through the EMS server's database user.
- EMS doesn't use Supabase Auth. Staff sign in through EMS, with its own passwords, SMS codes and permissions.
- Backups: Supabase takes daily backups on paid plans, with point-in-time recovery as an add-on. The desktop app's **Back up live data…** also works with Supabase and writes a SQLite copy.

### Hosting on Render

`render.yaml` deploys the web server from this repository with Docker.

1. Sign up at render.com with your GitHub account. Choose **New → Blueprint**, pick the EMS repository, and confirm.
2. When it asks for `DATABASE_URL`, paste the Supabase **Session pooler** string. It is stored in Render, never in the repository.
3. The first build takes a few minutes. You then get an address like `https://ems-xxxx.onrender.com`. A custom domain such as `ems.yourcompany.ng` can be added under **Settings → Custom Domains**; Render provides HTTPS for it.
4. Open the address and enter the licence. If the database already holds a business (for example from a desktop that used Supabase), EMS goes straight to sign-in. Otherwise it walks you through set-up.
5. Until an SMS provider is connected, read sign-in codes at `https://<address>/__sms?key=<EMS_OUTBOX_KEY>`. The key is under **Environment** in Render.

- **Only one EMS server per database.** A desktop that uses the same Supabase database directly must be switched to **On my organisation's EMS server** (the Render address). Close EMS on that desktop before the first deploy; the web server waits until the database is free.
- **Updates.** `EMS_WAIT_FOR_LOCK` lets Render start a new version while the old one still holds the database. The new version answers health checks, waits its turn, then takes over. Requests in those few seconds get "EMS is starting".
- **Other hosts** (Railway, Fly.io, a VPS) work the same way with the `Dockerfile` and the variables above.

### Desktop app (Windows)

- Built with `.env.desktop`.
- `electron/main.cjs` runs **two workspaces side by side**, each its own EMS server process on its own local address, with separate data, sign-in cookies and field-app storage:
  - **Live:** `127.0.0.1:47821`. This computer's SQLite file (`%APPDATA%\EMS\data\ems.sqlite`), a Supabase database, or the organisation's web deployment. Choose under **File → Connection settings…**. Moving from this computer to Supabase can copy the existing data across.
  - **Demo:** `127.0.0.1:47822`, `demo.sqlite`. Sample data with the demo accounts (password `Demo@2026`, code `123456`) and a "Demo workspace" banner. It is set up automatically the first time it opens. **File → Demo workspace → Reset demo data** starts it again; live data is never touched.
- The licence is shared by both workspaces (`data\licence.key`).
- **Menus:**
  - **File → Back office / Field app / SMS outbox** (Ctrl+1/2/3), and the same for the demo (Ctrl+Shift+1/2/3).
  - **File → Back up live data…**
  - **File → Connection settings…**
  - **Help → Licence details**
  - **Help → Erase EMS on this computer…**: removes the local data, licence and settings, but not the data in Supabase or on a server.
- The database password is encrypted with Windows data protection.
- To test beside an installed copy, set `EMS_USER_DATA` to another folder.
- **Not live-ready yet:**
  - There are no password-reset emails; managers reset passwords from the staff page.
  - The installer isn't code-signed, so SmartScreen warns on first run (**More info → Run anyway**).

#### Several computers in one office

Every install starts as its own, separate EMS. To let other computers work on the same business, one computer serves the others:

1. On the computer that holds the data, choose **File → Share on office network**. It shows the address to use, e.g. `http://192.168.1.23:47821`. When Windows asks, allow EMS on private networks.
2. On each other computer:
   - install EMS;
   - on the licence screen, choose **Connect to your organisation** (or **File → Connection settings…**);
   - choose **On my organisation's EMS server** and enter that address.

   Staff computers need no licence. EMS restarts once, then staff sign in as themselves.

- The sharing computer must be on with EMS open while others use it.
- Its address can change when it reconnects to the network, so reserve it in the router.
- Only that computer can open the SMS outbox, because it shows sign-in codes.
- Office sharing works inside one network only. For other branches and officers' phones, host EMS online (see "Hosting on Render") and point every computer at that address instead.

### Licences

Licence codes are signed by Entacrest with an Ed25519 private key. The app contains only the public key (`src/server/licence-public-key.pem`), so it can check a code offline but nobody can forge one.

- A code carries:
  - the licence number;
  - the licensee;
  - the plan;
  - the most branches allowed (enforced when adding a branch);
  - the expiry date (the app locks again after it, keeping the data);
  - optionally, a machine code, so it works on one computer only. The activation screen shows each computer's code.
- It looks like `EMS-<details>.<signature>`. Spaces and line breaks are ignored, so it can be pasted from an email.

```bash
npm run licence -- keygen                     # once: makes the key pair
npm run licence -- issue --licensee "Ayo Thrift Society" --months 12 --branches 5
npm run licence -- issue --licensee "..." --machine 7812-AA37-64FD-BE1E   # this computer only
npm run licence -- verify EMS-...
```

- The **private key** is kept at `~/.entacrest/ems-licence/private-key.pem`, outside the repo. Change the folder with `EMS_LICENCE_DIR`.
- **Never commit the private key. Back it up.** Without it you can't issue codes that installed copies accept. Making a new key pair invalidates every licence already issued.
- Every issued licence is logged in `issued.csv` beside the key.
- After `keygen`, rebuild the app so it trusts the new public key.
- Desktop licences can be tied to one computer with `--machine`. Web licences shouldn't be: containers don't keep a fixed machine code.

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

1. `POST /auth/login/` checks the email and password, then sends an OTP by SMS.
2. `POST /auth/otp/verify/` returns an access token and the user, and sets the refresh token as a cookie.
3. The access token is kept in memory only. On a 401, the client calls `POST /auth/token/refresh/` once (using the cookie) and retries. If the refresh also fails, the session ends.
4. Users with `must_change_password` can't leave `/change-password` until they choose a new password.
5. The back office signs staff out after 15 minutes idle, with a one-minute warning. This is synced across tabs.
6. The field app asks for a 6-digit PIN on first use, on reopening, and after 5 minutes idle. The PIN is stored on the phone only, as a salted PBKDF2 hash. Five wrong attempts erase it and require a full sign-in. If the app opens with no network, the officer's cached profile plus the PIN let them in, and the app reconnects when the network returns.

### What the backend needs to provide

- Refresh token in an **`HttpOnly; Secure; SameSite=Strict` cookie** (simplejwt with a cookie-based refresh view). Include CORS with credentials if the API is on another origin.
- The endpoints under `/auth/` listed in `src/api/auth.ts`, with `permissions` on the user payload.
- Money fields as `DecimalField` (serialised as strings), and timestamps in ISO 8601 with offset.

## Switching from mocks to the real API

1. In `.env`, set `VITE_USE_MOCKS=false` and `VITE_API_BASE_URL` to the API root, e.g. `https://api.example.com/api/v1`.
2. Rebuild. With mocks off, the mock code is not included in the bundle, and the app's own service worker (offline caching and update prompts) is registered.
3. After the backend is fully live, delete `src/mocks/`, `public/mockServiceWorker.js` and the `msw` entry in `package.json`. Also remove the demo-accounts panel import in `features/auth/LoginPage.tsx`, and change `src/test/setup.ts` to use per-test handlers.

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

- **Settings:** business details, SMS sender ID, working days and holidays, the large-withdrawal limit, the reversal window, the field sync age limit, SMS templates (with a placeholder check and SMS part count) and **what each role allows** (MD only). The MD always keeps every permission, and administrators can't lose access to settings and staff.
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
