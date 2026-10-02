/* eslint-disable */
/** Database schema (idempotent). Kept in TS so it ships inside the server bundle. */
export const SCHEMA_SQL = `
-- Niveda schema, version 1.
-- Dates of medical events are DATE; moments are TIMESTAMPTZ. Structured medical
-- content is JSONB so new record types need no schema change.

CREATE TABLE IF NOT EXISTS hospitals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hospital', 'clinic', 'laboratory', 'imaging'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('patient', 'doctor')),
  email TEXT NOT NULL UNIQUE,            -- stored lower-case
  phone TEXT NOT NULL,
  phone_digits TEXT NOT NULL UNIQUE,     -- last 10 digits, for sign-in by phone
  password_hash TEXT NOT NULL,           -- argon2id
  profile_id TEXT NOT NULL,
  onboarded BOOLEAN NOT NULL DEFAULT false,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  patient_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  sex TEXT,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  blood_group TEXT,
  photo_data_url TEXT,
  emergency_contact JSONB,
  important_notes TEXT,
  emergency_card_enabled BOOLEAN NOT NULL DEFAULT false,
  declarations JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  specialization TEXT NOT NULL,
  registration_number TEXT NOT NULL UNIQUE,
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  access_code TEXT NOT NULL UNIQUE,
  years_of_practice INT NOT NULL DEFAULT 0,
  qualifications TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  date DATE NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by JSONB NOT NULL,             -- immutable attribution {id, role, name, organization}
  organization JSONB,
  parent_id TEXT REFERENCES records(id),
  source TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS records_patient_idx ON records (patient_id, date DESC);

-- Every version of every record. Corrections add rows; nothing is overwritten.
CREATE TABLE IF NOT EXISTS record_versions (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  version INT NOT NULL,
  date DATE NOT NULL,
  data JSONB NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  changed_by JSONB NOT NULL,
  change_type TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY (record_id, version)
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  record_id TEXT REFERENCES records(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INT NOT NULL,
  category TEXT NOT NULL,
  date DATE NOT NULL,
  uploaded_by JSONB NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL,
  storage_key TEXT NOT NULL,             -- encrypted file on disk / object storage
  sha256 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_patient_idx ON documents (patient_id);

CREATE TABLE IF NOT EXISTS access_grants (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  permissions JSONB NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
  method TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ NOT NULL,
  reminder_sent BOOLEAN NOT NULL DEFAULT false,
  expiry_logged BOOLEAN NOT NULL DEFAULT false,
  request_id TEXT
);
CREATE INDEX IF NOT EXISTS grants_doctor_idx ON access_grants (doctor_id, status);
CREATE INDEX IF NOT EXISTS grants_patient_idx ON access_grants (patient_id);

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  permissions JSONB NOT NULL,
  duration_hours INT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  responded_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS doctor_invites (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  contact TEXT NOT NULL,
  doctor_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL
);

-- Append-only audit trail. A trigger blocks updates and deletes.
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  patient_id TEXT,
  actor JSONB NOT NULL,
  action TEXT NOT NULL,
  target JSONB,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS audit_patient_idx ON audit_logs (patient_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_logs ((actor->>'id'), ts DESC);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_change ON audit_logs;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,       -- sha256 of the cookie token; the token itself is never stored
  device TEXT NOT NULL,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  user_id TEXT,
  destination TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  payload JSONB,                          -- e.g. pending sign-up details (password already hashed)
  attempts INT NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_dest_idx ON otp_challenges (destination, created_at DESC);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS medication_reminders (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  times JSONB NOT NULL,
  enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS dose_logs (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('taken', 'skipped')),
  logged_at TIMESTAMPTZ NOT NULL,
  UNIQUE (record_id, date, time)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keys JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which dose reminders have already been pushed, so each is sent once.
CREATE TABLE IF NOT EXISTS push_sent (
  key TEXT PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
