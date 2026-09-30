/**
 * Doctor applications and their review by the Niveda team.
 *
 * These need real accounts (the registration check is done by people on the
 * Niveda team), so in the demo they explain that and do nothing. The live
 * versions are in ./remote/applications.ts.
 */
import type { DoctorApplication, DoctorApplicationInput, EmergencyAccessReview } from '../types';
import { AppError } from './core';

export const DEMO_ONLY_MESSAGE = 'Doctor sign-up works once Niveda is connected to its live backend. In this demo, use the demo doctor account to look around.';

export const MEDICAL_COUNCILS = [
  'National Medical Commission (Indian Medical Register)',
  'Andhra Pradesh Medical Council', 'Assam Medical Council', 'Bihar Council of Medical Registration', 'Chhattisgarh Medical Council',
  'Delhi Medical Council', 'Goa Medical Council', 'Gujarat Medical Council', 'Haryana Medical Council', 'Himachal Pradesh Medical Council',
  'Jammu & Kashmir Medical Council', 'Jharkhand Medical Council', 'Karnataka Medical Council', 'Travancore-Cochin Medical Council (Kerala)',
  'Madhya Pradesh Medical Council', 'Maharashtra Medical Council', 'Manipur Medical Council', 'Mizoram Medical Council', 'Nagaland Medical Council',
  'Odisha Council of Medical Registration', 'Punjab Medical Council', 'Rajasthan Medical Council', 'Sikkim Medical Council',
  'Tamil Nadu Medical Council', 'Telangana State Medical Council', 'Tripura State Medical Council', 'Uttar Pradesh Medical Council',
  'Uttarakhand Medical Council', 'West Bengal Medical Council',
] as const;

/** Where the Niveda team checks a registration (opens in a new tab). */
export const REGISTER_CHECK_URL = 'https://www.nmc.org.in/information-desk/indian-medical-register/';

/** Checks the form in the browser; the database checks everything again. */
export function validateApplication(f: DoctorApplicationInput): Record<string, string> {
  const v: Record<string, string> = {};
  if (f.fullName.trim().length < 3) v.fullName = 'Enter your full name as it appears on your registration';
  if (f.phone.replace(/\D/g, '').length < 10) v.phone = 'Enter a 10-digit mobile number';
  if (f.registrationNumber.trim().length < 3) v.registrationNumber = 'Enter your medical registration number';
  if (!f.medicalCouncil) v.medicalCouncil = 'Choose the council you are registered with';
  const year = Number(f.registrationYear);
  if (f.registrationYear && (!Number.isInteger(year) || year < 1940 || year > new Date().getFullYear())) v.registrationYear = 'Check the year';
  if (f.specialization.trim().length < 2) v.specialization = 'Enter your specialisation';
  if (f.qualifications.trim().length < 2) v.qualifications = 'For example MBBS, MD';
  const yrs = Number(f.yearsOfPractice || 0);
  if (!Number.isInteger(yrs) || yrs < 0 || yrs > 70) v.yearsOfPractice = 'Check your years of practice';
  if (f.hospitalName.trim().length < 2) v.hospitalName = 'Enter where you work';
  if (f.hospitalCity.trim().length < 2) v.hospitalCity = 'Enter the city';
  return v;
}

export const applicationService = {
  async mine(): Promise<DoctorApplication | null> {
    return null;
  },
  async update(_input: DoctorApplicationInput): Promise<DoctorApplication> {
    throw new AppError('VALIDATION', DEMO_ONLY_MESSAGE);
  },
};

export const adminService = {
  async applications(_status: 'pending' | 'approved' | 'declined' | 'all' = 'pending'): Promise<DoctorApplication[]> {
    return [];
  },
  async review(_id: string, _decision: 'approve' | 'decline', _note?: string): Promise<DoctorApplication> {
    throw new AppError('ACCESS_DENIED', 'Only the Niveda team can do this.');
  },
  async emergencyAccesses(_status: 'pending' | 'appropriate' | 'concern' | 'all' = 'pending'): Promise<EmergencyAccessReview[]> {
    return [];
  },
  async reviewEmergency(_id: string, _outcome: 'appropriate' | 'concern', _note?: string): Promise<void> {
    throw new AppError('ACCESS_DENIED', 'Only the Niveda team can do this.');
  },
};
