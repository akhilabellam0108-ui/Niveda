import type { PermissionKey, RecordData, RecordType, MedicalRecord } from './types';

export type FieldKind = 'text' | 'textarea' | 'date' | 'select' | 'number';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
  /** Span the full row in two-column layouts. */
  wide?: boolean;
}

export interface RecordTypeMeta {
  type: RecordType;
  label: string;
  plural: string;
  permission: PermissionKey;
  /** Field used as the record's headline. */
  titleKey: string;
  /** Fields shown as the one-line summary on cards. */
  summaryKeys: string[];
  fields: FieldDef[];
  /** Whether a patient can add this type themselves. */
  patientCanAdd: boolean;
  /** Whether a doctor can add this type. */
  doctorCanAdd: boolean;
}

const doctorField: FieldDef = { key: 'doctor', label: 'Doctor', kind: 'text', placeholder: 'e.g. Dr. Kavya Menon' };
const facilityField: FieldDef = { key: 'facility', label: 'Hospital / clinic', kind: 'text', placeholder: 'e.g. Northbridge Hospital' };
const notesField: FieldDef = { key: 'notes', label: 'Notes', kind: 'textarea', wide: true };

export const RECORD_TYPES: Record<RecordType, RecordTypeMeta> = {
  consultation: {
    type: 'consultation', label: 'Consultation', plural: 'Consultations', permission: 'history',
    titleKey: 'reason', summaryKeys: ['diagnosis'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'reason', label: 'Reason for visit', kind: 'text', required: true, placeholder: 'e.g. Persistent cough', wide: true },
      doctorField, facilityField,
      { key: 'symptoms', label: 'Symptoms', kind: 'textarea', wide: true },
      { key: 'diagnosis', label: 'Diagnosis', kind: 'text', wide: true },
      { key: 'medications', label: 'Medications discussed', kind: 'textarea', wide: true, help: 'For prescriptions that should appear in your medication list, add a Medication record.' },
      { key: 'followUp', label: 'Follow-up date', kind: 'date' },
      notesField,
    ],
  },
  diagnosis: {
    type: 'diagnosis', label: 'Diagnosis', plural: 'Diagnoses', permission: 'history',
    titleKey: 'condition', summaryKeys: ['severity'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'condition', label: 'Condition', kind: 'text', required: true, wide: true },
      { key: 'status', label: 'Status', kind: 'select', options: ['Active', 'Managed', 'Resolved', 'Suspected'], required: true },
      { key: 'severity', label: 'Severity', kind: 'select', options: ['', 'Mild', 'Moderate', 'Severe', 'Critical'] },
      doctorField, facilityField, notesField,
    ],
  },
  medication: {
    type: 'medication', label: 'Medication', plural: 'Medications', permission: 'medications',
    titleKey: 'name', summaryKeys: ['dosage', 'frequency'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'name', label: 'Medicine name', kind: 'text', required: true, placeholder: 'e.g. Amoxicillin' },
      { key: 'dosage', label: 'Dosage', kind: 'text', required: true, placeholder: 'e.g. 500 mg' },
      { key: 'frequency', label: 'Frequency', kind: 'select', required: true, options: ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Every night', 'Weekly', 'As needed'] },
      { key: 'endDate', label: 'End date', kind: 'date', help: 'Leave empty for ongoing medicines.' },
      { key: 'prescriber', label: 'Prescribing doctor', kind: 'text' },
      { key: 'reason', label: 'Reason / condition', kind: 'text' },
      { key: 'instructions', label: 'Instructions', kind: 'textarea', wide: true, placeholder: 'e.g. After food' },
    ],
  },
  allergy: {
    type: 'allergy', label: 'Allergy', plural: 'Allergies', permission: 'allergies',
    titleKey: 'allergen', summaryKeys: ['reaction', 'severity'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'allergen', label: 'Allergen', kind: 'text', required: true, placeholder: 'e.g. Penicillin' },
      { key: 'severity', label: 'Severity', kind: 'select', required: true, options: ['Mild', 'Moderate', 'Severe', 'Life-threatening'] },
      { key: 'reaction', label: 'Reaction', kind: 'text', required: true, wide: true, placeholder: 'e.g. Hives, swelling' },
      notesField,
    ],
  },
  surgery: {
    type: 'surgery', label: 'Surgery', plural: 'Surgeries', permission: 'surgeries',
    titleKey: 'procedure', summaryKeys: ['facility', 'outcome'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'procedure', label: 'Procedure', kind: 'text', required: true, wide: true },
      { key: 'surgeon', label: 'Surgeon', kind: 'text' }, facilityField,
      { key: 'reason', label: 'Reason', kind: 'text', wide: true },
      { key: 'outcome', label: 'Outcome', kind: 'select', options: ['', 'Successful', 'Successful with complications', 'Ongoing recovery', 'Unsuccessful'] },
      notesField,
    ],
  },
  procedure: {
    type: 'procedure', label: 'Procedure', plural: 'Procedures', permission: 'surgeries',
    titleKey: 'procedure', summaryKeys: ['facility', 'doctor'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'procedure', label: 'Procedure', kind: 'text', required: true, wide: true },
      doctorField, facilityField,
      { key: 'reason', label: 'Reason', kind: 'text', wide: true },
      { key: 'outcome', label: 'Outcome', kind: 'text' }, notesField,
    ],
  },
  lab_test: {
    type: 'lab_test', label: 'Lab test', plural: 'Lab tests', permission: 'labs',
    titleKey: 'test', summaryKeys: ['status', 'laboratory'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'test', label: 'Test', kind: 'text', required: true, placeholder: 'e.g. HbA1c' },
      { key: 'status', label: 'Status', kind: 'select', options: ['Ordered', 'Sample collected', 'Completed', 'Cancelled'], required: true },
      { key: 'laboratory', label: 'Laboratory', kind: 'text' },
      { key: 'orderedBy', label: 'Ordered by', kind: 'text' },
      { key: 'reason', label: 'Reason', kind: 'text', wide: true },
    ],
  },
  lab_result: {
    type: 'lab_result', label: 'Lab result', plural: 'Lab results', permission: 'labs',
    titleKey: 'test', summaryKeys: ['result', 'status'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'test', label: 'Test name', kind: 'text', required: true },
      { key: 'laboratory', label: 'Laboratory', kind: 'text' },
      { key: 'result', label: 'Result', kind: 'text', required: true, placeholder: 'e.g. 13.1 g/dL' },
      { key: 'referenceRange', label: 'Reference range', kind: 'text', placeholder: 'e.g. 12.0 – 15.5 g/dL' },
      { key: 'status', label: 'Status', kind: 'select', options: ['Normal', 'Borderline', 'Abnormal', 'Critical'], required: true },
      notesField,
    ],
  },
  imaging: {
    type: 'imaging', label: 'Imaging', plural: 'Imaging & scans', permission: 'imaging',
    titleKey: 'study', summaryKeys: ['findings', 'facility'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'study', label: 'Study', kind: 'text', required: true, placeholder: 'e.g. Chest X-ray' },
      { key: 'modality', label: 'Type', kind: 'select', options: ['X-ray', 'Ultrasound', 'CT', 'MRI', 'PET', 'Mammogram', 'Other'] },
      facilityField,
      { key: 'findings', label: 'Findings', kind: 'textarea', wide: true },
      { key: 'impression', label: 'Impression', kind: 'text', wide: true },
    ],
  },
  vaccination: {
    type: 'vaccination', label: 'Vaccination', plural: 'Vaccinations', permission: 'vaccinations',
    titleKey: 'vaccine', summaryKeys: ['dose', 'facility'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'vaccine', label: 'Vaccine', kind: 'text', required: true },
      { key: 'dose', label: 'Dose', kind: 'text', placeholder: 'e.g. Booster' },
      facilityField,
      { key: 'batch', label: 'Batch number', kind: 'text' },
      { key: 'nextDue', label: 'Next dose due', kind: 'date' },
    ],
  },
  hospitalization: {
    type: 'hospitalization', label: 'Hospitalisation', plural: 'Hospitalisations', permission: 'history',
    titleKey: 'reason', summaryKeys: ['facility', 'dischargeDate'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'reason', label: 'Reason for admission', kind: 'text', required: true, wide: true },
      facilityField,
      { key: 'dischargeDate', label: 'Discharge date', kind: 'date' },
      { key: 'attendingDoctor', label: 'Attending doctor', kind: 'text' },
      { key: 'summary', label: 'Discharge summary', kind: 'textarea', wide: true },
    ],
  },
  mental_health: {
    type: 'mental_health', label: 'Mental health', plural: 'Mental health', permission: 'mental_health',
    titleKey: 'topic', summaryKeys: ['provider'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'topic', label: 'Topic', kind: 'text', required: true, placeholder: 'e.g. Counselling session' },
      { key: 'provider', label: 'Provider', kind: 'text' },
      notesField,
    ],
  },
  family_history: {
    type: 'family_history', label: 'Family history', plural: 'Family history', permission: 'history',
    titleKey: 'condition', summaryKeys: ['relative'], patientCanAdd: true, doctorCanAdd: true,
    fields: [
      { key: 'condition', label: 'Condition', kind: 'text', required: true },
      { key: 'relative', label: 'Relative', kind: 'select', options: ['Mother', 'Father', 'Sibling', 'Grandparent', 'Child', 'Other'], required: true },
      notesField,
    ],
  },
  follow_up: {
    type: 'follow_up', label: 'Follow-up', plural: 'Follow-ups', permission: 'history',
    titleKey: 'purpose', summaryKeys: ['doctor'], patientCanAdd: false, doctorCanAdd: true,
    fields: [
      { key: 'purpose', label: 'Purpose', kind: 'text', required: true, wide: true },
      doctorField, facilityField, notesField,
    ],
  },
  clinical_note: {
    type: 'clinical_note', label: 'Clinical note', plural: 'Clinical notes', permission: 'history',
    titleKey: 'subject', summaryKeys: ['doctor'], patientCanAdd: false, doctorCanAdd: true,
    fields: [
      { key: 'subject', label: 'Subject', kind: 'text', required: true, wide: true },
      { key: 'note', label: 'Note', kind: 'textarea', required: true, wide: true },
    ],
  },
  other: {
    type: 'other', label: 'Other', plural: 'Other records', permission: 'sensitive',
    titleKey: 'title', summaryKeys: ['facility'], patientCanAdd: true, doctorCanAdd: false,
    fields: [
      { key: 'title', label: 'Title', kind: 'text', required: true, wide: true },
      facilityField, notesField,
    ],
  },
};

