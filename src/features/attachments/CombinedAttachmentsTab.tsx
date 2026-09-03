import { useTranslation } from 'react-i18next';
import { AttachmentsPanel } from './AttachmentsPanel';
import { AttachmentGallery } from './AttachmentGallery';
import { useEntityCommentFiles } from './hooks/useEntityCommentFiles';
import { DealJobFiles } from '@/features/deals/DealJobFiles';
import { OffersTab } from '@/features/offers/OffersTab';
import { ProFormasTab } from '@/features/proformas/ProFormasTab';
import { ContractsTab } from '@/features/contracts/ContractsTab';

type Props = {
  parentType: 'lead' | 'deal' | 'client';
  parentId: string;
  leadId?: string;
  dealId?: string;
  clientId?: string;
};

const sectionClass = 'rounded-xl border border-border/60 bg-card p-5 shadow-sm';
const headerClass = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

export function CombinedAttachmentsTab({ parentType, parentId, leadId, dealId, clientId }: Props) {
  const { t } = useTranslation('sales');
  // Offers can be filed straight on a client (accounting/upsell), so the
  // client page gets the section too. Pro formas are still lead/deal-only.
  const showOffers = Boolean(leadId ?? dealId ?? clientId);
  const showProFormas = Boolean(leadId ?? dealId);
  const { data: commentFiles = [] } = useEntityCommentFiles(parentType, parentId);
  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h2 className={headerClass}>{t('attachments.sections.files')}</h2>
        <AttachmentsPanel parentType={parentType} parentId={parentId} />
      </section>
      {commentFiles.length > 0 && (
        <section className={sectionClass}>
          <h2 className={headerClass}>{t('attachments.sections.from_comments')}</h2>
          <AttachmentGallery files={commentFiles} />
        </section>
      )}
      {parentType === 'deal' && dealId && <DealJobFiles dealId={dealId} />}
      {showOffers && (
        <section className={sectionClass}>
          <h2 className={headerClass}>{t('attachments.sections.offers')}</h2>
          <OffersTab
            {...(leadId ? { leadId } : {})}
            {...(dealId ? { dealId } : {})}
            {...(clientId ? { clientId } : {})}
          />
        </section>
      )}
      {showProFormas && (
        <section className={sectionClass}>
          <h2 className={headerClass}>{t('attachments.sections.proformas')}</h2>
          <ProFormasTab {...(leadId ? { leadId } : {})} {...(dealId ? { dealId } : {})} />
        </section>
      )}
      {clientId && (
        <section className={sectionClass}>
          <h2 className={headerClass}>{t('attachments.sections.contracts')}</h2>
          <ContractsTab clientId={clientId} />
        </section>
      )}
    </div>
  );
}
