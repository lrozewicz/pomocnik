/**
 * Pomocnik: lets a user with a local account change their own password
 * (POST /api/pomocnik/account/password, api/server/routes/pomocnikAccount.js).
 * Other sessions are logged out; this one stays signed in.
 */
import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { apiBaseUrl, request } from 'librechat-data-provider';
import {
  OGDialogContent,
  OGDialogTrigger,
  OGDialogHeader,
  OGDialogTitle,
  useToastContext,
  OGDialog,
  Spinner,
  Button,
  Label,
  Input,
} from '@librechat/client';
import { useLocalize } from '~/hooks';

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

type ChangePasswordBody = { currentPassword: string; newPassword: string };
type ChangePasswordError = {
  response?: { status?: number; data?: { error?: string; code?: string } };
};

export const changePassword = (body: ChangePasswordBody): Promise<{ otherSessionsEnded: number }> =>
  request.post(`${apiBaseUrl()}/api/pomocnik/account/password`, body);

const ChangePassword = () => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
  };

  const mutation = useMutation(changePassword, {
    onSuccess: () => {
      showToast({ message: localize('com_pomocnik_password_changed'), status: 'success' });
      reset();
      setOpen(false);
    },
    onError: (err: ChangePasswordError) => {
      const status = err.response?.status;
      const code = err.response?.data?.code;
      if (status === 429) {
        setError(localize('com_pomocnik_password_too_many'));
      } else if (code === 'CURRENT_PASSWORD_INCORRECT') {
        setError(localize('com_pomocnik_password_current_wrong'));
      } else if (code === 'SAME_PASSWORD') {
        setError(localize('com_pomocnik_password_same'));
      } else {
        setError(localize('com_pomocnik_password_failed'));
      }
    },
  });

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= MIN_LENGTH &&
    newPassword.length <= MAX_LENGTH &&
    newPassword === confirmPassword &&
    !mutation.isLoading;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    setError('');
    mutation.mutate({ currentPassword, newPassword });
  };

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    autoComplete: string,
  ) => (
    <div className="mb-4">
      <Label className="mb-1 block text-sm font-medium" htmlFor={id}>
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        maxLength={MAX_LENGTH}
        autoComplete={autoComplete}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <OGDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
        }
      }}
    >
      <div className="flex items-center justify-between">
        <Label id="change-password-label">{localize('com_pomocnik_password_change')}</Label>
        <OGDialogTrigger asChild>
          <Button
            variant="outline"
            aria-labelledby="change-password-label"
            onClick={() => setOpen(true)}
          >
            <KeyRound className="mr-2 size-4" aria-hidden="true" />
            {localize('com_pomocnik_password_change_button')}
          </Button>
        </OGDialogTrigger>
      </div>
      <OGDialogContent className="w-11/12 max-w-md">
        <OGDialogHeader>
          <OGDialogTitle className="text-lg font-medium leading-6">
            {localize('com_pomocnik_password_change')}
          </OGDialogTitle>
        </OGDialogHeader>
        <form onSubmit={onSubmit} noValidate>
          {field(
            'current-password',
            localize('com_pomocnik_password_current'),
            currentPassword,
            setCurrentPassword,
            'current-password',
          )}
          {field(
            'new-password',
            localize('com_pomocnik_password_new'),
            newPassword,
            setNewPassword,
            'new-password',
          )}
          {field(
            'confirm-password',
            localize('com_pomocnik_password_confirm'),
            confirmPassword,
            setConfirmPassword,
            'new-password',
          )}
          <div className="mb-4 min-h-5 text-sm text-text-warning" role="alert">
            {error ||
              (tooShort && localize('com_pomocnik_password_too_short')) ||
              (mismatch && localize('com_pomocnik_password_mismatch')) ||
              ''}
          </div>
          <p className="mb-4 text-xs text-text-secondary">
            {localize('com_pomocnik_password_other_sessions')}
          </p>
          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {mutation.isLoading ? (
              <Spinner className="icon-sm m-auto" />
            ) : (
              localize('com_pomocnik_password_change_button')
            )}
          </Button>
        </form>
      </OGDialogContent>
    </OGDialog>
  );
};

export default ChangePassword;
