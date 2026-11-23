import ProtectedRoute from '../../../components/auth/ProtectedRoute';
import DraftCreationPage from '../../../components/draft/DraftCreationPage';

export default function DraftCreationRoute() {
  return (
    <ProtectedRoute>
      <DraftCreationPage />
    </ProtectedRoute>
  );
}