export const RECORD_TYPE_LIST = Object.values(RECORD_TYPES);

/** Categories shown on the Medical Records page. */
export interface RecordCategory {
  key: string;
  label: string;
  types: RecordType[];
}

export const RECORD_CATEGORIES: RecordCategory[] = [
  { key: 'consultations', label: 'Consultations', types: ['consultation', 'follow_up', 'clinical_note'] },
  { key: 'diagnoses', label: 'Diagnoses', types: ['diagnosis'] },
  { key: 'medications', label: 'Medications', types: ['medication'] },
  { key: 'allergies', label: 'Allergies', types: ['allergy'] },
  { key: 'surgeries', label: 'Surgeries & procedures', types: ['surgery', 'procedure'] },
  { key: 'labs', label: 'Lab results', types: ['lab_test', 'lab_result'] },
  { key: 'imaging', label: 'Imaging & scans', types: ['imaging'] },
  { key: 'vaccinations', label: 'Vaccinations', types: ['vaccination'] },
  { key: 'mental_health', label: 'Mental health', types: ['mental_health'] },
  { key: 'hospitalizations', label: 'Hospitalisations', types: ['hospitalization'] },
  { key: 'family', label: 'Family history', types: ['family_history'] },
  { key: 'other', label: 'Other records', types: ['other'] },
];

