import type { Notification } from '../types';
import { delay, mutate } from '../mock/db';
import { requireCtx } from './core';


export const notificationService = {
  async list(): Promise<Notification[]> {
    await delay();
    const ctx = await requireCtx();
    return ctx.db.notifications.filter((n) => n.userId === ctx.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async unreadCount(): Promise<number> {
    const ctx = await requireCtx();
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

