# Hosting EMS for many businesses on one server

One EMS server, one database, many businesses. Each business opens EMS at its
own address and only ever sees its own data:

```
ayo.ems.example.ng ───┐
ife.ems.example.ng ───┼──► nginx ──► EMS (one Node.js process) ──► PostgreSQL
ems.ifecoop.ng ───────┘                picks the business            schema per business:
                                       from the address              biz_ayo, biz_ife, …
```

- **Separate data.** Every business has its own tables (a PostgreSQL schema),
  staff, passwords, sign-in keys, settings, licence and SMS outbox. A request is
  answered by the business its address belongs to and can't reach another's
  data. A sign-in or token from one business doesn't work at another.
- **Cheap to run.** A business is loaded into memory on its first request and
  unloaded after 30 idle minutes (`EMS_IDLE_MINUTES`), so the server only holds
  the businesses in use. A quiet business costs almost nothing.
- **Billing by licence.** Each business has its own licence code, with its end
  date and branch limit. When it runs out, that business locks until renewed.
  You can also suspend a business at once.
- **Web and desktop.** Staff use a browser, the officers' field app, or the
  Windows app connected to the business's address (**File → Connection
  settings… → On my organisation's EMS server**).

Docker isn't needed: EMS runs as one Node.js program under systemd. (The
`Dockerfile` also works; pass the same settings.)

## What you need

- A Linux server (Ubuntu 24.04), for example the iGospel Lightsail instance. EMS
  holds only the businesses in use, so 300–500 MB is plenty for dozens of small
  businesses. Check with `systemctl status ems` (memory) after a while.
- **Node.js 24**: `curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt install -y nodejs`
- **PostgreSQL**: a database on the same server, or a managed one. Each loaded
  business keeps one connection open, so allow at least _businesses in use + 5_
  connections. Supabase's free pooler allows few; a database on the server
  (default 100 connections) is better.
- A domain for EMS, e.g. `ems.example.ng`, with a **wildcard DNS record**
  `*.ems.example.ng` (and `ems.example.ng`) pointing at the server.

## First-time setup

```bash
# A user for EMS, and its folders
sudo useradd --system --home /srv/ems --shell /usr/sbin/nologin ems
sudo mkdir -p /srv/ems/data /etc/ems
sudo git clone <ems-repo-url> /srv/ems/app
cd /srv/ems/app && sudo npm ci && sudo npm run web:build
sudo chown -R ems:ems /srv/ems

# A database and login for EMS (PostgreSQL on this server)
sudo -u postgres psql -c "CREATE ROLE ems LOGIN PASSWORD '<a long password>'"
sudo -u postgres psql -c "CREATE DATABASE ems OWNER ems"
```

Settings go in `/etc/ems/env` (`sudo chmod 640 /etc/ems/env && sudo chown root:ems /etc/ems/env`):

```bash
EMS_MULTI_BUSINESS=true
EMS_BASE_DOMAIN=ems.example.ng
# Opens the operator API at /__platform/. Make it long and random: openssl rand -hex 32
EMS_PLATFORM_KEY=<long random secret>
DATABASE_URL=postgresql://ems:<password>@localhost:5432/ems
PORT=8080
EMS_HOST=127.0.0.1
EMS_TRUST_PROXY=true
EMS_WEB_ROOT=/srv/ems/app/dist-web
EMS_DATA_DIR=/srv/ems/data
# Text messages: outbox (nothing sent), termii or africastalking
EMS_SMS_PROVIDER=outbox
# Read a business's sign-in codes at https://<its address>/__sms?key=<this>, until SMS is connected
EMS_OUTBOX_KEY=<another random secret>
```

Then start EMS and the website:

```bash
sudo cp deploy/hosted/ems.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ems

sudo cp deploy/hosted/nginx-ems.conf /etc/nginx/sites-available/ems
sudo sed -i 's/ems.example.ng/<your EMS domain>/g' /etc/nginx/sites-available/ems
sudo ln -s /etc/nginx/sites-available/ems /etc/nginx/sites-enabled/
```

**HTTPS for every business at once** needs a wildcard certificate, which
Let's Encrypt only issues through a DNS check:

```bash
sudo certbot certonly --manual --preferred-challenges dns \
  -d 'ems.example.ng' -d '*.ems.example.ng'
sudo nginx -t && sudo systemctl reload nginx
```

Certbot asks you to add a TXT record to the DNS, then issues the certificate.
Manual DNS certificates don't renew on their own: renew before the 90 days
are up, or use your DNS provider's certbot plugin (e.g. Cloudflare's) for
automatic renewal.

## Adding and managing businesses

Run these on your own computer, from the EMS folder, pointing at the server:

```bash
export EMS_PLATFORM_URL=https://ems.example.ng
export EMS_PLATFORM_KEY=<the server's EMS_PLATFORM_KEY>

npm run licence -- issue --licensee "Ayo Thrift Society" --months 1 --branches 3   # no --machine
npm run platform -- add ayo "Ayo Thrift Society"
```

Send the business's MD their address (`https://ayo.ems.example.ng`) and the
licence code. They open it, enter the code (**Activate**), then the business
details and their own account (**Set up**). Nobody can set up a business
without its licence code, so a new address is safe until the client gets there.
To save the code yourself instead: `npm run platform -- licence ayo EMS-…`.

