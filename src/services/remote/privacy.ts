/** DPDP Act rights on the live backend; the database enforces each rule. */
import type { ConsentRecord, DeletionRequest, Grievance } from '../../types';
import { brand } from '../../config/brand';
import type { Nominee, privacyService as DemoPrivacy } from '../privacyService';
import { read, write, requireAccount, sb } from './client';
import { stepUp } from './auth';

export const remotePrivacyService: typeof DemoPrivacy = {
  async consents() {
    return read<ConsentRecord[]>('my_consents');
  },
  async setConsent(purpose, granted) {
    await write('record_consent', { p_purpose: purpose, p_granted: granted, p_notice_version: brand.privacyNoticeVersion });
  },
  async nominee() {
    const a = await requireAccount();
    const { data } = await sb().from('patients').select('nominee').eq('id', a.profileId).maybeSingle();
    return (data?.nominee as Nominee | null) ?? null;
  },
  async setNominee(n) {
    await write('set_nominee', { p: n });
  },
  async deletionRequest() {
    return (await read<DeletionRequest | null>('my_deletion_request')) ?? null;
  },
  requestDeletionCode() {
    return stepUp.request('delete_account');
  },
  async requestDeletion(code, reason) {
    await stepUp.verify(code);
    return write<DeletionRequest>('request_deletion', { p_reason: reason ?? null });
  },
  async cancelDeletion() {
    await write('cancel_deletion');
  },
  async grievances() {
    return read<Grievance[]>('my_grievances');
  },
  async fileGrievance(category, description) {
    return write<Grievance>('file_grievance', { p_category: category, p_description: description });
  },
  async adminGrievances(status) {
    return read<Grievance[]>('admin_grievances', { p_status: status ?? null });
  },
  async adminRespond(id, status, response) {
    await write('admin_respond_grievance', { p_id: id, p_status: status, p_response: response });
  },
};
