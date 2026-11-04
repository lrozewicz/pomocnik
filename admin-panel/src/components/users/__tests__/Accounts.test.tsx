/** Pomocnik: account management on the Users page (create shows the password, suspended badge). */
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { TUser } from 'librechat-data-provider';
import { createUserFn } from '@/server';
import { CreateUserDialog } from '../CreateUserDialog';
import { UsersPage } from '../UsersPage';

vi.mock('@/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks')>()),
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}(${Object.values(options).join(',')})` : key,
  useCapabilities: () => ({ hasCapability: () => true, isLoading: false, isError: false }),
  useRefreshScopes: () => vi.fn(),
}));

const { user } = vi.hoisted(() => ({
  user: (id: string, name: string, role = 'USER'): TUser => ({
    id,
    name,
    username: id,
    email: `${id}@example.com`,
    avatar: '',
    role,
    provider: 'local',
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
  }),
}));

vi.mock('@/server', () => {
  const query = <T,>(key: string[], data: T) => ({ queryKey: key, queryFn: async () => data });
  return {
    usersQueryOptions: query(['users'], [user('jane', 'Jane Doe'), user('raj', 'Raj Patel')]),
    accountStatusQueryOptions: query(
      ['users', 'status'],
      [
        { id: 'jane', email: 'jane@example.com', name: 'Jane Doe', role: 'USER', suspended: false },
        { id: 'raj', email: 'raj@example.com', name: 'Raj Patel', role: 'USER', suspended: true },
      ],
    ),
    roleAssignmentsQueryOptions: query(['roleAssignments'], {}),
    groupAssignmentsQueryOptions: query(['groupAssignments'], {}),
    availableScopesOptions: query(['availableScopes'], []),
    allRolesQueryOptions: query(['allRoles'], []),
    allGroupsQueryOptions: query(['allGroups'], []),
    createUserFn: vi.fn(),
    updateUserFn: vi.fn(),
    deleteUserFn: vi.fn(),
    resetPasswordFn: vi.fn(),
    suspendUserFn: vi.fn(),
    unsuspendUserFn: vi.fn(),
    addGroupMemberFn: vi.fn(),
    addRoleMemberFn: vi.fn(),
    createScopeFn: vi.fn(),
    deleteScopeFn: vi.fn(),
    removeGroupMemberFn: vi.fn(),
    removeRoleMemberFn: vi.fn(),
  };
});

function withClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('CreateUserDialog', () => {
  it('shows the generated password once the account is created', async () => {
    vi.mocked(createUserFn).mockResolvedValue({
      user: { id: 'new', email: 'new@example.com', name: 'New Person', role: 'USER', suspended: false },
      password: 'Gen3ratedPassw0rdXYZ',
    });
    withClient(<CreateUserDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('com_access_col_name'), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText('com_auth_email_label'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_users_add' }));
    await waitFor(() =>
      expect(screen.getByTestId('generated-password').textContent).toBe('Gen3ratedPassw0rdXYZ'),
    );
    expect(createUserFn).toHaveBeenCalledWith({
      data: { name: 'New Person', email: 'new@example.com', role: 'USER' },
    });
  });
});

describe('UsersPage', () => {
  it('marks suspended accounts', async () => {
    withClient(<UsersPage />);
    await screen.findByText('Raj Patel');
    await waitFor(() => expect(screen.getAllByText('com_users_suspended')).toHaveLength(1));
    const row = screen.getByText('Raj Patel').closest('tr');
    expect(row?.textContent).toContain('com_users_suspended');
  });
});
