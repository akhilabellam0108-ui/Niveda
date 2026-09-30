/** Live doctor applications and their review (rules enforced by the database). */
import type { DoctorApplication, DoctorApplicationInput } from '../../types';
import type { adminService as DemoAdmin, applicationService as DemoApplications } from '../applicationService';
import { read, write } from './client';

export const remoteApplicationService: typeof DemoApplications = {
  mine: () => read<DoctorApplication | null>('my_doctor_application'),
  update: (input: DoctorApplicationInput) => write<DoctorApplication>('update_doctor_application', { p: input }),
};

export const remoteAdminService: typeof DemoAdmin = {
  applications: async (status = 'pending') => read<DoctorApplication[]>('admin_doctor_applications', { p_status: status }),
  review: (id, decision, note) => write<DoctorApplication>('admin_review_doctor_application', { p_id: id, p_decision: decision, p_note: note ?? null }),
};
