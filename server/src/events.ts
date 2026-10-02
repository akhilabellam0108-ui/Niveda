/**
 * Live updates over Server-Sent Events. When something changes, every open app that
 * can see it gets a "change" event and re-fetches. Single-process; for several
 * server instances, swap this for Postgres LISTEN/NOTIFY or Redis pub/sub.
 */
import type { Response } from 'express';

class EventHub {
  private clients = new Map<string, Set<Response>>();

  add(userId: string, res: Response) {
    if (!this.clients.has(userId)) this.clients.set(userId, new Set());
    this.clients.get(userId)!.add(res);
    res.on('close', () => this.clients.get(userId)?.delete(res));
  }

  touchUsers(userIds: (string | undefined)[]) {
    for (const id of new Set(userIds)) {
      if (!id) continue;
      for (const res of this.clients.get(id) ?? []) res.write(`event: change\ndata: {}\n\n`);
    }
  }

  heartbeat() {
    for (const set of this.clients.values()) for (const res of set) res.write(': ping\n\n');
  }
}

export const events = new EventHub();
