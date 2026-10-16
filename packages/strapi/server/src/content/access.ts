import type { AgentUser } from "@klymbak/server";
import type { Core } from "@strapi/strapi";
import type { StrapiAdminUser } from "../auth.ts";

/** Strapi's content-manager permission checker for one content type and one person. */
export interface PermissionChecker {
  can: PermissionTest;
  cannot: PermissionTest;
  sanitizeOutput(data: unknown): Promise<Record<string, unknown>>;
  sanitizeCreateInput(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  sanitizeUpdateInput(entity: unknown): (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  sanitizedQuery: SanitizedQuery & Record<"read" | "update" | "delete" | "publish", (query: Record<string, unknown>) => Promise<Record<string, any>>>;
}

type SanitizedQuery = (query: Record<string, unknown>, action?: unknown) => Promise<Record<string, any>>;

type PermissionTest = ((action: string, entity?: unknown, field?: string) => boolean) &
  Record<"read" | "create" | "update" | "delete" | "publish" | "unpublish" | "discard", (entity?: unknown, field?: string) => boolean>;

export class ContentToolError extends Error {}

export const forbidden = (what: string) =>
  new ContentToolError(`Your Strapi role doesn't allow you to ${what}. Ask a super admin to change the role's permissions if you need this.`);

/** The signed-in admin behind a conversation, with the permissions their roles grant right now. */
export interface Actor {
  admin: StrapiAdminUser & { id: number | string };
  ability: unknown;
}

/**
 * Loads the Strapi admin a conversation belongs to and builds their permissions, the way the
 * admin panel does for each request. Runs on every tool call, so role changes apply at once and
 * deactivated admins lose access, also in scheduled runs.
 */
export async function loadActor(strapi: Core.Strapi, user: AgentUser): Promise<Actor> {
  const id = /^\d+$/.test(user.id) ? Number(user.id) : user.id;
  const admin = (await strapi.db.query("admin::user").findOne({ where: { id }, populate: ["roles"] })) as Actor["admin"] | null;
  if (!admin || admin.isActive !== true) {
    throw new ContentToolError(
      "Content tools act as a Strapi admin, and this conversation has none that is active. Scheduled tasks from config need `systemUser` set to an admin's id.",
    );
  }
  const ability = await strapi.service("admin::permission").engine.generateUserAbility(admin);
  return { admin, ability };
}

export function permissionChecker(strapi: Core.Strapi, ability: unknown, uid: string): PermissionChecker {
  return strapi.plugin("content-manager").service("permission-checker").create({ userAbility: ability, model: uid });
}

/** A Strapi error as one readable line, including which fields failed validation. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = (error as { details?: { errors?: { path?: (string | number)[]; message?: string }[] } }).details;
  const problems = details?.errors?.map((e) => `${e.path?.join(".") || "entry"}: ${e.message}`) ?? [];
  if (error.name === "ForbiddenError") return "Strapi refused this: your role doesn't allow it.";
  if (error.name === "NotFoundError") return error.message || "Not found.";
  return problems.length ? `${error.message}. ${problems.join("; ")}` : error.message;
}
