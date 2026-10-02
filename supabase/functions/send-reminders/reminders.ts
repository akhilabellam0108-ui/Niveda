/**
 * Sends the medicine reminders that are due right now. Kept free of Deno and
 * network specifics so it can be tested in Node (tests/push.test.mjs);
 * index.ts wires it to Supabase and Web Push.
 */
export interface DueMessage {
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  tag: string;
  url: string;
  token: string;
}

export interface Deps {
  /** Calls public._due_push_reminders() with the service role. */
  due(): Promise<DueMessage[]>;
  /** Sends one encrypted Web Push message; rejects with { statusCode } on failure. */
  send(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string): Promise<unknown>;
  /** Forgets a device the push service says no longer exists. */
  gone(endpoint: string): Promise<unknown>;
  /** Where "Taken" on the notification goes (public; the token is the credential). */
  takenUrl: string;
  /** The project's public (anon / publishable) key, needed by the REST API. */
  publicKey: string;
}

export async function sendDueReminders(d: Deps) {
  const messages = await d.due();
  let sent = 0;
  let removed = 0;
  let failed = 0;
  await Promise.all(messages.map(async (m) => {
    const payload = JSON.stringify({
      title: m.title, body: m.body, tag: m.tag, url: m.url,
      taken: { url: d.takenUrl, key: d.publicKey, token: m.token },
    });
    try {
      await d.send({ endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } }, payload);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await d.gone(m.endpoint); removed++; } else failed++;
    }
  }));
  return { due: messages.length, sent, removed, failed };
}
