import type { Hospital, Preferences } from '../types';
import { getDb, mutate } from '../mock/db';
import { requireCtx } from './core';


export const DEFAULT_PREFS: Preferences = { theme: 'system', language: 'en', notifyRecords: true, notifyAccess: true, notifyReminders: true };

export const settingsService = {
  async get(): Promise<Preferences> {
    const ctx = await requireCtx();
    return { ...DEFAULT_PREFS, ...ctx.db.preferences[ctx.user.id] };
  },
  async update(patch: Partial<Preferences>): Promise<Preferences> {
    const ctx = await requireCtx();
    return mutate((db) => {
      const next = { ...DEFAULT_PREFS, ...db.preferences[ctx.user.id], ...patch };
      db.preferences[ctx.user.id] = next;
      return next;
    });
  },
  async hospitals(): Promise<Hospital[]> {
    return (await getDb()).hospitals;
  },
};

