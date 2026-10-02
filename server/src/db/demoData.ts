/**
 * Fictional demo data. Every person, hospital and medical detail here is invented.
 * Access grants are placed relative to "now" so the demo always shows an active,
 * an expired and a revoked grant plus a pending request.
 */
import type {
  DoseLog, MedicationReminder,
  AccessGrant, AccessRequest, Actor, AuditLog, Database, Doctor, Hospital, MedicalDocument,
  MedicalRecord, Notification, Patient, PermissionKey, RecordData, RecordType, Session, User,
} from '@shared/types';
import { DEFAULT_PERMISSIONS, cleanData, recordTitle } from '@shared/recordMeta';
import { addHours, addDays, toISODate } from '@shared/dates';
import { defaultTimes } from '@shared/reminders';

export const hospitals: Hospital[] = [
  { id: 'h_lakeview', name: 'Lakeview Hospital', city: 'Hyderabad', type: 'hospital' },
  { id: 'h_northbridge', name: 'Northbridge Hospital', city: 'Hyderabad', type: 'hospital' },
  { id: 'h_greenfield', name: 'Greenfield Chest Clinic', city: 'Secunderabad', type: 'clinic' },
  { id: 'h_sunrise', name: 'Sunrise Diagnostics', city: 'Hyderabad', type: 'laboratory' },
  { id: 'h_clearview', name: 'Clearview Imaging Centre', city: 'Hyderabad', type: 'imaging' },
  { id: 'h_sunskin', name: 'Sunrise Skin Clinic', city: 'Hyderabad', type: 'clinic' },
];

const hname = (id: string) => hospitals.find((h) => h.id === id)!.name;

const doctorSeeds: Omit<Doctor, 'userId'>[] = [
  { id: 'd_priya', fullName: 'Dr. Priya Sharma', specialization: 'General Physician', registrationNumber: 'TSMC/GP/2011/04217', hospitalId: 'h_lakeview', email: 'priya.sharma@lakeview.example', phone: '+91 90000 11001', accessCode: 'PS-4821', yearsOfPractice: 15, qualifications: 'MBBS, MD (Internal Medicine)' },
  { id: 'd_rahul', fullName: 'Dr. Rahul Kumar', specialization: 'General Surgeon', registrationNumber: 'TSMC/SUR/2008/01988', hospitalId: 'h_northbridge', email: 'rahul.kumar@northbridge.example', phone: '+91 90000 11002', accessCode: 'RK-3390', yearsOfPractice: 18, qualifications: 'MBBS, MS (General Surgery)' },
  { id: 'd_kavya', fullName: 'Dr. Kavya Menon', specialization: 'Pulmonologist', registrationNumber: 'TSMC/PUL/2012/05530', hospitalId: 'h_greenfield', email: 'kavya.menon@greenfield.example', phone: '+91 90000 11003', accessCode: 'KM-7154', yearsOfPractice: 13, qualifications: 'MBBS, MD (Pulmonary Medicine)' },
  { id: 'd_arvind', fullName: 'Dr. Arvind Rao', specialization: 'Cardiologist', registrationNumber: 'TSMC/CAR/2009/02875', hospitalId: 'h_lakeview', email: 'arvind.rao@lakeview.example', phone: '+91 90000 11004', accessCode: 'AR-2210', yearsOfPractice: 17, qualifications: 'MBBS, MD, DM (Cardiology)' },
  { id: 'd_sana', fullName: 'Dr. Sana Qureshi', specialization: 'Dermatologist', registrationNumber: 'TSMC/DER/2015/07741', hospitalId: 'h_sunskin', email: 'sana.qureshi@sunskin.example', phone: '+91 90000 11005', accessCode: 'SQ-6603', yearsOfPractice: 10, qualifications: 'MBBS, MD (Dermatology)' },
];

export const doctorActor = (d: Pick<Doctor, 'id' | 'fullName' | 'hospitalId'>): Actor => ({
  id: d.id, role: 'doctor', name: d.fullName, organization: hname(d.hospitalId),
});

