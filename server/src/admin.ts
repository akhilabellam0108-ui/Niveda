/**
 * Admin command line. Clinicians are added here after their registration has been verified
 * off-app (e.g. against the state medical council register) — never through public sign-up.
 *
 *   npm run admin -- add-hospital --id h_city --name "City Hospital" --city Hyderabad --type hospital
 *   npm run admin -- add-doctor --name "Dr. A. Rao" --email a@city.example --phone 9000000000 \
 *        --specialization Cardiologist --registration TSMC/CAR/2020/1 --hospital h_city
 *   npm run admin -- list-hospitals
 */
import { randomBytes } from 'node:crypto';
import { openDatabase } from './db/setup';
import { hashPassword } from './routes/auth';
import { phoneDigits, uid } from './lib/ids';
import { sendEmail } from './services/messaging';
import { config } from './config';

function args() {
  const out: Record<string, string> = {};
  const a = process.argv.slice(3);
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) out[a[i].slice(2)] = a[i + 1] ?? '';
  return out;
}

async function main() {
  const cmd = process.argv[2];
  const a = args();
  const db = await openDatabase({ seedDemo: false });
  try {
    if (cmd === 'list-hospitals') {
      console.table(await db.query('SELECT id, name, city, type FROM hospitals ORDER BY name'));
    } else if (cmd === 'add-hospital') {
      for (const k of ['id', 'name', 'city', 'type']) if (!a[k]) throw new Error(`--${k} is required`);
      await db.query('INSERT INTO hospitals (id, name, city, type) VALUES ($1,$2,$3,$4)', [a.id, a.name, a.city, a.type]);
      console.log(`Added ${a.name}`);
    } else if (cmd === 'add-doctor') {
      for (const k of ['name', 'email', 'phone', 'specialization', 'registration', 'hospital']) if (!a[k]) throw new Error(`--${k} is required`);
      const tempPassword = `${randomBytes(6).toString('base64url')}9a`;
      const userId = uid('usr');
      const doctorId = uid('doc');
      const initials = a.name.replace(/^Dr\.?\s*/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const accessCode = `${initials}-${String(1000 + Math.floor(Math.random() * 9000))}`;
      await db.tx(async (q) => {
        await q.query('INSERT INTO users (id, role, email, phone, phone_digits, password_hash, profile_id, onboarded) VALUES ($1,$2,$3,$4,$5,$6,$7,true)',
          [userId, 'doctor', a.email.toLowerCase(), a.phone, phoneDigits(a.phone), await hashPassword(tempPassword), doctorId]);
        await q.query(`INSERT INTO doctors (id, user_id, full_name, specialization, registration_number, hospital_id, email, phone, access_code, years_of_practice, qualifications)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [doctorId, userId, a.name, a.specialization, a.registration, a.hospital, a.email.toLowerCase(), a.phone, accessCode, Number(a.years ?? 0), a.qualifications ?? '']);
      });
      await sendEmail(a.email, 'Your Niveda clinician account',
        `Hello ${a.name},\n\nYour Niveda clinician account is ready.\nSign in at ${config.appUrl} with ${a.email} and this temporary password: ${tempPassword}\nPlease change it after signing in (Security → Password).\nYour access code for patients: ${accessCode}`);
      console.log(`Added ${a.name}. Access code ${accessCode}. A temporary password was emailed${config.smtp.host || config.smtp.url ? '' : ` (email not configured — temporary password: ${tempPassword})`}.`);
    } else {
      console.log('Commands: list-hospitals | add-hospital | add-doctor (see comments at the top of server/src/admin.ts)');
    }
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
