#!/usr/bin/env node
// Adds a verified doctor to a live Niveda project.
//
// Doctors never sign up publicly: an administrator checks their medical
// registration first, then runs this with the project's service-role key
// (Supabase → Project Settings → API). Never put that key in the app or in git.
//
//   SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/create-doctor.mjs --email dr.meena@hospital.in --name "Dr. Meena Iyer" \
//     --registration "TSMC-12345" --specialization "Cardiology" \
//     --hospital "Northbridge Hospital" --city Hyderabad [--hospital-type hospital] \
//     [--phone "+91 ..."] [--years 12] [--qualifications "MBBS, MD"] [--password ...]
//
// Without --password, ask the doctor to use "Forgot password" on the sign-in
// page to choose their own.
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export async function createDoctor({ url, serviceKey, email, password, name, registration, specialization, hospital, city, hospitalType = 'hospital', phone = '', years = 0, qualifications = '' }) {
  for (const [k, v] of Object.entries({ url, serviceKey, email, name, registration, specialization, hospital, city })) {
    if (!v) throw new Error(`Missing ${k}`);
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Find or add the hospital.
  let { data: h, error } = await admin.from('hospitals').select('id').eq('name', hospital).eq('city', city).maybeSingle();
  if (error) throw error;
  if (!h) {
    ({ data: h, error } = await admin.from('hospitals').insert({ name: hospital, city, type: hospitalType }).select('id').single());
    if (error) throw error;
  }

  const chosen = password || randomBytes(18).toString('base64url');
  const { data: created, error: userError } = await admin.auth.admin.createUser({ email, password: chosen, email_confirm: true, user_metadata: { role: 'doctor' } });
  if (userError) throw userError;

  const { data: doctorId, error: rpcError } = await admin.rpc('admin_create_doctor', {
    p_user: created.user.id,
    p: { fullName: name, email, phone, specialization, registrationNumber: registration, hospitalId: h.id, yearsOfPractice: Number(years) || 0, qualifications },
  });
  if (rpcError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw rpcError;
  }
  const { data: doc } = await admin.from('doctors').select('access_code').eq('id', doctorId).single();
  return { doctorId, userId: created.user.id, hospitalId: h.id, accessCode: doc?.access_code };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opt = { type: 'string' };
  const { values: args } = parseArgs({
    options: { email: opt, password: opt, name: opt, registration: opt, specialization: opt, hospital: opt, city: opt, 'hospital-type': opt, phone: opt, years: opt, qualifications: opt },
  });
  createDoctor({
    url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    email: args.email, password: args.password, name: args.name, registration: args.registration, specialization: args.specialization,
    hospital: args.hospital, city: args.city, hospitalType: args['hospital-type'], phone: args.phone, years: args.years, qualifications: args.qualifications,
  }).then((r) => {
    console.log(`Doctor added. Access code for patients: ${r.accessCode}`);
    console.log(args.password ? 'They can sign in with the password you set.' : 'Ask them to open Niveda and use “Forgot password” to choose a password.');
  }).catch((e) => {
    console.error(`Couldn't add the doctor: ${e.message}`);
    process.exit(1);
  });
}
