import { useState } from 'react';
import type * as t from '@/types';
import { FormDialog } from '@/components/shared';
import { useLocalize } from '@/hooks';
import { notifyError } from '@/utils';

/**
 * Shows a generated password once (after creating an account or resetting its
 * password). LibreChat stores only its hash, so it cannot be shown again.
 */
export function PasswordDialog({ password, email, title, onClose }: t.PasswordDialogProps) {
  const localize = useLocalize();
  const [copied, setCopied] = useState(false);

  const close = () => {
    setCopied(false);
    onClose();
  };

  const copy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      notifyError(localize('com_users_password_copy_failed'));
    }
  };

  return (
    <FormDialog
      open={password !== null}
      title={title}
      submitLabel={localize('com_ui_done')}
      onSubmit={close}
      onClose={close}
    >
      <p className="text-sm text-(--cui-color-text-default)">
        {localize('com_users_password_once', { email })}
      </p>
      <div className="flex items-center gap-2">
        <code
          data-testid="generated-password"
          className="flex-1 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-muted) px-3 py-2 font-mono text-sm text-(--cui-color-text-default) select-all"
        >
          {password}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-lg border border-(--cui-color-stroke-default) px-3 py-2 text-sm text-(--cui-color-text-default) hover:bg-(--cui-color-background-hover)"
        >
          {copied ? localize('com_users_password_copied') : localize('com_users_password_copy')}
        </button>
      </div>
    </FormDialog>
  );
}
