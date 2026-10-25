import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, FilePlus2, ShieldCheck, Inbox, LockKeyhole, Clock3 } from 'lucide-react';
import type { Notification } from '../../types';
import { notificationService } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { brand } from '../../config/brand';
import { relativeTime, fmtDateTime } from '../../lib/dates';
import { Button, Card, EmptyState, ErrorState, SkeletonList } from '../../components/ui';

import { t } from '../../i18n';
import { tServer } from '../../i18n/serverText';
const KIND_ICON = { record: [FilePlus2, 'tone-accent'], access: [ShieldCheck, 'tone-ok'], request: [Inbox, 'tone-info'], security: [LockKeyhole, 'tone-warn'], reminder: [Clock3, 'tone-warn'] } as const;

/** Shared by patients and doctors. */
export function NotificationsPage() {
  useDocumentTitle(`${t('Notifications')} · ${brand.name}`);
  const navigate = useNavigate();
  const list = useLive(() => notificationService.list(), []);
  const unread = (list.data ?? []).filter((n) => !n.read).length;
  const open = async (n: Notification) => {
    if (!n.read) await notificationService.markRead(n.id);
    if (n.link) navigate(n.link);
  };
  return (
    <>
      <div className="page-head">
        <div><h1>{t('Notifications')}</h1><p>{t('New entries in your record, access changes and security alerts.')}</p></div>
        {unread > 0 && <Button icon={CheckCheck} onClick={() => notificationService.markAllRead()}>{t('Mark all as read')}</Button>}
      </div>
      {list.error ? <ErrorState error={list.error} title={t('Unable to load notifications')} onRetry={list.reload} /> : !list.data ? <SkeletonList rows={5} /> : list.data.length === 0 ? (
        <div className="card"><EmptyState icon={Bell} title={t('You’re all caught up')} body={t('We’ll let you know when something is added to your record or when access changes.')} /></div>
      ) : (
        <Card>
          <ul className="list">
            {list.data.map((n) => {
              const [Icon, tone] = KIND_ICON[n.kind];
              return (
                <li key={n.id}>
                  <button className={`notif ${n.read ? '' : 'unread'}`} onClick={() => open(n)} aria-label={`${n.read ? '' : `${t('Unread:')} `}${tServer(n.title)}. ${tServer(n.body)}`}>
                    <span className={`type-icon sm ${tone}`} aria-hidden><Icon /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="spread"><span className="strong small">{tServer(n.title)}</span><span className="xs subtle nowrap" title={fmtDateTime(n.createdAt)}>{relativeTime(n.createdAt)}</span></span>
                      <span className="small muted" style={{ display: 'block', marginTop: 2 }}>{tServer(n.body)}</span>
                    </span>
                    {!n.read && <span className="unread-dot" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
