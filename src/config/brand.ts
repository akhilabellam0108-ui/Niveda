/**
 * Central brand configuration. Change the product name, tagline or colours here
 * and they update everywhere in the app.
 */
export const brand = {
  name: 'Niveda',
  tagline: 'Your health. Your history. Your control.',
  shortDescription:
    'One lifelong health record that you own. Doctors add to it only when you let them, and every access is logged.',
  supportEmail: 'support@niveda.example',
  /** The legal entity that decides how personal data is used (the "Data Fiduciary"). */
  dataFiduciary: 'Niveda',
  /** DPDP Act s.8(9)/s.13: the person who answers privacy questions and grievances. Set real details before launch. */
  grievanceOfficer: { name: 'Grievance Officer, Niveda', email: 'grievance@niveda.example' },
  /** Bump when the privacy notice changes; people are asked to agree to the new version. */
  privacyNoticeVersion: '2026-10',
  /** Set to true once a lawyer has reviewed the privacy notice and terms. */
  legalReviewed: false,
  patientIdPrefix: 'NV',
  /** The newest Android app, published by .github/workflows/android.yml. */
  androidAppUrl: 'https://github.com/akhilabellam0108-ui/Niveda/releases/download/android-latest/Niveda.apk',
} as const;

/** Where a prototype stands in for real infrastructure. Shown in the UI so nobody mistakes it for production. */
export const PROTOTYPE_NOTICE =
  'Prototype: data is stored only in this browser and sign-in is simulated. Do not enter real medical information.';
