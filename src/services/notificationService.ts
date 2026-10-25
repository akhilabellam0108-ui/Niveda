import type { Notification } from '../types';
import { delay, mutate, mutateQuiet } from '../mock/db';
import { managedBy, requireCtx, type Ctx } from './core';
import { sweepVaccines } from './familyService';

/** Vaccine reminders for the children this person looks after (a daily job on the live backend). */
async function remindVaccines(ctx: Ctx) {
  const me = ctx.self ?? ctx.patient;
  if (!me) return;
  await mutateQuiet((db) => {
    let changed = false;
    for (const g of managedBy(db, me.id)) changed = sweepVaccines(db, g.childId) || changed;
    return changed;
  });
}


export const notificationService = {
  async list(): Promise<Notification[]> {
    await delay();
    const ctx = await requireCtx();
    await remindVaccines(ctx);
    return ctx.db.notifications.filter((n) => n.userId === ctx.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async unreadCount(): Promise<number> {
    const ctx = await requireCtx();
    await remindVaccines(ctx);
    return ctx.db.notifications.filter((n) => n.userId === ctx.user.id && !n.read).length;
  },
  async markRead(id: string): Promise<void> {
    const ctx = await requireCtx();
    await mutate((db) => {
      const n = db.notifications.find((x) => x.id === id && x.userId === ctx.user.id);
      if (n) n.read = true;
    });
  },
  async markAllRead(): Promise<void> {
    const ctx = await requireCtx();
    await mutate((db) => db.notifications.forEach((n) => { if (n.userId === ctx.user.id) n.read = true; }));
  },
};