export const categoryOf = (type: RecordType) => RECORD_CATEGORIES.find((c) => c.types.includes(type))!;

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  description: string;
  sensitive?: boolean;
  defaultOn: boolean;
}

export const PERMISSIONS: PermissionMeta[] = [
  { key: 'history', label: 'Medical history', description: 'Consultations, diagnoses, hospital stays, family history', defaultOn: true },
  { key: 'medications', label: 'Medications', description: 'Current and past medicines', defaultOn: true },
  { key: 'allergies', label: 'Allergies', description: 'Allergies and reactions', defaultOn: true },
  { key: 'labs', label: 'Lab reports', description: 'Lab tests and results', defaultOn: true },
  { key: 'imaging', label: 'Imaging', description: 'X-rays, scans and their reports', defaultOn: true },
  { key: 'surgeries', label: 'Surgeries & procedures', description: 'Operations and procedures', defaultOn: true },
  { key: 'vaccinations', label: 'Vaccinations', description: 'Vaccines and due dates', defaultOn: true },
  { key: 'mental_health', label: 'Mental-health records', description: 'Counselling and mental-health notes', sensitive: true, defaultOn: false },
  { key: 'sensitive', label: 'Other sensitive records', description: 'Anything you filed under "Other"', sensitive: true, defaultOn: false },
];

