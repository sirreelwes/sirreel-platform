'use client';
import { createContext, useContext } from 'react';
import { UserRole } from '@prisma/client';
import { getPermissions, Permissions } from '@/lib/permissions';

interface RoleContextType {
  role: UserRole;
  perms: Permissions;
  userName: string;
}

export const RoleContext = createContext<RoleContextType>({
  role: UserRole.AGENT,
  perms: getPermissions(UserRole.AGENT),
  userName: '',
});

export function useRole() {
  return useContext(RoleContext);
}
