import { useParams } from 'react-router-dom';
import { BoardDocView } from '@/components/docs/BoardDocView';

export { BoardDocView } from '@/components/docs/BoardDocView';

export function TechBoardDocsPage() {
  const { serviceType = '' } = useParams<{ serviceType: string }>();
  return <BoardDocView slug={serviceType} />;
}
