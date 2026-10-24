# Hosting EMS for several clients

EMS is offered as a hosted service: Entacrest runs EMS online, and each client
opens it at its own web address with nothing to install. All clients share one
server, but each has:

- its own **EMS container**, so one client's activity, crash or restart never
  reaches another;
- its own **PostgreSQL database and login**, so no client can read another's data;
- its own **licence**, which sets their plan, branch limit and paid-up date;
- its own **web address**, e.g. `ayo.ems.entacrest.ng` or the client's own domain.

```
Internet ──► nginx (HTTPS, one site per client)
               ├── ayo.ems.example.ng    ──► ems-ayo     (127.0.0.1:8100) ─┐
               ├── ifeoluwa.ems.example.ng ─► ems-ifeoluwa (127.0.0.1:8101) ─┼─► ems-db (PostgreSQL)
               └── …                                                        ┘   one database per client
```

Everything is done with one script, `deploy/saas/emsctl`.

> **Not yet tested on a server.** The script was written and syntax-checked but has
> not been run end to end. Try it on a test domain before the first client.

## Billing with licences

A licence is how a client's subscription is controlled. Issue hosted licences
**without `--machine`** (containers have no fixed machine code) and with an end date:

```bash
npm run licence -- issue --licensee "Ayo Thrift Society" --months 1 --branches 3 --plan standard
```

- **Renewal:** issue a new code when they pay and save it with
  `emsctl licence ayo <code>`. It takes effect at once, without a restart.
- **Non-payment:** when the end date passes, EMS stops working for that client and
  asks for a new licence. Their data is kept. `emsctl stop ayo` suspends a client
  straight away; `emsctl start ayo` brings them back.
- Monthly codes keep payment and access in step. Longer codes need less work.

## The server

Ubuntu 22.04 or 24.04 with Docker, nginx and certbot. This can be the same
server as another product (for example the iGospel API on Lightsail). EMS adds
its own nginx sites and containers and doesn't touch the others.

Memory: each client container is capped at 512 MB (`EMS_CLIENT_MEMORY`) and the
shared database at 512 MB. EMS keeps a client's data in memory, so a small
business uses far less than the cap. Check real use with `docker stats` and
leave room for anything else on the server. On a 2 GB server that already runs
another product, upgrade to 4 GB before adding clients.

## First-time setup

```bash
# as a user who can run docker and sudo
sudo mkdir -p /srv/ems && sudo chown "$USER" /srv/ems
git clone <ems-repo-url> /srv/ems/app
cd /srv/ems/app
chmod +x deploy/saas/emsctl
sudo ln -s /srv/ems/app/deploy/saas/emsctl /usr/local/bin/emsctl

emsctl setup        # creates /srv/ems/db.env, starts ems-db, builds the EMS image
```

**DNS:** a wildcard record `*.ems.example.ng` pointing at the server's static IP
means new clients need no DNS change. A client using their own domain points an
`A` record at the same IP.

## Adding a client

```bash
npm run licence -- issue --licensee "Ayo Thrift Society" --months 1 --branches 3   # on your computer
emsctl add ayo ayo.ems.example.ng                                                  # on the server
sudo certbot --nginx -d ayo.ems.example.ng --redirect
```

Send the client's MD the address and the licence code. They open the address,
enter the code (Activate), enter the business details and create their own
account (Set up), then add staff.

Nobody can set up an address without the licence code, so a new address is safe
until the client gets to it. You can pass the code to `emsctl add` instead, but
then whoever opens the address first can set it up: only do that if you will
complete set-up yourself straight away.

**SMS:** until the client has an SMS sender, sign-in codes go to the outbox at
the address `emsctl add` prints. To send real texts, edit
`/srv/ems/clients/ayo/env` (set `EMS_SMS_PROVIDER=termii` and the client's
Termii key and sender ID), then run `emsctl restart ayo`.

## Day to day

| Task | Command |
| --- | --- |
| See every client, its state and licence | `emsctl list` |
| Renew a licence | `emsctl licence ayo <code>` |
| Suspend / resume | `emsctl stop ayo` / `emsctl start ayo` |
| Read a client's log | `emsctl logs ayo` |
| Release a new version to everyone | `git pull && emsctl update` |
| Undo the last update | `emsctl rollback` |
| Back up every client now | `emsctl backup` |
| Take a client offline (data kept) | `emsctl remove ayo` |

**Updates** rebuild the image from the checkout and restart clients one at a
time. Each client is unavailable for a few seconds while its container
restarts, so update outside working hours. Suspended clients stay suspended.

## Backups

Each client's database is dumped separately to `/srv/ems/backups/<client>/`, and
dumps older than 14 days are deleted (`EMS_BACKUP_DAYS`). Add a nightly cron job,
copying off the server to S3:

```bash
crontab -e
30 2 * * * BACKUP_S3_URI=s3://my-backups/ems/ /usr/local/bin/emsctl backup >> /srv/ems/backups/backup.log 2>&1
```

Restore one client (this replaces their current data):

```bash
emsctl stop ayo
docker exec -i ems-db pg_restore -U postgres --no-owner --role=ems_ayo --clean --if-exists \
  -d ems_ayo < /srv/ems/backups/ayo/ayo-<stamp>.dump
emsctl start ayo
```

## Desktop apps for hosted clients

Staff who prefer the installed Windows app use **File → Connection settings… →
On my organisation's EMS server** with the client's address. They then work on
the same data as the browser, with no licence needed on that computer. Never
point a desktop app straight at a client's database: EMS allows one server per
database.

## Where things are

| Path | What |
| --- | --- |
| `/srv/ems/app` | this repository |
| `/srv/ems/db.env` | the database superuser password |
| `/srv/ems/clients/<client>/env` | the client's settings and secrets (database login, SMS keys) |
| `/srv/ems/clients/<client>/licence/licence.txt` | the client's licence code |
| `/srv/ems/backups/<client>/` | database dumps |
| `/srv/ems/removed/` | settings of removed clients |
| `/etc/nginx/sites-available/ems-<client>` | the client's nginx site |
