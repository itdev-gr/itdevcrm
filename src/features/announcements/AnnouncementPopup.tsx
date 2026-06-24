import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useMyAnnouncements } from './hooks/useMyAnnouncements';
import { useDismissAnnouncement } from './hooks/useDismissAnnouncement';
import { useAnnouncementsRealtime } from './hooks/useAnnouncementsRealtime';

export function AnnouncementPopup() {
  const { t } = useTranslation('announcements');
  useAnnouncementsRealtime();
  const { data = [] } = useMyAnnouncements();
  const dismiss = useDismissAnnouncement();

  const current = data[0] ?? null;
  if (!current) return null;

  const warning = current.severity === 'warning';

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        showCloseButton={false}
        className={warning ? 'border-l-4 border-l-amber-500 sm:max-w-md' : 'sm:max-w-md'}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap text-foreground">
            {current.body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => dismiss.mutate(current.id)} disabled={dismiss.isPending}>
            {t('popup.got_it')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
