/**
 * Which backend the app talks to.
 *
 * - Demo (default): everything runs in this browser with fictional data. This is
 *   what the public GitHub Pages demo uses.
 * - Live: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example)
 *   and the app uses the Supabase project instead — real accounts, emailed
 *   codes, and access rules enforced by the database.
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const backend = {
  supabaseUrl: env.VITE_SUPABASE_URL?.trim() || undefined,
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY?.trim() || undefined,
  /** Public VAPID key for medicine reminders by Web Push (live mode). Optional. */
  vapidPublicKey: env.VITE_VAPID_PUBLIC_KEY?.trim() || undefined,
};

/** True when the app is connected to a real Supabase project. */
export const isLive = !!(backend.supabaseUrl && backend.supabaseAnonKey);
