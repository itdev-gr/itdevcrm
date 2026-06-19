import { AlertTriangle, AtSign, Bell, CheckCircle2 } from 'lucide-react';
import { relativeFromNow } from '@/lib/datetime';
import { cn } from '@/lib/utils';

export type NotifPayload = Record<string, unknown> | null;

export function readPath(parentType: unknown, parentId: unknown): string | null {
  if (typeof parentId !== 'string') return null;
  switch (parentType) {
    case 'lead':
      return `/leads/${parentId}`;
    case 'client':
      return `/clients/${parentId}`;
    case 'deal':
      return `/deals/${parentId}`;
    case 'job':
      return `/jobs/${parentId}`;
    default:
      return null;
  }
}

export function readString(p: NotifPayload, key: string): string | null {
  if (!p) return null;
  const v = p[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function NotifIcon({ type, className }: { type: string; className?: string }) {
  const iconClass = cn('size-3.5 shrink-0', className);
  switch (type) {
    case 'mention':
      return <AtSign className={cn(iconClass, 'text-primary')} />;
    case 'task_assigned':
    case 'task_resolved':
      return <CheckCircle2 className={cn(iconClass, 'text-emerald-600 dark:text-emerald-400')} />;
    case 'payment_overdue':
      return <AlertTriangle className={cn(iconClass, 'text-red-600 dark:text-red-400')} />;
    default:
      return <Bell className={cn(iconClass, 'text-muted-foreground')} />;
  }
}

export function notificationShellClass(isRead: boolean) {
  return cn(
    'flex gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug transition-colors',
    isRead
      ? 'border-border/40 bg-muted/30'
      : 'border-primary/15 bg-primary/5',
  );
}

export function CompactNotificationContent({
  type,
  payload,
  parentLabel,
  isRead,
  createdAt,
}: {
  type: string;
  payload: NotifPayload;
  parentLabel: string | null;
  isRead: boolean;
  createdAt: string;
}) {
  const titleClass = isRead ? 'text-muted-foreground' : 'font-medium text-foreground';
  const when = relativeFromNow(createdAt);

  if (type === 'mention') {
    const author = readString(payload, 'author_name');
    const preview = readString(payload, 'preview');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          <span className="font-semibold">{author ?? 'Someone'}</span> mentioned you
          {parentLabel && (
            <>
              {' '}
              on <span className="font-semibold">{parentLabel}</span>
            </>
          )}
        </p>
        {preview && (
          <p className="mt-0.5 truncate text-muted-foreground italic">&ldquo;{preview}&rdquo;</p>
        )}
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'task_assigned') {
    const code = readString(payload, 'source_code');
    const title = readString(payload, 'title');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          Task assigned
          {code && (
            <>
              {' '}
              <span className="rounded bg-muted px-1 py-px font-mono text-[10px]">{code}</span>
            </>
          )}
        </p>
        {title && <p className="mt-0.5 truncate text-muted-foreground">{title}</p>}
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'task_resolved') {
    const title = readString(payload, 'title');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>Task resolved</p>
        {title && <p className="mt-0.5 truncate text-muted-foreground">{title}</p>}
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'payment_overdue') {
    const service = readString(payload, 'service_type');
    const amount =
      payload?.amount_gross != null ? `€${Number(payload.amount_gross).toFixed(0)}` : null;
    const due = readString(payload, 'due_date');
    const meta = [service, amount, due ? `due ${due}` : null].filter(Boolean).join(' · ');

    return (
      <>
        <p className="min-w-0">
          <span className="font-semibold text-red-700 dark:text-red-300">Overdue</span>
          {parentLabel && (
            <>
              {' '}
              <span className="text-muted-foreground">·</span>{' '}
              <span className={cn('truncate', titleClass)}>{parentLabel}</span>
            </>
          )}
        </p>
        {(meta || when) && (
          <p className="mt-0.5 flex min-w-0 items-center justify-between gap-2 text-muted-foreground">
            <span className="truncate">{meta || '—'}</span>
            <span className="shrink-0 text-[10px]">{when}</span>
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <p className={cn('min-w-0', titleClass)}>
        <span className="font-semibold">{type}</span>
        {parentLabel && <> · {parentLabel}</>}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
    </>
  );
}

export function CompactNotificationRow({
  type,
  payload,
  parentLabel,
  isRead,
  createdAt,
}: {
  type: string;
  payload: NotifPayload;
  parentLabel: string | null;
  isRead: boolean;
  createdAt: string;
}) {
  return (
    <div className={notificationShellClass(isRead)}>
      <NotifIcon type={type} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <CompactNotificationContent
          type={type}
          payload={payload}
          parentLabel={parentLabel}
          isRead={isRead}
          createdAt={createdAt}
        />
      </div>
    </div>
  );
}
