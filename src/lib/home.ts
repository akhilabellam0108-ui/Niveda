import type { User } from '../types';

/** Where a signed-in person belongs. */
export function homeFor(user: Pick<User, 'role' | 'onboarded'>): string {
  if (user.role === 'doctor') return '/doctor';
  if (user.role === 'applicant') return '/doctor-application';
  return user.onboarded ? '/app' : '/onboarding';
}
