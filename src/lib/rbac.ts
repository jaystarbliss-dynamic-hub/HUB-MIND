import { Role, ResourcePermission, Visibility } from '../types';

export type AppAction =
  | 'view_users'
  | 'invite_user'
  | 'edit_user'
  | 'suspend_user'
  | 'revoke_user'
  | 'view_all_tasks'
  | 'create_task'
  | 'edit_task'
  | 'delete_task'
  | 'view_all_documents'
  | 'create_document'
  | 'edit_document'
  | 'delete_document'
  | 'view_all_projects'
  | 'create_project'
  | 'edit_project'
  | 'delete_project'
  | 'view_all_clients'
  | 'create_client'
  | 'edit_client'
  | 'delete_client'
  | 'view_all_meetings'
  | 'create_meeting'
  | 'edit_meeting'
  | 'delete_meeting'
  | 'access_knowledge_base'
  | 'manage_knowledge_base'
  | 'access_admin_settings'
  | 'view_activity_logs'
  | 'export_system_data'
  | 'manage_recurring_tasks'
  | 'manage_integrations';

const ADMIN_ACTIONS: AppAction[] = [
  'view_users',
  'invite_user',
  'edit_user',
  'suspend_user',
  'revoke_user',
  'view_all_tasks',
  'create_task',
  'edit_task',
  'delete_task',
  'view_all_documents',
  'create_document',
  'edit_document',
  'delete_document',
  'view_all_projects',
  'create_project',
  'edit_project',
  'delete_project',
  'view_all_clients',
  'create_client',
  'edit_client',
  'delete_client',
  'view_all_meetings',
  'create_meeting',
  'edit_meeting',
  'delete_meeting',
  'access_knowledge_base',
  'manage_knowledge_base',
  'access_admin_settings',
  'view_activity_logs',
  'export_system_data',
  'manage_recurring_tasks',
  'manage_integrations',
];

const STAFF_ACTIONS: AppAction[] = [
  'create_task',
  'edit_task',
  'create_document',
  'edit_document',
  'create_project',
  'edit_project',
  'create_meeting',
  'edit_meeting',
  'access_knowledge_base',
];

export function canPerformAction(role: Role | string | undefined | null, action: AppAction) {
  const normalized = role?.toLowerCase();
  if (normalized === 'admin') return ADMIN_ACTIONS.includes(action);
  if (normalized === 'staff') return STAFF_ACTIONS.includes(action);
  return false;
}

export function isAdmin(role: Role | string | undefined | null) {
  return role?.toLowerCase() === 'admin';
}

export function isStaff(role: Role | string | undefined | null) {
  return role?.toLowerCase() === 'staff';
}

export function canAccessRoute(role: Role | string | undefined | null, path: string) {
  if (path.startsWith('/admin') || path.startsWith('/users')) return isAdmin(role);
  return !!role;
}

export function isWritePermission(perm: string | undefined | null): boolean {
  if (!perm) return false;
  const normalized = String(perm).toLowerCase();
  return normalized === 'write' || normalized === 'edit';
}

export function isReadPermission(perm: string | undefined | null): boolean {
  if (!perm) return false;
  const normalized = String(perm).toLowerCase();
  return normalized === 'read' || normalized === 'view' || normalized === 'write' || normalized === 'edit';
}

export function isSharedWith(
  sharedWith: Record<string, ResourcePermission | string> | string[] | undefined | null,
  uid: string,
  permissions?: Record<string, ResourcePermission | string> | undefined | null
): boolean {
  if (!uid) return false;
  if (permissions && typeof permissions === 'object' && isReadPermission(permissions[uid])) {
    return true;
  }
  if (!sharedWith) return false;
  if (Array.isArray(sharedWith)) return sharedWith.includes(uid);
  if (typeof sharedWith === 'object') {
    return uid in sharedWith && isReadPermission((sharedWith as Record<string, string>)[uid]);
  }
  return false;
}

export function hasSharedWriteAccess(
  sharedWith: Record<string, ResourcePermission | string> | string[] | undefined | null,
  uid: string,
  permissions?: Record<string, ResourcePermission | string> | undefined | null
): boolean {
  if (!uid) return false;
  if (permissions && typeof permissions === 'object' && uid in permissions) {
    return isWritePermission(permissions[uid]);
  }
  if (!sharedWith) return false;
  if (Array.isArray(sharedWith)) {
    return sharedWith.includes(uid);
  }
  if (typeof sharedWith === 'object') {
    return isWritePermission((sharedWith as Record<string, string>)[uid]);
  }
  return false;
}

export function canReadResource(
  ownerId: string | undefined,
  uid: string,
  visibility: Visibility = 'private',
  sharedWith: Record<string, ResourcePermission | string> | string[] = {},
  permissions?: Record<string, ResourcePermission | string>,
  createdBy?: string
) {
  return (
    ownerId === uid ||
    createdBy === uid ||
    visibility === 'workspace' ||
    isSharedWith(sharedWith, uid, permissions)
  );
}

export function canWriteResource(
  ownerId: string | undefined,
  uid: string,
  visibility: Visibility = 'private',
  sharedWith: Record<string, ResourcePermission | string> | string[] = {},
  permissions?: Record<string, ResourcePermission | string>,
  createdBy?: string
) {
  if (ownerId === uid || createdBy === uid || visibility === 'workspace') return true;
  return hasSharedWriteAccess(sharedWith, uid, permissions);
}