| Task                                   | Command                                                |
| -------------------------------------- | ------------------------------------------------------ |
| Every business, and which are in use   | `npm run platform -- list`                             |
| One business: address, set-up, licence | `npm run platform -- show ayo`                         |
| Renew a licence (takes effect at once) | `npm run platform -- licence ayo EMS-…`                |
| Suspend (e.g. unpaid), data kept       | `npm run platform -- suspend ayo`                      |
| Restore                                | `npm run platform -- resume ayo`                       |
| Rename                                 | `npm run platform -- rename ayo "Ayo Thrift & Credit"` |
| Use the business's own domain too      | `npm run platform -- domains ayo ems.ayothrift.ng`     |

A business's **own domain**: they point an `A` record at the server, you run
`npm run platform -- domains ayo ems.ayothrift.ng`, add the domain to the
`server_name` lines in the nginx site, and run `sudo certbot --nginx -d ems.ayothrift.ng`.

Business ids are lower-case letters, digits and dashes, and are part of the
address, so choose them carefully: they can't be changed later.

## Selling EMS online (SynchGate)

With SynchGate connected, businesses sign up and pay for themselves, and nobody
issues licence codes by hand:

```
ems.example.ng (sign-up page) ─► EMS hub ─► SynchGate /v1/ems/signup/
                                              │ creates the owner's account, the trial,
                                              │ and a signed licence
              EMS hub ◄── /__platform/ ───────┘ adds the business, already set up
ayo.ems.example.ng ─► Administration → Subscription ─► SynchGate ─► Paystack
                                  new licence after each payment ◄┘
```

- **Sign-up** is at the bare address (`https://ems.example.ng`). The visitor picks a
  plan, their address (`ayo`) and their own account. SynchGate starts the free
  trial and adds the business here with them as its managing director, so they
  go straight to sign-in: no licence code, no Set up screen.
- **Paying.** The MD (or anyone with settings access) opens **Administration →
  Subscription**, picks a plan and how many months, and pays with Paystack. EMS
  gets the new licence as soon as the payment is confirmed.
- **When it ends.** The licence runs to the end of the paid (or trial) time plus
  `EMS_GRACE_DAYS` (SynchGate, default 7). Managers see a warning 10 days before.
  Afterwards EMS locks, keeping the data, and the lock screen offers **Renew
  subscription** (a month of the same plan), so nobody needs to be signed in to pay.
- **Plans, prices and businesses** are managed in SynchGate's Django admin
  (**EMS (hosted)**). Saving a business there (extending its time, changing its
  plan, suspending it) updates the hub at once.

Add to `/etc/ems/env`:

```bash
# SynchGate's address, and the key it expects (SynchGate's EMS_SERVICE_KEY)
EMS_SAAS_URL=https://api.synchgate.com
EMS_SAAS_KEY=<long random secret, the same as SynchGate's EMS_SERVICE_KEY>
```

And to SynchGate's environment:

```bash
EMS_HUB_URL=https://ems.example.ng          # this server
EMS_PLATFORM_KEY=<this server's EMS_PLATFORM_KEY>
EMS_SERVICE_KEY=<the same secret as EMS_SAAS_KEY above>
EMS_BASE_DOMAIN=ems.example.ng
# The licence key from `npm run licence -- keygen`: PEM text, or a file path
EMS_LICENCE_PRIVATE_KEY=/etc/synchgate/ems-licence-private-key.pem
EMS_TRIAL_DAYS=14
EMS_GRACE_DAYS=7
```

Then on SynchGate run `python manage.py migrate` (it adds the starting plans; set
the real prices in the admin before taking payments). Paystack's webhook is the
one SynchGate already has, so nothing changes in Paystack.

The `npm run platform` commands below still work for businesses you set up by
hand. For businesses that came through SynchGate, make changes in SynchGate:
a licence saved here by hand is replaced the next time SynchGate updates the
business. After changing the licence key or a plan's branch limit, run
`python manage.py ems_sync` on SynchGate to send every business a new licence.

## Updates

```bash
cd /srv/ems/app
sudo -u ems git pull
sudo -u ems npm ci && sudo -u ems npm run web:build
sudo systemctl restart ems
```

Every business is briefly unavailable (a few seconds) while EMS restarts, so
update outside working hours.

## Backups

All businesses are in one database, so one nightly dump covers them:

```bash
sudo -u postgres crontab -e
# 02:30 every night; keep 14 days
30 2 * * * pg_dump -Fc ems > /var/backups/ems-$(date +\%F).dump && find /var/backups -name 'ems-*.dump' -mtime +14 -delete
```

Copy the dumps off the server too (e.g. `aws s3 sync /var/backups s3://…`).

Restore **one** business, leaving the others alone (stop EMS first):

```bash
sudo systemctl stop ems
sudo -u postgres pg_restore -d ems -n biz_ayo --clean --if-exists --no-owner --role=ems \
  /var/backups/ems-<date>.dump
sudo systemctl start ems
```

## Without PostgreSQL

Leave out `DATABASE_URL` and EMS keeps each business in its own SQLite file
(`/srv/ems/data/businesses/<id>.sqlite`) and the list of businesses in
`/srv/ems/data/platform.sqlite`. Fine for a handful of businesses. Back up
by copying the folder while EMS is stopped.

## Trying it on your own computer

```bash
npm run web:build
EMS_MULTI_BUSINESS=true EMS_PLATFORM_KEY=test-key-0123456789abcdef1234 node build/server/main.cjs
# another terminal
EMS_PLATFORM_URL=http://localhost:8080 EMS_PLATFORM_KEY=test-key-0123456789abcdef1234 npm run platform -- add ayo "Ayo"
```

Then open `http://ayo.localhost:8080`: every `<id>.localhost` address works
without DNS.
