import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ImportanceBadge } from './ImportanceBadge';
import type { TaskCard } from './taskCard';

export function UserTaskDetailDialog({
  card, onOpenChange,
}: {
  card: TaskCard | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation('home');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  if (!card) return null;
  const due = card.dueAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(card.dueAt))
    : null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {card.title} <ImportanceBadge importance={card.importance} />
          </DialogTitle>
          <DialogDescription className="sr-only">{t('task.dialog_description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {due && (
            <p className="text-muted-foreground">
              {t('task.due_at', { defaultValue: 'Due' })}: <span className="text-foreground">{due}</span>
            </p>
          )}
          {card.clientName && (
            <p className="text-muted-foreground">
              {t('client_picker.label', { ns: 'common' })}: <span className="text-foreground">{card.clientName}</span>
            </p>
          )}
          {card.notes && <p className="whitespace-pre-wrap text-foreground">{card.notes}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
