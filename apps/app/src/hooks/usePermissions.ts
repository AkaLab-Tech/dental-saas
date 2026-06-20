import { useMemo } from 'react';
import { Permission, hasPermission, hasAnyPermission, hasAllPermissions } from '@dental/shared';
import type { UserRole } from '@dental/shared';
import { useAuthStore } from '../stores/auth.store';
import { useLockStore } from '../stores/lock.store';

/**
 * Hook to check user permissions based on their role.
 * When a profile is active (via PIN login), uses the active user's role.
 * Otherwise falls back to the owner's role from the auth store.
 */
export function usePermissions() {
  const user = useAuthStore((state) => state.user);
  const activeUser = useLockStore((state) => state.activeUser);

  return useMemo(() => {
    const effectiveRole = activeUser?.role || user?.role;
    if (!effectiveRole) {
      return {
        can: () => false,
        canAny: () => false,
        canAll: () => false,
      };
    }

    return {
      can: (permission: Permission): boolean => {
        return hasPermission(effectiveRole as UserRole, permission);
      },
      canAny: (permissions: Permission[]): boolean => {
        return hasAnyPermission(effectiveRole as UserRole, permissions);
      },
      canAll: (permissions: Permission[]): boolean => {
        return hasAllPermissions(effectiveRole as UserRole, permissions);
      },
    };
  }, [user, activeUser]);
}
