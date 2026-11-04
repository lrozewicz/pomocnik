/**
 * Server functions for user management.
 *
 * Calls the LibreChat Admin API (/api/admin/users) for list, search, and delete,
 * and Pomocnik's additions on the same prefix (LibreChat 0.8.8 itself only lists
 * and searches): create, edit, password reset, suspend and the account status
 * list. A generated password comes back once and is shown to the admin once.
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { SystemRoles } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type { TUser } from 'librechat-data-provider';
import type * as t from '@/types';
import { apiFetch, extractApiError } from './utils/api';
import { USER_DELETE_UNAVAILABLE } from '@/constants';

// ── Server functions ─────────────────────────────────────────────────

export const getUsersFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ users: TUser[] }> => {
    const response = await apiFetch('/api/admin/users');
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.status}`);
    }
    const json = (await response.json()) as { users: TUser[] };
    return { users: json.users ?? [] };
  },
);

export const usersQueryOptions = queryOptions({
  queryKey: ['users'],
  queryFn: () => getUsersFn().then((r) => r.users),
  staleTime: 30_000,
});

/** Status of every account (Pomocnik API): suspension and the number of agent API keys. */
export const getAccountStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ statuses: t.AccountStatus[] }> => {
    const response = await apiFetch('/api/admin/users/pomocnik');
    if (!response.ok) {
      await extractApiError(response, 'Failed to fetch account status');
    }
    const json = (await response.json()) as { users: t.AccountStatus[] };
    return { statuses: json.users ?? [] };
  },
);

export const accountStatusQueryOptions = queryOptions({
  queryKey: ['users', 'status'],
  queryFn: () => getAccountStatusFn().then((r) => r.statuses),
  staleTime: 30_000,
});

/** POSTs/PATCHes a Pomocnik account endpoint and returns its JSON reply. */
async function accountRequest<T>(path: string, method: string, body: object, fallback: string): Promise<T> {
  const response = await apiFetch(path, { method, body: JSON.stringify(body) });
  if (!response.ok) {
    await extractApiError(response, fallback);
  }
  return (await response.json()) as T;
}

const userPath = (id: string, action = '') =>
  `/api/admin/users/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

export const createUserFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
      role: z.nativeEnum(SystemRoles),
    }),
  )
  .handler(async ({ data }): Promise<t.AccountWithPassword> =>
    accountRequest('/api/admin/users', 'POST', data, 'Failed to create user'),
  );

export const updateUserFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      role: z.nativeEnum(SystemRoles).optional(),
    }),
  )
  .handler(async ({ data: { id, ...changes } }): Promise<{ user: t.AccountStatus }> =>
    accountRequest(userPath(id), 'PATCH', changes, 'Failed to update user'),
  );

export const resetPasswordFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<t.AccountWithPassword> =>
    accountRequest(userPath(data.id, 'password'), 'POST', {}, 'Failed to reset the password'),
  );

export const suspendUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ user: t.AccountStatus; apiKeysDeleted: number }> =>
    accountRequest(userPath(data.id, 'suspend'), 'POST', {}, 'Failed to suspend the user'),
  );

export const unsuspendUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ user: t.AccountStatus }> =>
    accountRequest(userPath(data.id, 'unsuspend'), 'POST', {}, 'Failed to unsuspend the user'),
  );

/** The admin users API's reply when the user to delete no longer exists. */
const USER_NOT_FOUND_ERROR = 'User not found';

/**
 * Deletes a user. LibreChat's own "user not found" 404 means the user is
 * already gone, which is success; any other 404 is a server without the
 * delete route (LibreChat ships it disabled), reported as
 * `USER_DELETE_UNAVAILABLE` so the page explains it instead of claiming the
 * user was deleted.
 */
export const deleteUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    const response = await apiFetch(`/api/admin/users/${encodeURIComponent(data.id)}`, {
      method: 'DELETE',
    });
    if (response.ok) return;
    if (response.status === 404) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (body.error === USER_NOT_FOUND_ERROR) return;
      throw new Error(USER_DELETE_UNAVAILABLE);
    }
    await extractApiError(response, 'Failed to delete user');
  });

export const searchUsersFn = createServerFn({ method: 'GET' })
  .validator(z.object({ query: z.string() }))
  .handler(async ({ data }): Promise<{ users: AdminUserSearchResult[] }> => {
    const response = await apiFetch(`/api/admin/users/search?q=${encodeURIComponent(data.query)}`);
    if (!response.ok) {
      await extractApiError(response, 'Failed to search users');
    }
    const json = (await response.json()) as { users: AdminUserSearchResult[] };
    return { users: json.users ?? [] };
  });
