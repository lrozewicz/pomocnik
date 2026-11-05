import { useState, useMemo } from 'react';
import { Icon } from '@clickhouse/click-ui';
import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TUser } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  accountStatusQueryOptions,
  availableScopesOptions,
  deleteUserFn,
  resetPasswordFn,
  suspendUserFn,
  unsuspendUserFn,
  groupAssignmentsQueryOptions,
  roleAssignmentsQueryOptions,
  usersQueryOptions,
} from '@/server';
import {
  Avatar,
  EmptyState,
  KebabMenu,
  LoadingState,
  ScreenReaderAnnouncer,
  SearchInput,
} from '@/components/shared';
import { useLocalize, useAnnouncement, useCapabilities, useRefreshScopes } from '@/hooks';
import { SystemCapabilities, USER_DELETE_UNAVAILABLE } from '@/constants';
import { cn, errorText, notifySuccess, notifyError } from '@/utils';
import { CreateUserDialog } from './CreateUserDialog';
import { UserDetailDialog } from './UserDetailDialog';
import { EditUserDialog } from './EditUserDialog';
import { PasswordDialog } from './PasswordDialog';
import { ConfirmDialog } from '@/components/access';

const ROLE_FILTER_LABELS: Record<t.RoleFilter, string> = {
  all: 'com_ui_all',
  admin: 'com_users_admins',
  user: 'com_nav_users',
};

