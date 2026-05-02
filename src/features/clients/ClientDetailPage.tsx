import { useParams } from 'react-router-dom';
import { useClient } from './hooks/useClient';

export function ClientDetailPage() {
  const { clientId = '' } = useParams<{ clientId: string }>();
  const { data: client, isLoading, error } = useClient(clientId);
  if (isLoading) return <div className="p-8">…</div>;
  if (error || !client)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;
  return <div className="p-8 text-2xl font-bold">{client.name}</div>;
}
