import type { AgentUser } from "@klymbak/server";

/** The fields of a Strapi admin user (admin::user) the plugin reads. */
export interface StrapiAdminUser {
  id: number | string;
  firstname?: string | null;
  lastname?: string | null;
  username?: string | null;
  email?: string | null;
  isActive?: boolean;
  roles?: { id?: number | string; code: string; name?: string }[];
}

export const SUPER_ADMIN = "strapi-super-admin";

/**
 * The agent acts for this person. Roles are the Strapi admin role codes (strapi-super-admin,
 * strapi-editor, strapi-author or custom ones); super admins also get Klymbak's "admin" role,
 * which lets them see everyone's scheduled reports and manage integrations.
 */
export function toAgentUser(user: StrapiAdminUser): AgentUser {
  const roles = (user.roles ?? []).map((role) => role.code);
  if (roles.includes(SUPER_ADMIN)) roles.push("admin");
  const name = [user.firstname, user.lastname].filter(Boolean).join(" ") || user.username || user.email || `Admin ${user.id}`;
  return { id: String(user.id), name, roles, email: user.email ?? undefined };
}
