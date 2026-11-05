import { useEffect, useState } from 'react';
import { SystemRoles } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type * as t from '@/types';
import { notifySuccess, notifyError } from '@/utils';
import { FormDialog } from '@/components/shared';
import { updateUserFn } from '@/server';
import { useLocalize } from '@/hooks';

const INPUT_CLASS =
  'rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-2 text-sm text-(--cui-color-text-default)';

/** Edits name, email and system role of an account (Pomocnik API). */
export function EditUserDialog({ user, onClose }: t.EditUserDialogProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<SystemRoles>(SystemRoles.USER);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
    setRole(user.role === SystemRoles.ADMIN ? SystemRoles.ADMIN : SystemRoles.USER);
  }, [user]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('No user');
      return updateUserFn({
        data: {
          id: user.id,
          ...(name.trim() !== user.name ? { name: name.trim() } : {}),
          ...(email.trim().toLowerCase() !== user.email ? { email: email.trim() } : {}),
          ...(role !== user.role ? { role } : {}),
        },
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      notifySuccess(localize('com_toast_user_updated', { name: result.user.name }));
      onClose();
    },
    onError: (err: Error) => notifyError(err.message),
  });

  const changed =
    !!user &&
    (name.trim() !== user.name || email.trim().toLowerCase() !== user.email || role !== user.role);

  return (
    <FormDialog
      open={user !== null}
      title={localize('com_users_edit_title')}
      submitLabel={localize('com_ui_save')}
      submitDisabled={!changed || name.trim().length < 3 || !email.includes('@')}
      hint={localize('com_users_edit_hint')}
      saving={mutation.isPending}
      onSubmit={() => mutation.mutate()}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-user-name" className="text-sm font-medium text-(--cui-color-text-default)">
          {localize('com_access_col_name')}
        </label>
        <input
          id="edit-user-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className={INPUT_CLASS}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-user-email" className="text-sm font-medium text-(--cui-color-text-default)">
          {localize('com_auth_email_label')}
        </label>
        <input
          id="edit-user-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-user-role" className="text-sm font-medium text-(--cui-color-text-default)">
          {localize('com_users_role_label')}
        </label>
        <select
          id="edit-user-role"
          value={role}
          onChange={(e) => setRole(e.target.value as SystemRoles)}
          className={INPUT_CLASS}
        >
          <option value={SystemRoles.USER}>{SystemRoles.USER}</option>
          <option value={SystemRoles.ADMIN}>{SystemRoles.ADMIN}</option>
        </select>
      </div>
    </FormDialog>
  );
}
