import { render, screen, waitFor } from '@testing-library/react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import ProtectedRoute from './ProtectedRoute';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

jest.mock('../../hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockedUsePathname = usePathname as jest.MockedFunction<
  typeof usePathname
>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const replace = jest.fn();

describe('ProtectedRoute', () => {
  beforeEach(() => {
    replace.mockReset();
    mockedUseRouter.mockReturnValue({ replace } as never);
    mockedUsePathname.mockReturnValue('/draft/ABC123');
  });

  it('redirects an unauthenticated visitor and preserves the intended path', async () => {
    mockedUseAuth.mockReturnValue({ status: 'unauthenticated' } as never);

    render(
      <ProtectedRoute>
        <div>Private draft</div>
      </ProtectedRoute>,
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login?next=%2Fdraft%2FABC123');
    });
    expect(screen.queryByText('Private draft')).not.toBeInTheDocument();
  });

  it('shows a loading state while the session is being validated', () => {
    mockedUseAuth.mockReturnValue({ status: 'loading' } as never);

    render(
      <ProtectedRoute>
        <div>Private draft</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Private draft')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders the protected page for an authenticated user', () => {
    mockedUseAuth.mockReturnValue({ status: 'authenticated' } as never);

    render(
      <ProtectedRoute>
        <div>Private draft</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Private draft')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
