import { AlertTriangle, AtSign, Bell, Briefcase, CheckCircle2, Clock, MessageSquare, PlayCircle } from 'lucide-react';
import { relativeFromNow } from '@/lib/datetime';
import { cn } from '@/lib/utils';

export type NotifPayload = Record<string, unknown> | null;

// Route a notification to where the recipient can actually open it. Task
// payloads with a target_job_id deep-link into /jobs/<id>?tab=tasks&open=…
// so dept users (who lack RLS on the parent deal) can open the task on
// their service job; otherwise fall back to /tasks?open=… which is
// RLS-safe for the assignee.
export function readPath(payload: NotifPayload): string | null {
  if (!payload) return null;

  // Nightly billing-integrity audit notifications carry no parent row; route
  // the recipient straight to the accounting Alerts page.
  if (payload['kind'] === 'integrity_audit') return '/accounting/alerts';

  const taskId = payload['task_id'];
  if (typeof taskId === 'string') {
    const kind =
      payload['task_kind'] === 'user_task' || payload['parent_type'] === 'user_task'
        ? 'user'
        : 'assigned';
    const targetJobId = payload['target_job_id'];
    if (typeof targetJobId === 'string') {
      // Dept-tagged tasks: dept users lack RLS on the parent deal, so route
      // them to the matching service job that they DO have access to.
      // ?tab=tasks + ?open=<kind>:<id> mirrors the /tasks deep-link contract.
      return `/jobs/${targetJobId}?tab=tasks&open=${kind}:${taskId}`;
    }
    return `/tasks?open=${kind}:${taskId}`;
  }

  const parentId = payload['parent_id'];
  if (typeof parentId !== 'string') return null;
  switch (payload['parent_type']) {
    case 'lead':
      return `/leads/${parentId}`;
    case 'client':
      return `/clients/${parentId}`;
    case 'deal':
      return `/deals/${parentId}`;
    case 'deal_dev':
    case 'deal_seo':
    case 'deal_ads':
    case 'deal_social':
      // Deal comment channels live on the deal page's Comments panel.
      return `/deals/${parentId}`;
    case 'job':
      return `/jobs/${parentId}`;
    case 'user_task':
      // Legacy shape: user_task notifications carried parent_id = task id and
      // no task_id. Treat the parent_id AS the task id so the dialog opens.
      return `/tasks?open=user:${parentId}`;
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
    case 'task_confirm_pending':
      return <CheckCircle2 className={cn(iconClass, 'text-amber-600 dark:text-amber-400')} />;
    case 'task_auto_closed':
      return <Clock className={cn(iconClass, 'text-muted-foreground')} />;
    case 'task_comment':
      return <MessageSquare className={cn(iconClass, 'text-blue-600 dark:text-blue-400')} />;
    case 'task_started':
      return <PlayCircle className={cn(iconClass, 'text-cyan-600 dark:text-cyan-400')} />;
    case 'job_created':
      return <Briefcase className={cn(iconClass, 'text-indigo-600 dark:text-indigo-400')} />;
    case 'payment_integrity_alert':
    case 'payment_overdue':
    case 'cadence_task_overdue':
      return <AlertTriangle className={cn(iconClass, 'text-red-600 dark:text-red-400')} />;
    case 'cadence_task_transferred':
      return <CheckCircle2 className={cn(iconClass, 'text-[#1a9696]')} />;
    case 'cadence_auto_paused':
      return <Clock className={cn(iconClass, 'text-amber-600 dark:text-amber-400')} />;
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
    // Photo-only comments carry no body text — surface the attachment instead
    // of a blank preview slot.
    const previewText = preview?.trim() ? preview : '📎 attachment';
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
        <p className="mt-0.5 truncate text-muted-foreground italic">&ldquo;{previewText}&rdquo;</p>
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

  if (type === 'task_confirm_pending') {
    // Payload carries author_id (not a name) — mirror the mention presenter's
    // fallback. The deep link is resolved by readPath() from task_id/task_kind.
    const author = readString(payload, 'author_name') ?? 'Someone';
    const title = readString(payload, 'title');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          <span className="font-semibold">{author}</span> resolved
          {title && (
            <>
              {' '}
              &ldquo;<span className="font-semibold">{title}</span>&rdquo;
            </>
          )}
          {' '}&mdash; confirm to close
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'task_auto_closed') {
    const title = readString(payload, 'title');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          Task closed automatically after 7 days of inactivity
          {title && (
            <>
              {' '}&mdash; &ldquo;<span className="font-semibold">{title}</span>&rdquo;
            </>
          )}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'task_comment') {
    const title = readString(payload, 'title');
    const snippet = readString(payload, 'snippet');
    // Attachment-only comments carry no body — surface the attachment instead
    // of a blank snippet slot (mirrors the mention presenter's fallback).
    const snippetText = snippet?.trim() ? snippet : '📎 attachment';
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          New comment
          {title && (
            <>
              {' '}
              on <span className="font-semibold">{title}</span>
            </>
          )}
        </p>
        <p className="mt-0.5 truncate text-muted-foreground italic">&ldquo;{snippetText}&rdquo;</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'task_started') {
    const title = readString(payload, 'title');
    const code = readString(payload, 'source_code');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          Started working
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

  if (type === 'job_created') {
    const service = readString(payload, 'service_type');
    const client = readString(payload, 'client_name');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          New job
          {client && (
            <>
              {' '}
              for <span className="font-semibold">{client}</span>
            </>
          )}
        </p>
        {service && <p className="mt-0.5 truncate text-muted-foreground">{service}</p>}
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

  if (type === 'cadence_task_transferred') {
    const lead = readString(payload, 'lead_title');
    const tasks = readString(payload, 'title');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          Lead handed to you
          {lead && (
            <>
              {' '}&mdash; <span className="font-semibold">{lead}</span>
            </>
          )}
        </p>
        {tasks && <p className="mt-0.5 truncate text-muted-foreground">{tasks}</p>}
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'cadence_task_overdue') {
    const lead = readString(payload, 'lead_title');
    const task = readString(payload, 'title');
    const owner = readString(payload, 'owner_name');
    const days = Number(payload?.days_overdue ?? 0);
    return (
      <>
        <p className="min-w-0">
          <span className="font-semibold text-red-700 dark:text-red-300">
            Sales task overdue{days > 0 ? ` ${days}d` : ''}
          </span>
          {lead && (
            <>
              {' '}
              <span className="text-muted-foreground">·</span>{' '}
              <span className={cn('truncate', titleClass)}>{lead}</span>
            </>
          )}
        </p>
        <p className="mt-0.5 truncate text-muted-foreground">
          {[task, owner ? `assigned to ${owner}` : null].filter(Boolean).join(' · ') || '—'}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'cadence_auto_paused') {
    const lead = readString(payload, 'lead_title');
    const reason = readString(payload, 'reason');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            Chain auto-paused
          </span>
          {lead && (
            <>
              {' '}
              <span className="text-muted-foreground">·</span> <span className="truncate">{lead}</span>
            </>
          )}
        </p>
        <p className="mt-0.5 truncate text-muted-foreground">
          {reason === 'call' ? 'The lead called in — take over.' : 'The lead replied by email — take over.'}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'payment_integrity_alert') {
    const n = Number(payload?.alerts_new ?? 0);
    const title = `Billing audit found ${n} issue${n === 1 ? '' : 's'}`;
    return (
      <>
        <p className="min-w-0">
          <span className="font-semibold text-red-700 dark:text-red-300">{title}</span>
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
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
