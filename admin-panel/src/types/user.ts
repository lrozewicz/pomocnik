import type { TUser } from 'librechat-data-provider';
import type { ConfigScope, IconName } from './scope';

export interface AssignmentRef {
  id: string;
  name: string;
}

export interface UserAssignment {
  roles: AssignmentRef[];
  groups: AssignmentRef[];
}

export interface CreateUserDialogProps {
  open: boolean;
  onClose: () => void;
}

export type RoleFilter = 'all' | 'admin' | 'user';

export interface UserRowProps {
  user: TUser;
  roles: AssignmentRef[];
  groups: AssignmentRef[];
  hasUserProfile: boolean;
  isLast: boolean;
  onViewDetails: () => void;
  onDelete: () => void;
  canManage: boolean;
  /** Pomocnik: the account is suspended (sign-in and chat blocked). */
  suspended: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onToggleSuspend: () => void;
}

export type RemoveTarget =
  | { kind: 'role'; ref: AssignmentRef }
  | { kind: 'group'; ref: AssignmentRef }
  | { kind: 'profile'; scope: ConfigScope };

export interface UserDetailDialogProps {
  user: TUser | null;
  onClose: () => void;
  canManageRoles?: boolean;
  canManageGroups?: boolean;
  canAssignConfigs?: boolean;
}

export interface ProfileListProps {
  roles: AssignmentRef[];
  groups: AssignmentRef[];
  userProfile: ConfigScope | undefined;
  userName: string;
  busy: boolean;
  canManageRoles: boolean;
  canManageGroups: boolean;
  canAssignConfigs: boolean;
  onRemoveRole: (roleId: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onDeleteUserProfile: (scope: ConfigScope) => void;
}

export interface ProfileRowProps {
  icon: IconName;
  colorClass: string;
  label: string;
  onRemove: () => void;
  removeLabel: string;
  busy: boolean;
  canRemove: boolean;
}

export interface AddProfilesPanelProps {
  availableRoles: AssignmentRef[];
  availableGroups: AssignmentRef[];
  hasUserProfile: boolean;
  userName: string;
  busy: boolean;
  canManageRoles: boolean;
  canManageGroups: boolean;
  canAssignConfigs: boolean;
  onAddRole: (roleId: string) => void;
  onAddGroup: (groupId: string) => void;
  onCreateUserProfile: () => void;
  onDone: () => void;
}

export interface PickerSectionProps {
  label: string;
  listLabel: string;
  icon: IconName;
  colorClass: string;
  items: AssignmentRef[];
  emptyLabel: string;
  busy: boolean;
  onSelect: (id: string) => void;
}

/** Pomocnik account status (GET /api/admin/users/pomocnik and the account endpoints). */
export interface AccountStatus {
  id: string;
  email: string;
  name: string;
  username?: string;
  role: string;
  createdAt?: string;
  suspended: boolean;
  apiKeys?: number;
}

/** Reply of create / password reset: the account and its password, shown to the admin once. */
export interface AccountWithPassword {
  user: AccountStatus;
  password: string;
}

export interface PasswordDialogProps {
  /** The password to show; null closes the dialog. */
  password: string | null;
  email: string;
  title: string;
  onClose: () => void;
}

export interface EditUserDialogProps {
  user: TUser | null;
  onClose: () => void;
}
