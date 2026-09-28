#!/usr/bin/env bash
# Creates a database laid out like a Supabase project: the real Supabase Auth
# migrations, a minimal storage schema, then Niveda's migrations.
# Usage: tests/live/setup-db.sh <psql-args...> (e.g. -h /tmp/pg -p 5433 -U postgres)
set -euo pipefail
DB=${LIVE_DB:-niveda_live}
BIN=${SUPABASE_BIN:-/tmp/sbx}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PSQL="psql -v ON_ERROR_STOP=1 -q $*"

$PSQL -c "drop database if exists $DB with (force)" -c "create database $DB"
for r in "anon nologin" "authenticated nologin" "service_role nologin bypassrls" "supabase_auth_admin login superuser" "authenticator login noinherit"; do
  $PSQL -c "create role $r" 2>/dev/null || true
done
$PSQL -c "alter role supabase_auth_admin set search_path = auth"
$PSQL -d "$DB" <<'SQL'
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to public;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- Storage: just the tables the policies need. tests/live/stack.mjs serves the file API.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner uuid, created_at timestamptz default now(), unique (bucket_id, name));
create table storage.blobs (name text primary key, data bytea not null, content_type text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
SQL
HOSTARGS="$*"
PGHOST_OPT=$(echo "$HOSTARGS" | sed -n 's/.*-h \([^ ]*\).*/\1/p')
PGPORT_OPT=$(echo "$HOSTARGS" | sed -n 's/.*-p \([^ ]*\).*/\1/p')
( cd "$BIN" && GOTRUE_DB_DRIVER=postgres GOTRUE_DB_NAMESPACE=auth \
  DATABASE_URL="postgres://supabase_auth_admin@localhost:${PGPORT_OPT:-5432}/$DB?sslmode=disable" \
  GOTRUE_DB_MIGRATIONS_PATH="$BIN/migrations" API_EXTERNAL_URL=http://localhost GOTRUE_SITE_URL=http://localhost GOTRUE_JWT_SECRET=x \
  ./auth migrate >/dev/null 2>"$HERE/.auth-migrate.log" ) || { cat "$HERE/.auth-migrate.log"; exit 1; }
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -d "$DB" -f "$f" 2>&1 | grep -v "NOTICE" || true; done
echo "ready: $DB"
