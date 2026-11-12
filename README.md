# Alert System

## Local development

The application defaults to JSON-file storage for local testing, using the
existing files in `data/`. No database installation or connection is needed
for local development. To run locally:

```bash
npm start
```

## PostgreSQL deployment

Application data is stored in the PostgreSQL table `app_documents`. The table
contains JSON documents for alerts, users, email templates, and signup domain
rules. JSON files in `data/` are retained as the one-time import source; the
deployed application reads and writes PostgreSQL when `STORAGE_PROVIDER=sql`
is set.

Configure these environment variables for both migration and application
startup. Put them in the project-root `.env` file (the same folder as
`server.js`) or in your host's protected environment. Keep credentials
outside source control.

### Option A – connection string (recommended on managed Postgres)

| Variable | Required | Purpose |
| --- | --- | --- |
| `STORAGE_PROVIDER` | Yes for SQL deployment | Set to `sql`; omit it or set `json` for local file storage |
| `DATABASE_URL` | Yes (if not using Option B) | Full Postgres connection URI, e.g. `postgresql://user:pass@host:5432/dbname` |
| `PG_SSL` | No | Set to `false` to disable SSL. When unset and `DATABASE_URL` is used, SSL is enabled |
| `PG_SSL_REJECT_UNAUTHORIZED` | No | Set to `false` only when the server certificate cannot be validated |
| `PG_POOL_MAX` | No | Connection pool size; defaults to 10 |

### Option B – individual variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `STORAGE_PROVIDER` | Yes for SQL deployment | Set to `sql` |
| `PG_HOST` | Yes | PostgreSQL host name |
| `PG_DATABASE` | Yes | Existing database name |
| `PG_USER` | Yes | Postgres role with permission to create/use `app_documents` |
| `PG_PASSWORD` | Yes | Role password |
| `PG_PORT` | No | TCP port; defaults to 5432 |
| `PG_SSL` | No | Set to `true` to enable TLS (default off when not using `DATABASE_URL`) |
| `PG_SSL_REJECT_UNAUTHORIZED` | No | Set to `false` only when the server certificate cannot be validated |
| `PG_POOL_MAX` | No | Connection pool size; defaults to 10 |

Create the target database and role first. From the application directory,
run the importer once before starting the app:

```bash
npm install
npm run migrate:sql
npm start
```

Before running those commands, make sure `.env` contains `STORAGE_PROVIDER=sql`
as well as the PostgreSQL connection variables. The migration script loads
`.env` automatically. The importer initializes the table and inserts each JSON
document only if its key is absent. Existing data is never overwritten by a
repeated import. Back up the database before making manual changes. The role
used at runtime needs read/write access to `app_documents`; schema creation is
also attempted on startup.

The application will stop at startup with a clear error if required documents
have not been imported, or if the database is unreachable.

The application keeps sessions in Express's in-memory session store; this
migration covers application records, not login sessions.

## PostgreSQL notes

- Edits take a row lock (`SELECT ... FOR UPDATE`), so two running copies of the app cannot overwrite each other's saves.
- The reminder scheduler takes a PostgreSQL advisory lock each cycle, so only one copy checks alerts at a time and reminders are not sent twice. Set `SCHEDULER_ENABLED=false` to keep it off a copy entirely.
- With `STORAGE_PROVIDER=sql`, sign-in sessions are stored in the `user_sessions` table (created automatically), so restarts do not sign people out.
- `SESSION_SECRET` is required when `NODE_ENV=production`. Behind HTTPS set `TRUST_PROXY=1` and `COOKIE_SECURE=true`.
- PostgreSQL tests: `TEST_DATABASE_URL=<empty test database> PG_SSL=false npm test`.
