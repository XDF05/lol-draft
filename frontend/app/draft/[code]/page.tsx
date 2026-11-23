import ProtectedRoute from '../../../components/auth/ProtectedRoute';
import DraftRoomPage from '../../../components/draft/DraftRoomPage';

export default async function DraftRoomRoute({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <ProtectedRoute>
      <DraftRoomPage code={code.toUpperCase()} />
    </ProtectedRoute>
  );
}
