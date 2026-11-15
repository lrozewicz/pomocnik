import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type * as t from '@/types';
import { getSecretsFn, updateSecretsFn } from '@/server';
import { notifySuccess, notifyError, cn } from '@/utils';
import { FormDialog } from '@/components/shared';
import { useLocalize } from '@/hooks';

const INPUT_CLASS =
  'rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-2 text-sm text-(--cui-color-text-default)';

/**
 * Pomocnik: a client's secrets for agents (hosting panel passwords, SSH keys). The server returns
 * secret names only, so values are write-only here: add or replace with NAME=value lines, or mark
 * a name for removal. Settings (SEJF_ORIGINS, SSH_*_ADDR, SSH_*_HOSTKEY) are shown with values.
 */
export function SecretsDialog({ user, onClose }: t.SecretsDialogProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [remove, setRemove] = useState<string[]>([]);
  const id = user?.id ?? '';

  const query = useQuery({
    queryKey: ['users', 'secrets', id],
    queryFn: () => getSecretsFn({ data: { id } }),
    enabled: !!user,
    staleTime: 0,
  });

  useEffect(() => {
    setText('');
    setRemove([]);
  }, [user]);

  const mutation = useMutation({
    mutationFn: () => updateSecretsFn({ data: { id, set: text, remove } }),
    onSuccess: (result) => {
      queryClient.setQueryData(['users', 'secrets', id], result);
      notifySuccess(localize('com_users_secrets_saved', { count: String(result.names.length) }));
      onClose();
    },
    onError: (err: Error) => notifyError(err.message),
  });

  const toggle = (name: string) =>
    setRemove((r) => (r.includes(name) ? r.filter((n) => n !== name) : [...r, name]));

  const names = query.data?.names ?? [];
  const settings = Object.entries(query.data?.settings ?? {});
  const changed = text.trim().length > 0 || remove.length > 0;

  return (
    <FormDialog
      open={user !== null}
      title={localize('com_users_secrets_title', { name: user?.name ?? '' })}
      submitLabel={localize('com_ui_save')}
      submitDisabled={!changed || query.isLoading}
      hint={localize('com_users_secrets_hint')}
      error={query.error ? (query.error as Error).message : undefined}
      saving={mutation.isPending}
      size="lg"
      submitOnEnter={false}
      discardPrompt={changed ? localize('com_users_secrets_discard') : undefined}
      onSubmit={() => mutation.mutate()}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-(--cui-color-text-default)">
          {localize('com_users_secrets_stored')}
        </span>
        {names.length === 0 && settings.length === 0 ? (
          <p className="text-sm text-(--cui-color-text-muted)">
            {query.isLoading ? '…' : localize('com_users_secrets_none')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="secret-list">
            {settings.map(([name, value]) => (
              <SecretRow key={name} name={name} value={value} removed={remove.includes(name)} onToggle={() => toggle(name)} />
            ))}
            {names.map((name) => (
              <SecretRow key={name} name={name} removed={remove.includes(name)} onToggle={() => toggle(name)} />
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="secrets-set" className="text-sm font-medium text-(--cui-color-text-default)">
          {localize('com_users_secrets_set_label')}
        </label>
        <textarea
          id="secrets-set"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            'SEJF_ORIGINS=https://panel.mydevil.net\nPANEL_HASLO=...\nSSH_STARY_ADDR=login@s1.mydevil.net\nSSH_STARY_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"'
          }
          className={cn(INPUT_CLASS, 'font-mono')}
        />
        <p className="text-xs text-(--cui-color-text-muted)">{localize('com_users_secrets_format')}</p>
      </div>
    </FormDialog>
  );
}

function SecretRow({ name, value, removed, onToggle }: t.SecretRowProps) {
  const localize = useLocalize();
  return (
    <li className="flex items-center gap-2 text-sm text-(--cui-color-text-default)">
      <code className={cn('font-mono', removed && 'line-through opacity-60')}>{name}</code>
      <span className="min-w-0 flex-1 truncate text-(--cui-color-text-muted)" title={value}>
        {value ?? '••••••'}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="shrink-0 rounded-lg border border-(--cui-color-stroke-default) px-2 py-1 text-xs hover:bg-(--cui-color-background-hover)"
      >
        {removed ? localize('com_users_secrets_keep') : localize('com_ui_delete')}
      </button>
    </li>
  );
}
