---
name: database-cli
description: Use pre-installed database client CLIs from the sandbox: mongosh for MongoDB, psql/pg_dump/pg_restore for PostgreSQL, and mysql/mysqldump for MySQL or MariaDB. Emphasizes safe read-only inspection, secret handling, and confirmation before destructive queries or restore operations.
---

# Database CLI

Use this skill when the user asks to inspect or operate a MongoDB, PostgreSQL,
MySQL, or MariaDB database from the sandbox.

The sandbox runtime image pre-installs:

- MongoDB: `mongosh`
- PostgreSQL: `psql`, `pg_dump`, `pg_restore`
- MySQL/MariaDB: `mysql`, `mysqldump`

If one is missing, report that the sandbox runtime image is missing that binary;
do not spend the turn installing it.

## Credentials

Nuphos does not currently mint database credentials. Use credentials only when:

- The user provides a connection string or host/user/database details.
- The user points to a Kubernetes Secret and explicitly approves reading the
  relevant keys.
- The credentials are already available in the sandbox environment.

Never echo passwords, tokens, or full connection strings. Redact userinfo and
query-string secrets when summarizing.

## Read-only First

Start with low-risk identity and schema checks.

### MongoDB

```bash
mongosh "$MONGODB_URI" --quiet --eval 'db.runCommand({ connectionStatus: 1 }).authInfo.authenticatedUsers'
mongosh "$MONGODB_URI" --quiet --eval 'db.getName(); db.getCollectionNames()'
mongosh "$MONGODB_URI" --quiet --eval 'db.<collection>.findOne()'
```

### PostgreSQL

```bash
psql "$DATABASE_URL" -c 'select current_database(), current_user, version();'
psql "$DATABASE_URL" -c '\dt'
psql "$DATABASE_URL" -c 'select count(*) from <table>;'
```

### MySQL / MariaDB

```bash
mysql "$MYSQL_URL" -e 'select database(), current_user(), version();'
mysql "$MYSQL_URL" -e 'show tables;'
mysql "$MYSQL_URL" -e 'select count(*) from <table>;'
```

If a URL form is not supported by the installed client, pass host/user/database
with environment variables so the password is not printed:

```bash
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -c 'select 1;'
MYSQL_PWD="$MYSQL_PWD" mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" "$MYSQL_DATABASE" -e 'select 1;'
```

## Mutations

Ask for explicit confirmation before running:

- `insert`, `update`, `delete`, `drop`, `truncate`, `alter`, `create index`
- MongoDB write commands such as `updateMany`, `deleteMany`, `drop`, or
  migration scripts
- `pg_restore`, `psql -f`, `mysql < file.sql`
- Any dump/restore against production data

Before mutating, summarize:

- Database type and connection target, with secrets redacted
- Database/schema/table/collection scope
- Exact statement or script path
- Whether there is a backup or rollback path

## Dumps and Backups

Prefer dumps to local files in `/tmp` or `/workspace`; do not print dump
contents into chat.

```bash
# PostgreSQL
pg_dump "$DATABASE_URL" --format=custom --file=/tmp/db.dump
pg_restore --list /tmp/db.dump

# MySQL / MariaDB
MYSQL_PWD="$MYSQL_PWD" mysqldump -h "$MYSQL_HOST" -u "$MYSQL_USER" \
  --single-transaction --quick --set-gtid-purged=OFF "$MYSQL_DATABASE" > /tmp/db.sql
```

For MongoDB, `mongodump` is not guaranteed to be present. If the user needs
logical backup/restore tooling beyond `mongosh`, say that the current runtime
has `mongosh` and ask whether to proceed with shell-level export logic or use a
dedicated backup job.

## Safety

- Read-only by default.
- Add `limit` clauses or collection query limits when sampling rows/documents.
- Do not run unbounded `select *` on large tables.
- Do not print PII, secrets, or raw customer records unless the user explicitly
  asks and the scope is narrow.
- Use transactions for PostgreSQL/MySQL mutations when possible, and show the
  user the statements before committing.
