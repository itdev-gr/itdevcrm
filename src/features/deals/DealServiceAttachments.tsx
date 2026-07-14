import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { useDealServiceAttachments } from './hooks/useDealServiceAttachments';
import { areaForKind, SERVICE_AREA_KINDS } from '@/features/attachments/serviceAreas';
import { ServiceFileGallery } from '@/features/attachments/ServiceFileGallery';

export function DealServiceAttachments({ dealId }: { dealId: string }) {
  const { t, i18n } = useTranslation('jobs');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: files = [] } = useDealServiceAttachments(dealId);
  if (files.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <Paperclip className="size-4" /> {t('attachments.deal_title')}
      </h2>
      <div className="space-y-3">
        {SERVICE_AREA_KINDS.map((kind) => {
          const area = areaForKind(kind);
          const group = files.filter((f) => f.kind === kind);
          if (!area || group.length === 0) return null;
          return (
            <div key={kind} className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {lang === 'el' ? area.labelEl : area.labelEn}
              </div>
              <ServiceFileGallery files={group} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
