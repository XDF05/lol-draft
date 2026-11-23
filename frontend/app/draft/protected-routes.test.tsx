import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import DraftCreationRoute from './new/page';
import DraftRoomRoute from './[code]/page';

jest.mock('../../components/auth/ProtectedRoute', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="protected-route">{children}</div>
  ),
}));

jest.mock('../../components/draft/DraftCreationPage', () => ({
  __esModule: true,
  default: () => <div>Draft creation</div>,
}));

jest.mock('../../components/draft/DraftRoomPage', () => ({
  __esModule: true,
  default: ({ code }: { code: string }) => <div>Draft room {code}</div>,
}));

describe('protected draft routes', () => {
  it('guards the draft creation route', () => {
    render(<DraftCreationRoute />);

    expect(screen.getByTestId('protected-route')).toBeInTheDocument();
    expect(screen.getByText('Draft creation')).toBeInTheDocument();
  });

  it('guards the draft room route', async () => {
    render(
      await DraftRoomRoute({ params: Promise.resolve({ code: 'abc123' }) }),
    );

    expect(screen.getByTestId('protected-route')).toBeInTheDocument();
    expect(screen.getByText('Draft room ABC123')).toBeInTheDocument();
  });
});
