/** Loads the fictional demo world into an empty database (development and demos only). */
import { makeTextPdf } from '@shared/pdf';
import { brand } from '@shared/brand';
import type { Db } from './db';
import { json } from './db';
import { buildSeed } from './demoData';
import { hashPassword } from '../routes/auth';
import { putFile } from '../services/storage';
import { phoneDigits, uid } from '../lib/ids';
import { config } from '../config';

export const DEMO_ACCOUNTS = [
  { email: 'meera@example.com', label: 'Meera Iyer · patient', role: 'patient' as const },
  { email: 'priya.sharma@lakeview.example', label: 'Dr. Priya Sharma · general physician', role: 'doctor' as const },
  { email: 'arvind.rao@lakeview.example', label: 'Dr. Arvind Rao · cardiologist', role: 'doctor' as const },
];

export async function loadDemo(db: Db) {
  const d = await buildSeed(await hashPassword(config.demoPassword));
  await db.tx(async (q) => {
    for (const h of d.hospitals) await q.query('INSERT INTO hospitals (id, name, city, type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [h.id, h.name, h.city, h.type]);
    for (const u of d.users) await q.query('INSERT INTO users (id, role, email, phone, phone_digits, password_hash, profile_id, onboarded, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [u.id, u.role, u.email.toLowerCase(), u.phone, phoneDigits(u.phone), u.passwordHash, u.profileId, u.onboarded, u.createdAt]);
    for (const p of d.patients) {
      await q.query(`INSERT INTO patients (id, user_id, patient_code, full_name, date_of_birth, sex, email, phone, blood_group, emergency_contact, important_notes, emergency_card_enabled, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
        [p.id, p.userId, p.patientCode, p.fullName, p.dateOfBirth, p.sex ?? null, p.email, p.phone, p.bloodGroup ?? null, json(p.emergencyContact), p.importantNotes ?? null, p.emergencyCardEnabled, p.createdAt]);
    }
    for (const x of d.doctors) {
      await q.query(`INSERT INTO doctors (id, user_id, full_name, specialization, registration_number, hospital_id, email, phone, access_code, years_of_practice, qualifications)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [x.id, x.userId, x.fullName, x.specialization, x.registrationNumber, x.hospitalId, x.email, x.phone, x.accessCode, x.yearsOfPractice, x.qualifications]);
    }
    // Parents before children.
    const recs = [...d.records].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
    for (const r of recs) {
      await q.query(`INSERT INTO records (id, patient_id, type, date, data, created_at, updated_at, created_by, organization, parent_id, source, version)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
        [r.id, r.patientId, r.type, r.date, json(r.data), r.createdAt, r.updatedAt, json(r.createdBy), json(r.organization), r.parentId ?? null, r.source, r.version]);
      for (const v of r.versions) {
        await q.query('INSERT INTO record_versions (record_id, version, date, data, changed_at, changed_by, change_type, reason) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)',
          [r.id, v.version, v.date, json(v.data), v.changedAt, json(v.changedBy), v.changeType, v.reason ?? null]);
      }
    }
    for (const doc of d.documents) {
      const pdf = Buffer.from(await makeTextPdf(doc.generated!.title, doc.generated!.lines, `${brand.name} demo document - fictional data`).arrayBuffer());
      const key = uid('f').replace('f_', '');
      const { sha256 } = await putFile(key, pdf);
      await q.query(`INSERT INTO documents (id, patient_id, record_id, name, mime_type, size, category, date, uploaded_by, uploaded_at, storage_key, sha256)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
        [doc.id, doc.patientId, doc.recordId ?? null, doc.name, 'application/pdf', pdf.length, doc.category, doc.date, json(doc.uploadedBy), doc.uploadedAt, key, sha256]);
    }
    for (const g of d.grants) {
      await q.query(`INSERT INTO access_grants (id, patient_id, doctor_id, permissions, granted_at, expires_at, status, method, revoked_at, verified_at, expiry_logged)
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)`,
        [g.id, g.patientId, g.doctorId, json(g.permissions), g.grantedAt, g.expiresAt, g.status, g.method, g.revokedAt ?? null, g.verification.verifiedAt, !!g.expiryLogged]);
    }
    for (const r of d.requests) {
      await q.query('INSERT INTO access_requests (id, patient_id, doctor_id, permissions, duration_hours, reason, created_at, status) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',
        [r.id, r.patientId, r.doctorId, json(r.permissions), r.durationHours, r.reason, r.createdAt, r.status]);
    }
    for (const a of d.audit) {
      await q.query('INSERT INTO audit_logs (id, patient_id, actor, action, target, ts, metadata) VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7::jsonb)',
        [a.id, a.patientId ?? null, json(a.actor), a.action, json(a.target), a.timestamp, json(a.metadata)]);
    }
    for (const n of d.notifications) {
      await q.query('INSERT INTO notifications (id, user_id, kind, title, body, link, read, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [n.id, n.userId, n.kind, n.title, n.body, n.link ?? null, n.read, n.createdAt]);
    }
    for (const r of d.reminders) {
      await q.query('INSERT INTO medication_reminders (record_id, patient_id, times, enabled, updated_at) VALUES ($1,$2,$3::jsonb,$4,$5)', [r.recordId, r.patientId, json(r.times), r.enabled, r.updatedAt]);
    }
    for (const l of d.doseLogs) {
      await q.query('INSERT INTO dose_logs (id, patient_id, record_id, date, time, status, logged_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [l.id, l.patientId, l.recordId, l.date, l.time, l.status, l.loggedAt]);
    }
    await q.query(`INSERT INTO app_meta (key, value) VALUES ('demo_loaded', now()::text)`);
  });
}