export function UsersPage() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const refreshScopes = useRefreshScopes();
  const { hasCapability } = useCapabilities();
  const canManage = hasCapability(SystemCapabilities.MANAGE_USERS);
  const canManageRoles = hasCapability(SystemCapabilities.MANAGE_ROLES);
  const canManageGroups = hasCapability(SystemCapabilities.MANAGE_GROUPS);
  const canAssignConfigs = hasCapability(SystemCapabilities.ASSIGN_CONFIGS);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<t.RoleFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TUser | null>(null);
  const [detailUser, setDetailUser] = useState<TUser | null>(null);
  const [editUser, setEditUser] = useState<TUser | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<TUser | null>(null);
  const [resetTarget, setResetTarget] = useState<TUser | null>(null);
  const [newPassword, setNewPassword] = useState<t.AccountWithPassword | null>(null);
  const { message: announcement, announce } = useAnnouncement();

  const { data: users = [], isLoading } = useQuery(usersQueryOptions);
  const { data: roleAssignments = {} } = useQuery(roleAssignmentsQueryOptions);
  const { data: groupAssignments = {} } = useQuery(groupAssignmentsQueryOptions);
  const { data: allScopes = [] } = useQuery(availableScopesOptions);
  const { data: statuses = [] } = useQuery(accountStatusQueryOptions);
  const suspendedIds = useMemo(
    () => new Set(statuses.filter((s) => s.suspended).map((s) => s.id)),
    [statuses],
  );

  const userProfileSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of allScopes) {
      if (s.principalType === PrincipalType.USER) set.add(s.principalId);
    }
    return set;
  }, [allScopes]);

  const deleteMutation = useMutation({
    mutationFn: (user: TUser) => deleteUserFn({ data: { id: user.id } }),
    onSuccess: (_data, user) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['roleAssignments'] });
      queryClient.invalidateQueries({ queryKey: ['groupAssignments'] });
      queryClient.invalidateQueries({ queryKey: ['roleMembers'] });
      queryClient.invalidateQueries({ queryKey: ['groupMembers'] });
      void refreshScopes();
      notifySuccess(localize('com_toast_user_deleted', { name: user.name }));
      setDeleteTarget(null);
    },
    onError: (err: Error) =>
      notifyError(
        err.message === USER_DELETE_UNAVAILABLE
          ? localize('com_users_delete_unavailable')
          : errorText(err, localize('com_users_delete_failed'), localize),
      ),
  });

  const suspendMutation = useMutation({
    mutationFn: (user: TUser) =>
      suspendedIds.has(user.id)
        ? unsuspendUserFn({ data: { id: user.id } })
        : suspendUserFn({ data: { id: user.id } }),
    onSuccess: (result, user) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      notifySuccess(
        localize(result.user.suspended ? 'com_toast_user_suspended' : 'com_toast_user_unsuspended', {
          name: user.name,
        }),
      );
      setSuspendTarget(null);
    },
    onError: (err: Error) => notifyError(err.message),
  });

  const resetMutation = useMutation({
    mutationFn: (user: TUser) => resetPasswordFn({ data: { id: user.id } }),
    onSuccess: (result) => {
      setResetTarget(null);
      setNewPassword(result);
    },
    onError: (err: Error) => notifyError(err.message),
  });

  const applyFilters = (list: TUser[], q: string, role: t.RoleFilter) =>
    list.filter((u) => {
      if (role === 'admin' && u.role !== SystemRoles.ADMIN) return false;
      if (role === 'user' && u.role !== SystemRoles.USER) return false;
      if (q) {
        const lower = q.toLowerCase();
        return u.name.toLowerCase().includes(lower) || u.email.toLowerCase().includes(lower);
      }
      return true;
    });

  const filtered = applyFilters(users, search, roleFilter);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    const count = applyFilters(users, value, roleFilter).length;
    announce(localize('com_a11y_results_found', { count }));
  };

  const handleRoleFilter = (role: t.RoleFilter) => {
    setRoleFilter(role);
    const count = applyFilters(users, search, role).length;
    announce(localize('com_a11y_filter_changed', { count }));
  };

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div
      role="region"
      aria-label={localize('com_nav_users')}
      className="flex flex-1 flex-col gap-6 overflow-auto p-6"
    >
      <section aria-label={localize('com_users_list')}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <SearchInput
            value={search}
            onChange={handleSearchChange}
            placeholder={localize('com_users_search')}
            className="relative flex-1"
          />

          <div className="flex gap-1" role="group" aria-label={localize('com_users_role_filter')}>
            {(['all', 'admin', 'user'] as t.RoleFilter[]).map((role) => (
              <button
                key={role}
                type="button"
                aria-pressed={roleFilter === role}
                onClick={() => handleRoleFilter(role)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  roleFilter === role
                    ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
                    : 'text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)',
                )}
              >
                {localize(ROLE_FILTER_LABELS[role])}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!canManage}
            aria-disabled={!canManage || undefined}
            title={
              !canManage
                ? localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_USERS })
                : undefined
            }
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover) disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">
              <Icon name="plus" size="xs" />
            </span>
            {localize('com_users_add')}
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-(--cui-color-stroke-default)">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-muted)">
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_users_col_user')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_users_col_role')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_users_col_joined')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  <span className="sr-only">{localize('com_ui_actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user, i) => (
                <UserRow
                  key={user.id}
                  user={user}
                  roles={roleAssignments[user.id] ?? []}
                  groups={groupAssignments[user.id] ?? []}
                  hasUserProfile={userProfileSet.has(user.id)}
                  isLast={i === filtered.length - 1}
                  onViewDetails={() => setDetailUser(user)}
                  onDelete={() => setDeleteTarget(user)}
                  canManage={canManage}
                  suspended={suspendedIds.has(user.id)}
                  onEdit={() => setEditUser(user)}
                  onResetPassword={() => setResetTarget(user)}
                  onToggleSuspend={() =>
                    suspendedIds.has(user.id) ? suspendMutation.mutate(user) : setSuspendTarget(user)
                  }
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState message={localize('com_users_empty')} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-xs text-(--cui-color-text-muted)">
          {localize('com_users_showing')} {filtered.length} {localize('com_ui_of')} {users.length}{' '}
          {localize('com_nav_users').toLowerCase()}
        </p>
      </section>

      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <UserDetailDialog
        user={detailUser}
        onClose={() => setDetailUser(null)}
        canManageRoles={canManageRoles}
        canManageGroups={canManageGroups}
        canAssignConfigs={canAssignConfigs}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={localize('com_users_delete_title')}
        description={localize('com_users_delete_desc', { name: deleteTarget?.name ?? '' })}
        confirmLabel={localize('com_ui_delete')}
        saving={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <EditUserDialog user={editUser} onClose={() => setEditUser(null)} />

      <ConfirmDialog
        open={!!suspendTarget}
        title={localize('com_users_suspend_title')}
        description={localize('com_users_suspend_desc', { name: suspendTarget?.name ?? '' })}
        confirmLabel={localize('com_users_suspend')}
        saving={suspendMutation.isPending}
        onConfirm={() => {
          if (suspendTarget) suspendMutation.mutate(suspendTarget);
        }}
        onCancel={() => setSuspendTarget(null)}
      />

      <ConfirmDialog
        open={!!resetTarget}
        title={localize('com_users_reset_password_title')}
        description={localize('com_users_reset_password_desc', { name: resetTarget?.name ?? '' })}
        confirmLabel={localize('com_users_reset_password')}
        confirmType="primary"
        saving={resetMutation.isPending}
        onConfirm={() => {
          if (resetTarget) resetMutation.mutate(resetTarget);
        }}
        onCancel={() => setResetTarget(null)}
      />

      <PasswordDialog
        password={newPassword?.password ?? null}
        email={newPassword?.user.email ?? ''}
        title={localize('com_users_password_reset_done')}
        onClose={() => setNewPassword(null)}
      />

      <ScreenReaderAnnouncer message={announcement} />
    </div>
  );
}

