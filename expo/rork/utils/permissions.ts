import { UserRole } from '@/types';

export type Permission =
  | 'clearProducts'
  | 'clearUsers'
  | 'clearOutlets'
  | 'importExcel'
  | 'addEditSuperAdmin'
  | 'addEditAdmin'
  | 'addEditUser'
  | 'deleteUsers'
  | 'manageUsers'
  | 'addEditProducts'
  | 'editProducts'
  | 'addEditOutlets'
  | 'deleteOutlets'
  | 'manageOutlets'
  | 'downloadTemplate'
  | 'exportProducts'
  | 'showProduct'
  | 'enableSync'
  | 'shareCode'
  | 'enterCode'
  | 'viewSales'
  | 'viewRecipes'
  | 'deleteStockChecks'
  | 'deleteRequests'
  | 'deleteCustomers';

const rolePermissions: Record<UserRole, Permission[]> = {
  superadmin: [
    'clearProducts',
    'clearUsers',
    'clearOutlets',
    'importExcel',
    'addEditSuperAdmin',
    'addEditAdmin',
    'addEditUser',
    'deleteUsers',
    'manageUsers',
    'addEditProducts',
    'editProducts',
    'addEditOutlets',
    'deleteOutlets',
    'manageOutlets',
    'downloadTemplate',
    'exportProducts',
    'showProduct',
    'enableSync',
    'shareCode',
    'enterCode',
    'viewSales',
    'viewRecipes',
    'deleteStockChecks',
    'deleteRequests',
    'deleteCustomers',
  ],
  admin: [
    'addEditAdmin',
    'addEditUser',
    'manageUsers',
    'addEditOutlets',
    'manageOutlets',
    'downloadTemplate',
    'exportProducts',
    'showProduct',
    'enableSync',
    'shareCode',
    'enterCode',
    'viewSales',
    'viewRecipes',
    'deleteCustomers',
  ],
  user: [
    'enableSync',
  ],
};

export function hasPermission(role: UserRole | undefined, permission: Permission): boolean {
  if (!role) return false;
  return rolePermissions[role]?.includes(permission) || false;
}

export function canEditUserRole(currentUserRole: UserRole | undefined, targetRole: UserRole): boolean {
  if (!currentUserRole) return false;
  
  if (currentUserRole === 'superadmin') {
    return true;
  }
  
  if (currentUserRole === 'admin') {
    return targetRole === 'admin' || targetRole === 'user';
  }
  
  return false;
}

export function canDeleteUser(currentUserRole: UserRole | undefined, targetUserId: string, currentUserId: string): boolean {
  if (!currentUserRole) return false;
  
  if (targetUserId === currentUserId) {
    return false;
  }
  
  return currentUserRole === 'superadmin';
}

export function canAddEditUsers(currentUserRole: UserRole | undefined): boolean {
  if (!currentUserRole) return false;
  return currentUserRole === 'superadmin';
}

export function canAddEditOutlets(currentUserRole: UserRole | undefined): boolean {
  if (!currentUserRole) return false;
  return currentUserRole === 'superadmin';
}
