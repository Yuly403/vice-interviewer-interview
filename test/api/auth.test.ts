import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vice/database";
import { signToken, verifyToken } from "../../apps/api/src/plugins/auth.js";
import jwt from "jsonwebtoken";

const TEST_OPEN_ID = "ou-test-auth-001";

describe("API Integration: Auth flow", () => {
  beforeAll(async () => {
    // Clean up any previous test data
    await prisma.user.deleteMany({ where: { feishuOpenId: TEST_OPEN_ID } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { feishuOpenId: TEST_OPEN_ID } });
    await prisma.$disconnect();
  });

  describe("JWT sign / verify", () => {
    it("should sign a valid JWT token", () => {
      process.env.JWT_SECRET = "test-secret-key";
      const token = signToken({
        sub: "user-test-1",
        feishuOpenId: TEST_OPEN_ID,
        displayName: "测试用户",
        role: "interviewer",
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT has 3 parts
    });

    it("should verify a valid JWT token", () => {
      process.env.JWT_SECRET = "test-secret-key";
      const token = signToken({
        sub: "user-test-1",
        feishuOpenId: TEST_OPEN_ID,
        displayName: "测试用户",
        role: "interviewer",
      });

      const payload = verifyToken(token);
      expect(payload.sub).toBe("user-test-1");
      expect(payload.feishuOpenId).toBe(TEST_OPEN_ID);
      expect(payload.displayName).toBe("测试用户");
      expect(payload.role).toBe("interviewer");
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it("should reject an expired token", () => {
      process.env.JWT_SECRET = "test-secret-key";
      // Create a token that expired 1 hour ago
      const expiredToken = jwt.sign(
        { sub: "user-test-1", feishuOpenId: TEST_OPEN_ID, displayName: "测试", role: "interviewer" },
        "test-secret-key",
        { expiresIn: "-1h" }
      );

      expect(() => verifyToken(expiredToken)).toThrow();
    });

    it("should reject a token with wrong secret", () => {
      process.env.JWT_SECRET = "test-secret-key";
      const token = signToken({
        sub: "user-test-1",
        feishuOpenId: TEST_OPEN_ID,
        displayName: "测试用户",
        role: "interviewer",
      });

      // Change secret
      process.env.JWT_SECRET = "different-secret";
      expect(() => verifyToken(token)).toThrow();
    });
  });

  describe("User creation via findOrCreateUser", () => {
    it("should create a new user on first login", async () => {
      const { findOrCreateUser } = await import("../../apps/api/src/services/user.js");

      const user = await findOrCreateUser({
        feishuOpenId: TEST_OPEN_ID,
        displayName: "测试用户",
        email: "test@example.com",
        avatarUrl: "https://example.com/avatar.png",
      });

      expect(user).toBeDefined();
      expect(user.feishuOpenId).toBe(TEST_OPEN_ID);
      expect(user.displayName).toBe("测试用户");
      expect(user.email).toBe("test@example.com");
      expect(user.role).toBe("recruiter"); // default role
    });

    it("should return existing user on subsequent login", async () => {
      const { findOrCreateUser } = await import("../../apps/api/src/services/user.js");

      const user1 = await findOrCreateUser({
        feishuOpenId: TEST_OPEN_ID,
        displayName: "测试用户",
      });

      const user2 = await findOrCreateUser({
        feishuOpenId: TEST_OPEN_ID,
        displayName: "测试用户(更新)",
        email: "updated@example.com",
      });

      expect(user2.id).toBe(user1.id);
      expect(user2.feishuOpenId).toBe(TEST_OPEN_ID);
      // Display name should be updated
      expect(user2.displayName).toBe("测试用户(更新)");
      expect(user2.email).toBe("updated@example.com");
    });
  });

  describe("getUserById", () => {
    it("should return user by id", async () => {
      const { findOrCreateUser, getUserById } = await import("../../apps/api/src/services/user.js");

      const user = await findOrCreateUser({
        feishuOpenId: TEST_OPEN_ID,
        displayName: "测试用户",
      });

      const found = await getUserById(user.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(user.id);
      expect(found!.displayName).toBeDefined();
    });

    it("should return null for unknown user id", async () => {
      const { getUserById } = await import("../../apps/api/src/services/user.js");
      const found = await getUserById("non-existent-id");
      expect(found).toBeNull();
    });
  });

});