function UserRow({
  user,
  roles,
  groups,
  hasUserProfile,
  isLast,
  onViewDetails,
  onDelete,
  canManage,
  suspended,
  onEdit,
  onResetPassword,
  onToggleSuspend,
}: t.UserRowProps) {
  const localize = useLocalize();

  const kebabItems: t.KebabMenuItem[] = [
    { label: localize('com_users_view_details'), icon: 'user', onClick: onViewDetails },
    ...(canManage
      ? [
          { label: localize('com_users_edit'), icon: 'pencil', onClick: onEdit } as t.KebabMenuItem,
          {
            label: localize('com_users_reset_password'),
            icon: 'key',
            onClick: onResetPassword,
          } as t.KebabMenuItem,
          {
            label: localize(suspended ? 'com_users_unsuspend' : 'com_users_suspend'),
            icon: suspended ? 'play' : 'pause',
            onClick: onToggleSuspend,
          } as t.KebabMenuItem,
          {
            label: localize('com_ui_delete'),
            icon: 'trash',
            danger: true,
            onClick: onDelete,
          } as t.KebabMenuItem,
        ]
      : []),
  ];

  return (
    <tr
      className={cn(
        'cursor-pointer bg-(--cui-color-background-panel) transition-colors hover:bg-(--cui-color-background-hover)',
        !isLast && 'border-b border-(--cui-color-stroke-default)',
      )}
      onClick={onViewDetails}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={user.name} />
          <div className="flex flex-col gap-1">
            <div className="flex flex-col">
              <span className="font-medium text-(--cui-color-text-default)">{user.name}</span>
              <span className="text-xs text-(--cui-color-text-muted)">{user.email}</span>
            </div>
            {/* Role/group pills are user data returned by the API -- not gated by
                READ_ROLES/READ_GROUPS. The backend controls what data is included
                in the users response; the frontend renders what it receives. */}
            <div className="flex flex-wrap gap-1">
              {roles.map((r) => (
                <span
                  key={r.id}
                  className="badge-role inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                >
                  <span aria-hidden="true">
                    <Icon name="lock" size="xs" />
                  </span>
                  {r.name}
                </span>
              ))}
              {groups.map((g) => (
                <span
                  key={g.id}
                  className="badge-group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                >
                  <span aria-hidden="true">
                    <Icon name="users" size="xs" />
                  </span>
                  {g.name}
                </span>
              ))}
              {hasUserProfile && (
                <span
                  className="badge-profile inline-flex items-center rounded-full p-1"
                  title={localize('com_users_user_profile', { name: user.name })}
                  aria-label={localize('com_users_user_profile', { name: user.name })}
                >
                  <Icon name="user" size="xs" />
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
            user.role === SystemRoles.ADMIN
              ? 'badge-admin'
              : 'bg-(--cui-color-background-secondary) text-(--cui-color-text-muted)',
          )}
        >
          {user.role}
        </span>
        {suspended && (
          <span className="ml-1.5 inline-block rounded-full bg-(--cui-color-background-danger) px-2 py-0.5 text-xs font-medium text-(--cui-color-text-danger)">
            {localize('com_users_suspended')}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-(--cui-color-text-muted)">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <span onClick={(e) => e.stopPropagation()}>
          <KebabMenu items={kebabItems} ariaLabel={`${localize('com_ui_actions')} ${user.name}`} />
        </span>
      </td>
    </tr>
  );
}
