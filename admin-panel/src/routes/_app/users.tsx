import { createFileRoute } from '@tanstack/react-router';
import { AccessDenied, PermissionsUnavailable } from '@/components/shared';
import { UsersPage } from '@/components/users';
import { SystemCapabilities } from '@/constants';
import { useCapabilities } from '@/hooks';

// Pomocnik: the Users page (upstream redirects to / until LibreChat has a user admin API).
export const Route = createFileRoute('/_app/users')({
  component: UsersRoute,
});

function UsersRoute() {
  const { hasCapability, isLoading, isError } = useCapabilities();

  if (isLoading) return null;
  if (isError) return <PermissionsUnavailable />;
  if (!hasCapability(SystemCapabilities.READ_USERS)) return <AccessDenied />;

  return <UsersPage />;
}
