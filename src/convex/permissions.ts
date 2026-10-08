import { ConvexError, v, type Infer } from 'convex/values';

export const role = v.union(v.literal('rep'), v.literal('admin'));
export type Role = Infer<typeof role>;

export const permissions = v.object({ editCompanyProfile: v.boolean() });
export type Permissions = Infer<typeof permissions>;
export type Permission = keyof Permissions;

// Keep role policy here; callers check capabilities instead of individual roles.
export function permissionsForRole(role: Role): Permissions {
	return { editCompanyProfile: role === 'admin' };
}

export function assertPermission(role: Role, permission: Permission) {
	if (!permissionsForRole(role)[permission])
		throw new ConvexError('You do not have permission to perform this action.');
}
