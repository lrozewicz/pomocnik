import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from 'test/layout-test-utils';
import ChangePassword from '../ChangePassword';

const mockShowToast = jest.fn();
const mockPost = jest.fn();

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  request: {
    ...jest.requireActual('librechat-data-provider').request,
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const openDialog = async () => {
  render(<ChangePassword />);
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
};

const fill = async (current: string, next: string, confirm: string) => {
  await userEvent.type(screen.getByLabelText('Current password'), current);
  await userEvent.type(screen.getByLabelText('New password (8-128 characters)'), next);
  await userEvent.type(screen.getByLabelText('Repeat the new password'), confirm);
};

const submitButton = () => screen.getByRole('button', { name: 'Change' });

describe('ChangePassword', () => {
  beforeEach(() => {
    mockShowToast.mockClear();
    mockPost.mockReset();
  });

  it('keeps submit disabled until the new passwords match and are long enough', async () => {
    await openDialog();
    await fill('old-password', 'short', 'short');
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters');

    await userEvent.clear(screen.getByLabelText('New password (8-128 characters)'));
    await userEvent.clear(screen.getByLabelText('Repeat the new password'));
    await userEvent.type(
      screen.getByLabelText('New password (8-128 characters)'),
      'new-password-1',
    );
    await userEvent.type(screen.getByLabelText('Repeat the new password'), 'new-password-2');
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
  });

  it('sends both passwords and closes with a toast on success', async () => {
    mockPost.mockResolvedValue({ otherSessionsEnded: 2 });
    await openDialog();
    await fill('old-password', 'new-password-1', 'new-password-1');
    await userEvent.click(submitButton());

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/pomocnik\/account\/password$/),
      {
        currentPassword: 'old-password',
        newPassword: 'new-password-1',
      },
    );
    expect(mockShowToast.mock.calls[0][0]).toMatchObject({ status: 'success' });
    await waitFor(() =>
      expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument(),
    );
  });

  it('shows a wrong current password without closing', async () => {
    mockPost.mockRejectedValue({
      response: { status: 400, data: { error: 'The current password is incorrect' } },
    });
    await openDialog();
    await fill('bad-password', 'new-password-1', 'new-password-1');
    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('The current password is incorrect.'),
    );
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});