export const permissionLabel = (k: PermissionKey) => PERMISSIONS.find((p) => p.key === k)?.label ?? k;
export const DEFAULT_PERMISSIONS = PERMISSIONS.filter((p) => p.defaultOn).map((p) => p.key);

export function recordTitle(r: Pick<MedicalRecord, 'type' | 'data'>): string {
  const meta = RECORD_TYPES[r.type];
  const v = r.data[meta.titleKey];
  return (v !== undefined && String(v).trim()) || meta.label;
}

export function recordSummary(r: Pick<MedicalRecord, 'type' | 'data'>): string {
  const meta = RECORD_TYPES[r.type];
  return meta.summaryKeys
    .map((k) => r.data[k])
    .filter((v) => v !== undefined && String(v).trim() !== '')
    .join(' · ');
}

export function fieldLabel(type: RecordType, key: string): string {
  if (key === 'startDate') return 'Start date';
  return RECORD_TYPES[type].fields.find((f) => f.key === key)?.label ?? key;
}

/** Keeps only fields declared for a type and trims strings. */
export function cleanData(type: RecordType, data: RecordData): RecordData {
  const out: RecordData = {};
  const known = new Set(RECORD_TYPES[type].fields.map((f) => f.key));
  for (const [k, v] of Object.entries(data)) {
    if (!known.has(k) && !INTERNAL_KEYS.has(k)) continue;
    if (v === undefined) continue;
    const s = typeof v === 'string' ? v.trim() : v;
    if (s === '') continue;
    out[k] = s;
  }
  return out;
}

/** Keys the system manages that aren't user-editable fields. */
export const INTERNAL_KEYS = new Set(['medStatus', 'discontinuedOn', 'discontinueReason', 'resultRecordId', 'orderRecordId']);

export function validateData(type: RecordType, data: RecordData): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of RECORD_TYPES[type].fields) {
    const v = data[f.key];
    if (f.required && (v === undefined || String(v).trim() === '')) errors[f.key] = `${f.label} is required`;
  }
  return errors;
}

export const ALLERGY_SEVERITY_RANK: Record<string, number> = { Mild: 1, Moderate: 2, Severe: 3, 'Life-threatening': 4 };
export const isSevereAllergy = (r: MedicalRecord) => (ALLERGY_SEVERITY_RANK[String(r.data.severity)] ?? 0) >= 3;
