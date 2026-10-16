import type { AgentUser } from "@klymbak/server";

/**
 * Demo identities. In a real deployment `auth` would read your session cookie or JWT
 * and return the signed-in staff member; tools then act with that person's roles.
 */
export const DEMO_USERS: Record<string, AgentUser & { title: string }> = {
  admin: { id: "u-olivia", name: "Olivia Hart", roles: ["admin"], title: "Operations lead" },
  support: { id: "u-marcus", name: "Marcus Lee", roles: ["support"], title: "Customer support" },
  analyst: { id: "u-priya", name: "Priya Natarajan", roles: ["analyst"], title: "Data analyst" },
};

export function demoAuth(request: Request): AgentUser {
  const key = request.headers.get("x-demo-user") ?? new URL(request.url).searchParams.get("as") ?? "admin";
  return DEMO_USERS[key] ?? DEMO_USERS.admin!;
}
