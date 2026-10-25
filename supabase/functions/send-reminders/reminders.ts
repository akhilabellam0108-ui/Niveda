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
  /** The person's interface language (preferences.prefs->>'language'), e.g. 'hi'. */
  lang?: string;
}

/** The push title and buttons in each interface language (keep in step with src/i18n/locales). */
export const PUSH_TEXT: Record<string, { title: string; taken: string; open: string }> = {
  en: { title: 'Time for your medicine', taken: 'Taken', open: 'Open' },
  hi: { title: 'दवा लेने का समय', taken: 'ले ली', open: 'खोलें' },
  bn: { title: 'ওষুধ খাওয়ার সময়', taken: 'খেয়েছি', open: 'খুলুন' },
  mr: { title: 'औषध घेण्याची वेळ', taken: 'घेतले', open: 'उघडा' },
  te: { title: 'మందు వేసుకునే సమయం', taken: 'వేసుకున్నాను', open: 'తెరవండి' },
  ta: { title: 'மருந்து எடுக்கும் நேரம்', taken: 'எடுத்தேன்', open: 'திற' },
  gu: { title: 'દવા લેવાનો સમય', taken: 'લીધી', open: 'ખોલો' },
  kn: { title: 'ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯ', taken: 'ತೆಗೆದುಕೊಂಡೆ', open: 'ತೆರೆಯಿರಿ' },
  ml: { title: 'മരുന്ന് കഴിക്കാനുള്ള സമയം', taken: 'കഴിച്ചു', open: 'തുറക്കുക' },
};

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
    const text = PUSH_TEXT[m.lang ?? 'en'] ?? PUSH_TEXT.en;
    const payload = JSON.stringify({
      title: m.title === PUSH_TEXT.en.title ? text.title : m.title, body: m.body, tag: m.tag, url: m.url,
      labels: { taken: text.taken, open: text.open },
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
