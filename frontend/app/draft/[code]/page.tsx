import DraftRoomPage from '../../../components/draft/DraftRoomPage';

export default async function DraftRoomRoute({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <DraftRoomPage code={code.toUpperCase()} />;
}
