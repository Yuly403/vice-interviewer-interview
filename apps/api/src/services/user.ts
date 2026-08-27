/**
 * User Service — CRUD operations for the User model
 */
import { prisma } from "../db.js";
import { encryptSecret } from "./secret-crypto.js";

export type UserRecord = {
  id: string;
  feishuOpenId: string;
  displayName: string;
  email: string | null;
  role: string;
  avatarUrl: string | null;
  feishuRefreshTokenEncrypted: string | null;
  feishuTokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Find or create a user by feishuOpenId.
 * Updates displayName, avatarUrl, refreshToken and tokenExpiresAt if provided and different.
 */
export async function findOrCreateUser(params: {
  feishuOpenId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}): Promise<UserRecord> {
  const updateData: Record<string, unknown> = {
    displayName: params.displayName,
  };
  if (params.email !== undefined) updateData.email = params.email;
  if (params.avatarUrl !== undefined) updateData.avatarUrl = params.avatarUrl;
  if (params.refreshToken !== undefined) {
    updateData.feishuRefreshTokenEncrypted = encryptSecret(params.refreshToken);
    // Do not keep newly received credentials in the legacy plaintext column.
    updateData.feishuRefreshToken = null;
  }
  if (params.tokenExpiresAt !== undefined) updateData.feishuTokenExpiresAt = params.tokenExpiresAt;

  return prisma.user.upsert({
    where: { feishuOpenId: params.feishuOpenId },
    update: updateData,
    create: {
      feishuOpenId: params.feishuOpenId,
      displayName: params.displayName,
      email: params.email ?? null,
      avatarUrl: params.avatarUrl ?? null,
      role: "recruiter",
      feishuRefreshToken: null,
      ...(params.refreshToken !== undefined
        ? { feishuRefreshTokenEncrypted: encryptSecret(params.refreshToken) }
        : {}),
      feishuTokenExpiresAt: params.tokenExpiresAt ?? null,
    },
  });
}

/**
 * Get user by ID.
 */
export async function getUserById(id: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Get user by feishuOpenId.
 */
export async function getUserByFeishuId(feishuOpenId: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({ where: { feishuOpenId } });
}

/**
 * Update user role.
 */
export async function updateUserRole(id: string, role: string): Promise<UserRecord> {
  return prisma.user.update({ where: { id }, data: { role } });
}

/**
 * List all users (for admin).
 */
export async function listUsers(): Promise<UserRecord[]> {
  return prisma.user.findMany({ orderBy: { createdAt: "desc" } });
}