/** Builds the fictional demo world. `passwordHash` is supplied by the caller (argon2). */
export async function buildSeed(passwordHash: string): Promise<Database> {
  const users: User[] = [];
  const mkUser = async (id: string, role: User['role'], email: string, phone: string, profileId: string): Promise<User> => {
    return { id, role, email, phone, passwordSalt: '', passwordHash, createdAt: '2018-01-10T09:00:00.000Z', profileId, onboarded: true };
  };

  const patients: Patient[] = [
    { id: 'p_meera', userId: 'u_meera', patientCode: 'NV-4821-7730', fullName: 'Meera Iyer', dateOfBirth: '1994-03-12', sex: 'female', email: 'meera@example.com', phone: '+91 98480 22110', bloodGroup: 'B+', emergencyContact: { name: 'Arjun Iyer', relationship: 'Brother', phone: '+91 98480 22111' }, importantNotes: 'Asthmatic — carries a salbutamol inhaler. Severe penicillin allergy.', emergencyCardEnabled: true, createdAt: '2018-01-10T09:00:00.000Z' },
    { id: 'p_rohan', userId: 'u_rohan', patientCode: 'NV-3107-5528', fullName: 'Rohan Desai', dateOfBirth: '1981-11-02', sex: 'male', email: 'rohan@example.com', phone: '+91 98480 33220', bloodGroup: 'O+', emergencyContact: { name: 'Nisha Desai', relationship: 'Spouse', phone: '+91 98480 33221' }, emergencyCardEnabled: true, createdAt: '2023-04-02T09:00:00.000Z' },
    { id: 'p_fatima', userId: 'u_fatima', patientCode: 'NV-9264-1183', fullName: 'Fatima Khan', dateOfBirth: '1968-07-21', sex: 'female', email: 'fatima@example.com', phone: '+91 98480 44330', bloodGroup: 'A-', emergencyContact: { name: 'Imran Khan', relationship: 'Son', phone: '+91 98480 44331' }, emergencyCardEnabled: false, createdAt: '2024-09-15T09:00:00.000Z' },
  ];
  for (const p of patients) users.push(await mkUser(p.userId, 'patient', p.email, p.phone, p.id));

  const doctors: Doctor[] = doctorSeeds.map((d) => ({ ...d, userId: `u_${d.id.slice(2)}` }));
  for (const d of doctors) users.push(await mkUser(d.userId, 'doctor', d.email, d.phone, d.id));

  const byId = (id: string) => doctors.find((d) => d.id === id)!;
  const self = (p: Patient): Actor => ({ id: p.id, role: 'patient', name: p.fullName });
  const meera = patients[0];

  const records: MedicalRecord[] = [];
  const documents: MedicalDocument[] = [];
  const audit: AuditLog[] = [];

  const rec = (
    id: string, patient: Patient, type: RecordType, date: string, data: RecordData,
    by: Actor, opts: { org?: string; parentId?: string; attachments?: string[]; enteredAt?: string } = {},
  ): MedicalRecord => {
    const at = opts.enteredAt ?? `${date}T11:30:00.000Z`;
    const clean = cleanData(type, data);
    const r: MedicalRecord = {
      id, patientId: patient.id, type, date, data: clean, createdAt: at, updatedAt: at, createdBy: by,
      organization: opts.org ? { id: opts.org, name: hname(opts.org) } : undefined,
      attachments: opts.attachments ?? [], parentId: opts.parentId,
      source: by.role === 'doctor' ? 'doctor' : 'patient', version: 1,
      versions: [{ version: 1, date, data: clean, changedAt: at, changedBy: by, changeType: 'created' }],
    };
    records.push(r);
    if (by.role === 'doctor') {
      audit.push({ id: `a_${id}`, patientId: patient.id, actor: by, action: 'record_added', target: { type: type, id, label: recordTitle({ type, data: clean }) }, timestamp: at });
    }
    return r;
  };
  const doc = (id: string, patient: Patient, name: string, category: MedicalDocument['category'], date: string, recordId: string | undefined, by: Actor, title: string, lines: string[]) => {
    documents.push({ id, patientId: patient.id, name, mimeType: 'application/pdf', size: 1400 + lines.join('').length, category, date, recordId, uploadedBy: by, uploadedAt: `${date}T12:00:00.000Z`, generated: { title, lines } });
  };

  const priya = doctorActor(byId('d_priya'));
  const rahul = doctorActor(byId('d_rahul'));
  const kavya = doctorActor(byId('d_kavya'));
  const me = self(meera);

  /* ---- Meera's lifelong history ---- */
  rec('r_allergy_pen', meera, 'allergy', '2018-02-14', { allergen: 'Penicillin', severity: 'Life-threatening', reaction: 'Hives, facial swelling, difficulty breathing', notes: 'Reaction after amoxicillin course. Avoid all penicillin-class antibiotics.' }, me);
  rec('r_allergy_dust', meera, 'allergy', '2018-02-14', { allergen: 'House dust mites', severity: 'Mild', reaction: 'Sneezing, itchy eyes' }, me);
  rec('r_fam_dm', meera, 'family_history', '2019-06-01', { condition: 'Type 2 diabetes', relative: 'Father', notes: 'Diagnosed at age 52.' }, me);
  rec('r_asthma', meera, 'diagnosis', '2020-05-10', { condition: 'Mild persistent asthma', status: 'Managed', severity: 'Mild', doctor: 'Dr. Kavya Menon', facility: 'Greenfield Chest Clinic', notes: 'Triggered by dust and cold air. Spirometry reversible.' }, kavya, { org: 'h_greenfield' });
  rec('r_med_salbutamol', meera, 'medication', '2020-05-10', { name: 'Salbutamol inhaler', dosage: '100 mcg, 2 puffs', frequency: 'As needed', prescriber: 'Dr. Kavya Menon', reason: 'Asthma — reliever', instructions: 'Use when wheezy or before exercise. Seek help if needed more than 3 times a week.' }, kavya, { org: 'h_greenfield', parentId: 'r_asthma' });
  rec('r_med_montelukast', meera, 'medication', '2020-05-10', { name: 'Montelukast', dosage: '10 mg', frequency: 'Every night', prescriber: 'Dr. Kavya Menon', reason: 'Asthma — preventer', instructions: 'Take at bedtime.' }, kavya, { org: 'h_greenfield', parentId: 'r_asthma' });
  rec('r_med_cetirizine', meera, 'medication', '2026-09-01', { name: 'Levocetirizine', dosage: '5 mg', frequency: 'Once daily', endDate: '2026-11-30', prescriber: 'Dr. Priya Sharma', reason: 'Dust-mite allergy (seasonal)', instructions: 'Take in the morning.' }, priya, { org: 'h_lakeview', enteredAt: '2026-09-01T06:00:00.000Z' });
  rec('r_vax_c1', meera, 'vaccination', '2021-05-18', { vaccine: 'COVID-19 (Covishield)', dose: 'Dose 1', facility: 'Lakeview Hospital', batch: 'CV-21A-0931' }, me);
  rec('r_vax_c2', meera, 'vaccination', '2021-08-12', { vaccine: 'COVID-19 (Covishield)', dose: 'Dose 2', facility: 'Lakeview Hospital', batch: 'CV-21C-1182' }, me);
  rec('r_vax_c3', meera, 'vaccination', '2022-02-03', { vaccine: 'COVID-19 (Covishield)', dose: 'Booster', facility: 'Lakeview Hospital', batch: 'CV-22A-0412' }, me);

  rec('r_hosp_appx', meera, 'hospitalization', '2022-08-17', { reason: 'Acute appendicitis', facility: 'Northbridge Hospital', dischargeDate: '2022-08-20', attendingDoctor: 'Dr. Rahul Kumar', summary: 'Admitted via emergency with right lower abdominal pain. Laparoscopic appendectomy on 18 Aug. Uneventful recovery.' }, rahul, { org: 'h_northbridge', attachments: ['doc_discharge'] });
  rec('r_surg_appx', meera, 'surgery', '2022-08-18', { procedure: 'Laparoscopic appendectomy', surgeon: 'Dr. Rahul Kumar', facility: 'Northbridge Hospital', reason: 'Acute appendicitis', outcome: 'Successful', notes: 'Non-penicillin antibiotic cover used (allergy noted).' }, rahul, { org: 'h_northbridge', parentId: 'r_hosp_appx' });
  doc('doc_discharge', meera, 'Discharge summary — Northbridge.pdf', 'discharge', '2022-08-20', 'r_hosp_appx', rahul, 'Discharge Summary', [
    'Patient: Meera Iyer    Patient ID: NV-4821-7730', 'Admitted: 17 Aug 2022    Discharged: 20 Aug 2022', 'Consultant: Dr. Rahul Kumar, General Surgery', '',
    '# Diagnosis', 'Acute appendicitis', '', '# Procedure', 'Laparoscopic appendectomy (18 Aug 2022). No complications.', '',
    '# Allergies', 'PENICILLIN - life-threatening. Clindamycin used for cover.', '', '# Advice on discharge', 'Light activity for 2 weeks. Wound review in 7 days.',
  ]);

  rec('r_img_cxr', meera, 'imaging', '2023-11-06', { study: 'Chest X-ray (PA view)', modality: 'X-ray', facility: 'Clearview Imaging Centre', findings: 'Lung fields clear. No consolidation or effusion. Heart size normal.', impression: 'Normal chest radiograph' }, kavya, { org: 'h_clearview', attachments: ['doc_cxr'] });
  doc('doc_cxr', meera, 'Chest X-ray report.pdf', 'scan', '2023-11-06', 'r_img_cxr', kavya, 'Radiology Report - Chest X-ray', [
    'Patient: Meera Iyer    Date: 06 Nov 2023', 'Referred by: Dr. Kavya Menon', '', '# Findings', 'Lung fields are clear. No focal consolidation, effusion or pneumothorax.', 'Cardiac silhouette within normal limits.', '', '# Impression', 'Normal chest radiograph.',
  ]);

  rec('r_lab_vitd_order', meera, 'lab_test', '2024-02-19', { test: 'Vitamin D (25-OH)', status: 'Completed', laboratory: 'Sunrise Diagnostics', orderedBy: 'Dr. Priya Sharma', reason: 'Fatigue, muscle aches' }, priya, { org: 'h_lakeview' });
  rec('r_lab_vitd', meera, 'lab_result', '2024-02-20', { test: 'Vitamin D (25-OH)', laboratory: 'Sunrise Diagnostics', result: '14 ng/mL', referenceRange: '30 – 100 ng/mL', status: 'Abnormal', notes: 'Deficient.' }, priya, { org: 'h_sunrise', parentId: 'r_lab_vitd_order' });
  rec('r_med_vitd', meera, 'medication', '2024-02-22', { name: 'Cholecalciferol (Vitamin D3)', dosage: '60,000 IU', frequency: 'Weekly', endDate: '2024-04-18', prescriber: 'Dr. Priya Sharma', reason: 'Vitamin D deficiency', instructions: 'With milk, 8 weeks.' }, priya, { org: 'h_lakeview', parentId: 'r_lab_vitd' });

  // 2025 anaemia episode: consultation -> diagnosis -> medication later discontinued (shows versioning)
  rec('r_cons_2025', meera, 'consultation', '2025-01-14', { reason: 'Tiredness and breathlessness on stairs', doctor: 'Dr. Priya Sharma', facility: 'Lakeview Hospital', symptoms: 'Fatigue for 6 weeks, pale, occasional dizziness', diagnosis: 'Iron-deficiency anaemia', followUp: '2025-04-15', notes: 'Hb 9.8 g/dL. Start oral iron, recheck in 3 months.' }, priya, { org: 'h_lakeview' });
  rec('r_dx_anaemia', meera, 'diagnosis', '2025-01-14', { condition: 'Iron-deficiency anaemia', status: 'Resolved', severity: 'Moderate', doctor: 'Dr. Priya Sharma', facility: 'Lakeview Hospital', notes: 'Resolved after iron therapy (Apr 2025).' }, priya, { org: 'h_lakeview', parentId: 'r_cons_2025' });
  const iron = rec('r_med_iron', meera, 'medication', '2025-01-14', { name: 'Ferrous sulfate', dosage: '200 mg', frequency: 'Twice daily', prescriber: 'Dr. Priya Sharma', reason: 'Iron-deficiency anaemia', instructions: 'Take before food with orange juice.' }, priya, { org: 'h_lakeview', parentId: 'r_cons_2025' });
  // Discontinued version (history is preserved, not overwritten)
  const ironV2: RecordData = { ...iron.data, medStatus: 'discontinued', discontinuedOn: '2025-04-15', discontinueReason: 'Haemoglobin back to normal (12.9 g/dL).' };
  iron.versions.push({ version: 2, date: iron.date, data: ironV2, changedAt: '2025-04-15T10:20:00.000Z', changedBy: priya, changeType: 'discontinued', reason: 'Haemoglobin back to normal (12.9 g/dL).' });
  iron.data = ironV2; iron.version = 2; iron.updatedAt = '2025-04-15T10:20:00.000Z';

  rec('r_mh_2025', meera, 'mental_health', '2025-06-09', { topic: 'Counselling — work-related stress', provider: 'Ms. Leela Nair, counsellor', notes: 'Six sessions completed. Sleep improved.' }, me);
  rec('r_vax_flu', meera, 'vaccination', '2025-10-21', { vaccine: 'Influenza (quadrivalent)', dose: 'Annual', facility: 'Lakeview Hospital', nextDue: '2026-10-20' }, me);

  rec('r_lab_cbc_order', meera, 'lab_test', '2026-08-10', { test: 'Complete blood count + HbA1c', status: 'Completed', laboratory: 'Sunrise Diagnostics', orderedBy: 'Dr. Priya Sharma', reason: 'Annual check; family history of diabetes' }, priya, { org: 'h_lakeview' });
  rec('r_lab_cbc', meera, 'lab_result', '2026-08-11', { test: 'Complete blood count (CBC)', laboratory: 'Sunrise Diagnostics', result: 'Hb 12.8 g/dL · WBC 7,200/µL · Platelets 2.6 lakh/µL', referenceRange: 'Hb 12.0 – 15.5 g/dL', status: 'Normal' }, priya, { org: 'h_sunrise', parentId: 'r_lab_cbc_order', attachments: ['doc_cbc'] });
  rec('r_lab_hba1c', meera, 'lab_result', '2026-08-11', { test: 'HbA1c', laboratory: 'Sunrise Diagnostics', result: '5.6 %', referenceRange: 'Below 5.7 %', status: 'Borderline', notes: 'Upper end of normal. Repeat yearly given family history.' }, priya, { org: 'h_sunrise', parentId: 'r_lab_cbc_order', attachments: ['doc_cbc'] });
  doc('doc_cbc', meera, 'CBC & HbA1c — Sunrise Diagnostics.pdf', 'report', '2026-08-11', 'r_lab_cbc', priya, 'Laboratory Report', [
    'Patient: Meera Iyer    Patient ID: NV-4821-7730', 'Collected: 11 Aug 2026    Referred by: Dr. Priya Sharma', '',
    '# Complete blood count', 'Haemoglobin ............ 12.8 g/dL     (12.0 - 15.5)', 'WBC ..................... 7,200 /uL     (4,000 - 11,000)', 'Platelets ............... 2.6 lakh/uL  (1.5 - 4.5)', '',
    '# Glycated haemoglobin', 'HbA1c ................... 5.6 %        (below 5.7)', '', 'Verified by: Dr. N. Reddy, Pathologist',
  ]);

  // The most recent consultation, by Dr. Priya Sharma
  rec('r_cons_2026', meera, 'consultation', '2026-09-24', { reason: 'Recurring headaches for 3 weeks', doctor: 'Dr. Priya Sharma', facility: 'Lakeview Hospital', symptoms: 'Band-like headache in the evenings, worse with screen time. No vomiting or visual changes.', diagnosis: 'Tension-type headache', followUp: '2026-10-08', notes: 'BP 118/76. Neuro exam normal. Advised screen breaks, hydration, sleep routine.' }, priya, { org: 'h_lakeview', attachments: ['doc_rx_0924'], enteredAt: '2026-09-24T05:40:00.000Z' });
  rec('r_dx_tth', meera, 'diagnosis', '2026-09-24', { condition: 'Tension-type headache', status: 'Active', severity: 'Mild', doctor: 'Dr. Priya Sharma', facility: 'Lakeview Hospital' }, priya, { org: 'h_lakeview', parentId: 'r_cons_2026', enteredAt: '2026-09-24T05:41:00.000Z' });
  rec('r_med_pcm', meera, 'medication', '2026-09-24', { name: 'Paracetamol', dosage: '650 mg', frequency: 'As needed', endDate: '2026-10-08', prescriber: 'Dr. Priya Sharma', reason: 'Tension-type headache', instructions: 'Max 3 tablets a day. Avoid on an empty stomach.' }, priya, { org: 'h_lakeview', parentId: 'r_cons_2026', enteredAt: '2026-09-24T05:42:00.000Z' });
  doc('doc_rx_0924', meera, 'Prescription — 24 Sep 2026.pdf', 'prescription', '2026-09-24', 'r_cons_2026', priya, 'Prescription', [
    'Dr. Priya Sharma, MBBS, MD - Lakeview Hospital', 'Reg. no. TSMC/GP/2011/04217', '', 'Patient: Meera Iyer    Date: 24 Sep 2026', '',
    '# Rx', '1. Paracetamol 650 mg - as needed, max 3/day, until 08 Oct 2026', '', '# Advice', 'Screen breaks every 45 minutes. 2.5 L water daily. Regular sleep.', '', 'Review: 08 Oct 2026',
  ]);

  /* ---- Rohan: smaller history ---- */
  const rohan = patients[1];
  rec('r_ro_htn', rohan, 'diagnosis', '2023-04-10', { condition: 'Essential hypertension', status: 'Managed', doctor: 'Dr. Priya Sharma', facility: 'Lakeview Hospital' }, priya, { org: 'h_lakeview' });
  rec('r_ro_amlo', rohan, 'medication', '2023-04-10', { name: 'Amlodipine', dosage: '5 mg', frequency: 'Once daily', prescriber: 'Dr. Priya Sharma', reason: 'Hypertension' }, priya, { org: 'h_lakeview', parentId: 'r_ro_htn' });
  rec('r_ro_lipid', rohan, 'lab_result', '2026-07-02', { test: 'Lipid profile', laboratory: 'Sunrise Diagnostics', result: 'LDL 142 mg/dL', referenceRange: 'Below 100 mg/dL', status: 'Abnormal' }, priya, { org: 'h_sunrise' });
  rec('r_ro_allergy', rohan, 'allergy', '2015-03-01', { allergen: 'Sulfa drugs', severity: 'Moderate', reaction: 'Rash' }, self(rohan));

  /* ---- Fatima: no access for Dr. Priya ---- */
  const fatima = patients[2];
  rec('r_fa_t2dm', fatima, 'diagnosis', '2019-09-01', { condition: 'Type 2 diabetes', status: 'Managed' }, self(fatima));

  /* ---- Access grants (relative to now) ---- */
  const H = 3600000;
  const ago = (h: number) => new Date(Date.now() - h * H).toISOString();
  const verification = (at: string) => ({ method: 'otp' as const, verifiedAt: at });

  const grants: AccessGrant[] = [
    { id: 'g_priya', patientId: meera.id, doctorId: 'd_priya', permissions: DEFAULT_PERMISSIONS, grantedAt: ago(52), expiresAt: addHours(ago(52), 72), status: 'active', method: 'code', verification: verification(ago(52)) },
    { id: 'g_rahul', patientId: meera.id, doctorId: 'd_rahul', permissions: ['history', 'surgeries', 'allergies', 'medications'], grantedAt: ago(96), expiresAt: ago(24 + 1), status: 'expired', method: 'directory', verification: verification(ago(96)), expiryLogged: true },
    { id: 'g_kavya', patientId: meera.id, doctorId: 'd_kavya', permissions: ['history', 'medications', 'allergies', 'imaging'], grantedAt: '2026-06-02T04:30:00.000Z', expiresAt: '2026-06-09T04:30:00.000Z', status: 'revoked', revokedAt: '2026-06-04T11:42:00.000Z', method: 'qr', verification: verification('2026-06-02T04:30:00.000Z') },
    { id: 'g_priya_rohan', patientId: rohan.id, doctorId: 'd_priya', permissions: DEFAULT_PERMISSIONS, grantedAt: ago(5), expiresAt: addHours(ago(5), 24 * 7), status: 'active', method: 'code', verification: verification(ago(5)) },
  ];

  const requests: AccessRequest[] = [
    { id: 'req_arvind', patientId: meera.id, doctorId: 'd_arvind', permissions: ['history', 'medications', 'labs'] as PermissionKey[], durationHours: 24, reason: 'Referral from Dr. Priya Sharma — palpitations review', createdAt: ago(3), status: 'pending' },
  ];

  const sys: Actor = { id: 'system', role: 'system', name: 'Niveda' };
  const push = (a: Omit<AuditLog, 'id'>) => audit.push({ id: `a_${audit.length}_${a.action}`, ...a });
  push({ patientId: meera.id, actor: me, action: 'account_created', target: { type: 'account', label: 'Patient account' }, timestamp: '2018-01-10T09:00:00.000Z' });
  push({ patientId: meera.id, actor: me, action: 'access_granted', target: { type: 'doctor', id: 'd_kavya', label: 'Dr. Kavya Menon' }, timestamp: '2026-06-02T04:30:00.000Z', metadata: { permissions: ['history', 'medications', 'allergies', 'imaging'], duration: '7 days', method: 'QR code' } });
  push({ patientId: meera.id, actor: kavya, action: 'viewed_history', target: { type: 'record', label: 'Medical history' }, timestamp: '2026-06-02T05:02:00.000Z' });
  push({ patientId: meera.id, actor: me, action: 'access_revoked', target: { type: 'doctor', id: 'd_kavya', label: 'Dr. Kavya Menon' }, timestamp: '2026-06-04T11:42:00.000Z' });
  push({ patientId: meera.id, actor: me, action: 'access_granted', target: { type: 'doctor', id: 'd_rahul', label: 'Dr. Rahul Kumar' }, timestamp: ago(96), metadata: { permissions: ['history', 'surgeries', 'allergies', 'medications'], duration: '3 days', method: 'Doctor directory' } });
  push({ patientId: meera.id, actor: rahul, action: 'viewed_history', target: { type: 'record', label: 'Medical history' }, timestamp: ago(94) });
  push({ patientId: meera.id, actor: sys, action: 'access_expired', target: { type: 'doctor', id: 'd_rahul', label: 'Dr. Rahul Kumar' }, timestamp: ago(25) });
  push({ patientId: meera.id, actor: me, action: 'access_granted', target: { type: 'doctor', id: 'd_priya', label: 'Dr. Priya Sharma' }, timestamp: ago(52), metadata: { permissions: DEFAULT_PERMISSIONS, duration: '3 days', method: 'Doctor access code' } });
  push({ patientId: meera.id, actor: priya, action: 'viewed_history', target: { type: 'record', label: 'Medical history' }, timestamp: ago(51.5) });
  push({ patientId: meera.id, actor: priya, action: 'viewed_document', target: { type: 'document', id: 'doc_cbc', label: 'CBC & HbA1c — Sunrise Diagnostics.pdf' }, timestamp: ago(51.3) });
  push({ patientId: meera.id, actor: { id: 'd_arvind', role: 'doctor', name: 'Dr. Arvind Rao', organization: 'Lakeview Hospital' }, action: 'access_requested', target: { type: 'request', id: 'req_arvind', label: 'History, medications, lab reports · 24 hours' }, timestamp: ago(3) });
  push({ patientId: rohan.id, actor: self(rohan), action: 'access_granted', target: { type: 'doctor', id: 'd_priya', label: 'Dr. Priya Sharma' }, timestamp: ago(5), metadata: { permissions: DEFAULT_PERMISSIONS, duration: '7 days', method: 'Doctor access code' } });
  audit.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const n = (userId: string, kind: Notification['kind'], title: string, body: string, createdAt: string, link?: string, read = false): Notification =>
    ({ id: `n_${userId}_${createdAt}_${kind}`, userId, kind, title, body, createdAt, link, read });
  const notifications: Notification[] = [
    n('u_meera', 'request', 'Access request', 'Dr. Arvind Rao (Lakeview Hospital) requested access to your medical history, medications and lab reports for 24 hours.', ago(3), '/app/access?tab=requests'),
    n('u_meera', 'reminder', 'Access expires tomorrow', 'Dr. Priya Sharma’s access to your records ends tomorrow. You can extend or revoke it anytime.', ago(2), '/app/access'),
    n('u_meera', 'access', 'Access expired', 'Dr. Rahul Kumar can no longer see your records.', ago(25), '/app/access?tab=history', true),
    n('u_meera', 'record', 'New consultation added', 'Dr. Priya Sharma added a consultation, a diagnosis and a prescription to your medical record.', '2026-09-24T05:42:00.000Z', '/app/timeline?record=r_cons_2026', true),
    n('u_meera', 'record', 'New lab report', 'Your CBC and HbA1c results from Sunrise Diagnostics were added.', '2026-08-11T12:00:00.000Z', '/app/timeline?record=r_lab_cbc', true),
    n('u_priya', 'access', 'Access granted', 'Rohan Desai gave you access to their records for 7 days.', ago(5), '/doctor/patients/p_rohan'),
    n('u_priya', 'access', 'Access granted', 'Meera Iyer gave you access to their records for 3 days.', ago(52), '/doctor/patients/p_meera', true),
  ];

  const sessions: Session[] = [
    { id: 's_seed_phone', userId: 'u_meera', device: 'Pixel 8 · Chrome for Android', location: 'Hyderabad, IN', createdAt: ago(30), lastActiveAt: ago(6), expiresAt: addHours(ago(30), 24 * 14) },
    { id: 's_seed_laptop', userId: 'u_meera', device: 'Windows laptop · Edge', location: 'Hyderabad, IN', createdAt: ago(200), lastActiveAt: ago(80), expiresAt: addHours(ago(200), 24 * 14) },
  ];

  /* ---- Medication reminders + a week of dose history ---- */
  const reminders: MedicationReminder[] = [];
  const doseLogs: DoseLog[] = [];
  const nowD = new Date();
  for (const r of records.filter((x) => x.type === 'medication')) {
    const times = defaultTimes(String(r.data.frequency));
    reminders.push({ recordId: r.id, patientId: r.patientId, times, enabled: times.length > 0, updatedAt: r.createdAt });
  }
  // Meera took most doses; a couple were skipped or missed.
  for (let i = 1; i <= 7; i++) {
    const date = toISODate(addDays(nowD, -i));
    if (i !== 3) doseLogs.push({ id: `dl_c_${i}`, patientId: meera.id, recordId: 'r_med_cetirizine', date, time: '08:00', status: 'taken', loggedAt: `${date}T08:0${i}:00` });
    doseLogs.push({ id: `dl_m_${i}`, patientId: meera.id, recordId: 'r_med_montelukast', date, time: '21:00', status: i === 5 ? 'skipped' : 'taken', loggedAt: `${date}T21:1${i}:00` });
  }

  return {
    schemaVersion: 1,
    reminders, doseLogs,
    users, patients, doctors, hospitals, records, documents, grants, requests, invites: [],
    audit, notifications, sessions, preferences: {},
  };
}

