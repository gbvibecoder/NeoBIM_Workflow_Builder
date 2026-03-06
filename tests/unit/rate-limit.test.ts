import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit } from '@/lib/rate-limit';

// Mock Upstash
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class MockRatelimit {
    constructor() {}
    async limit() {
      return {
        success: true,
        limit: 1000,
        remaining: 999,
        reset: Date.now() + 86400000,
        pending: Promise.resolve(),
      };
    }
    static slidingWindow(requests: number, window: string) {
      return { requests, window };
    }
  },
}));

vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    constructor() {}
  },
}));

describe('Rate Limiting - CRITICAL PATH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Free Tier (3/day)', () => {
    it('should allow requests within limit', async () => {
      const userId = 'free-user-123';
      const result = await checkRateLimit(userId, 'FREE');

      expect(result.success).toBe(true);
      expect(result.limit).toBeGreaterThan(0);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Pro Tier (1000/day)', () => {
    it('should allow 1000 requests per day', async () => {
      const userId = 'pro-user-123';
      const result = await checkRateLimit(userId, 'PRO');

      expect(result.success).toBe(true);
      expect(result.limit).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('Admin Bypass (CRITICAL)', () => {
    it('should bypass rate limits for admin@test.com', async () => {
      const userId = 'admin-user-123';
      const userEmail = 'admin@test.com';

      const result = await checkRateLimit(userId, 'FREE', userEmail);

      expect(result.success).toBe(true);
      expect(result.limit).toBe(999999);
      expect(result.remaining).toBe(999999);
    });

    it('should bypass rate limits for admin email', async () => {
      const userId = 'rutik-123';
      const userEmail = 'erolerutik9@gmail.com';

      const result = await checkRateLimit(userId, 'FREE', userEmail);

      expect(result.success).toBe(true);
      expect(result.limit).toBe(999999);
    });

    it('should handle case-insensitive admin emails', async () => {
      const userId = 'admin-case-test';
      const userEmail = 'ADMIN@TEST.COM';

      const result = await checkRateLimit(userId, 'FREE', userEmail);

      expect(result.success).toBe(true);
      expect(result.limit).toBe(999999);
    });

    it('should NOT bypass for non-admin users', async () => {
      const userId = 'regular-user-123';
      const userEmail = 'user@example.com';

      const result = await checkRateLimit(userId, 'FREE', userEmail);
      expect(result.limit).not.toBe(999999);
    });
  });
});
