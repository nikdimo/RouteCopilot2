import type { Request } from "express";

export type AuthContext = {
  userId: string;
  aadOid: string;
  tenantId: string;
  email?: string;
  displayName?: string;
};

export type AdminRole = "support_admin" | "super_admin";

export type AdminContext = {
  role: AdminRole;
};

export type AuthenticatedRequest = Request & {
  auth?: AuthContext;
  admin?: AdminContext;
  rawBody?: Buffer;
};
