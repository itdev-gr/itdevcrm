import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClientForm } from './ClientForm';
import { useClient } from './hooks/useClient';

export function ClientDetailPage() {
  const { clientId = '' } = useParams<{ clientId: string }>();
  const { t } = useTranslation('clients');
  const { data: client, isLoading, error } = useClient(clientId);

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !client)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-2xl font-bold">{client.name}</h1>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="deals">{t('tabs.deals')}</TabsTrigger>
          <TabsTrigger value="jobs">{t('tabs.jobs')}</TabsTrigger>
          <TabsTrigger value="comments">{t('tabs.comments')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <ClientForm initial={client} />
        </TabsContent>
        <TabsContent value="deals" className="pt-4">
          <p className="text-sm text-muted-foreground">Deals list (Task 13)</p>
        </TabsContent>
        <TabsContent value="jobs" className="pt-4">
          <p className="text-sm text-muted-foreground">Jobs list (Phase 6)</p>
        </TabsContent>
        <TabsContent value="comments" className="pt-4">
          <p className="text-sm text-muted-foreground">Comments (Task 18)</p>
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <p className="text-sm text-muted-foreground">Attachments (Task 19)</p>
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <p className="text-sm text-muted-foreground">Activity (Task 20)</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
