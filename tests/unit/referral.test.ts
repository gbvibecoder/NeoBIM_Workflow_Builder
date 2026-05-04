import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Upstash Redis ────────────────────────────────────────────────────

const mockRedisStore: Record<string, number> = {};

vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    constructor() {}
    async get(key: string) { return mockRedisStore[key] ?? null; }
    async incrby(key: string, val: number) {
      mockRedisStore[key] = (mockRedisStore[key] ?? 0) + val;
      return mockRedisStore[key];
    }
    async decrby(key: string, val: number) {
      mockRedisStore[key] = (mockRedisStore[key] ?? 0) - val;
      return mockRedisStore[key];
    }
    async del(key: string) { delete mockRedisStore[key]; return 1; }
    async eval(script: string, keys: string[], _args: unknown[]) {
      // Simulate the Lua script for consumeReferralBonus
      const key = keys[0];
      const current = mockRedisStore[key] ?? 0;
      if (current > 0) {
        mockRedisStore[key] = current - 1;
        return 1;
      }
      return 0;
    }
  },
}));

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class MockRatelimit {
    constructor() {}
    async limit() {
      return { success: true, limit: 1000, remaining: 999, reset: Date.now() + 86400000, pending: Promise.resolve() };
    }
    static slidingWindow(requests: number, window: string) {
      return { requests, window };
    }
  },
}));

// ─── Mock Prisma ───────────────────────────────────────────────────────────

const mockReferrals: Array<{
  id: string; referrerId: string; referredId: string | null;
  code: string; status: string; rewardGiven: boolean;
  createdAt: Date; completedAt: Date | null;
}> = [];

vi.mock('@/lib/db', () => ({
  prisma: {
    referral: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return mockReferrals.find(r => {
          if (where.code && r.code !== where.code) return false;
          if (where.status && r.status !== where.status) return false;
          if (where.referrerId && r.referrerId !== where.referrerId) return false;
          if (where.referredId && r.referredId !== where.referredId) return false;
          return true;
        }) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: `ref_${Date.now()}`,
          referrerId: data.referrerId as string,
          referredId: (data.referredId as string) ?? null,
          code: data.code as string,
          status: data.status as string,
          rewardGiven: (data.rewardGiven as boolean) ?? false,
          createdAt: new Date(),
          completedAt: (data.completedAt as Date) ?? null,
        };
        mockReferrals.push(record);
        return record;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));

vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(async () => {}),
}));

// ─── Import after mocks ───────────────────────────────────────────────────

import { claimReferralCode, REFERRAL_BONUS_PER_CLAIM } from '@/lib/referral';
import { getReferralBonus, consumeReferralBonus } from '@/lib/rate-limit';
import { t } from '@/lib/i18n';

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Referral System — Smoke Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Redis store
    Object.keys(mockRedisStore).forEach(k => delete mockRedisStore[k]);
    // Reset Prisma mock referrals
    mockReferrals.length = 0;
  });

  describe('REFERRAL_BONUS_PER_CLAIM constant', () => {
    it('should be 1', () => {
      expect(REFERRAL_BONUS_PER_CLAIM).toBe(1);
    });
  });

  describe('claimReferralCode — self-referral blocked', () => {
    it('should reject when referrer === referred user', async () => {
      // Seed a pending referral code owned by user-A
      mockReferrals.push({
        id: 'ref_1', referrerId: 'user-A', referredId: null,
        code: 'TESTA123', status: 'pending', rewardGiven: false,
        createdAt: new Date(), completedAt: null,
      });

      const result = await claimReferralCode('TESTA123', 'user-A');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot refer yourself');
    });
  });

  describe('claimReferralCode — successful referral grants bonus to both', () => {
    it('should grant +1 bonus to referrer and referred user', async () => {
      // Seed a pending referral code owned by user-A
      mockReferrals.push({
        id: 'ref_1', referrerId: 'user-A', referredId: null,
        code: 'TESTA123', status: 'pending', rewardGiven: false,
        createdAt: new Date(), completedAt: null,
      });

      const result = await claimReferralCode('TESTA123', 'user-B');

      expect(result.success).toBe(true);
      expect(mockRedisStore['referral:bonus:user-A']).toBe(1);
      expect(mockRedisStore['referral:bonus:user-B']).toBe(1);
    });
  });

  describe('claimReferralCode — duplicate claim blocked', () => {
    it('should reject when same referrer→referred pair already claimed', async () => {
      // Seed: pending code + already completed claim
      mockReferrals.push({
        id: 'ref_1', referrerId: 'user-A', referredId: null,
        code: 'TESTA123', status: 'pending', rewardGiven: false,
        createdAt: new Date(), completedAt: null,
      });
      mockReferrals.push({
        id: 'ref_2', referrerId: 'user-A', referredId: 'user-B',
        code: 'TESTA123-prev', status: 'completed', rewardGiven: true,
        createdAt: new Date(), completedAt: new Date(),
      });

      const result = await claimReferralCode('TESTA123', 'user-B');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Already claimed');
    });
  });

  describe('claimReferralCode — invalid code', () => {
    it('should reject when code does not exist', async () => {
      const result = await claimReferralCode('INVALID1', 'user-B');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid referral code');
    });
  });

  describe('i18n — empty string handling (FIX 1)', () => {
    it('should return empty string for referral.inviteTitleSuffix in EN', () => {
      const result = t('referral.inviteTitleSuffix' as never, 'en');
      expect(result).toBe('');
    });

    it('should return " auf" for referral.inviteTitleSuffix in DE', () => {
      const result = t('referral.inviteTitleSuffix' as never, 'de');
      expect(result).toBe(' auf');
    });

    it('should return key name for nonexistent key', () => {
      const result = t('nonexistent.key.xyz' as never, 'en');
      expect(result).toBe('nonexistent.key.xyz');
    });

    it('should return non-empty strings normally', () => {
      const result = t('referral.inviteTitlePart1' as never, 'en');
      expect(result).toBe('Build your');
    });
  });

  describe('consumeReferralBonus — atomic consumption (FIX 7)', () => {
    it('should consume bonus when available', async () => {
      mockRedisStore['referral:bonus:user-X'] = 2;

      const consumed = await consumeReferralBonus('user-X');

      expect(consumed).toBe(true);
      expect(mockRedisStore['referral:bonus:user-X']).toBe(1);
    });

    it('should NOT consume when balance is 0', async () => {
      mockRedisStore['referral:bonus:user-X'] = 0;

      const consumed = await consumeReferralBonus('user-X');

      expect(consumed).toBe(false);
      expect(mockRedisStore['referral:bonus:user-X']).toBe(0);
    });

    it('should NOT consume when key does not exist', async () => {
      const consumed = await consumeReferralBonus('user-Z');

      expect(consumed).toBe(false);
    });
  });

  describe('getReferralBonus', () => {
    it('should return 0 when no bonus exists', async () => {
      const bonus = await getReferralBonus('user-none');
      expect(bonus).toBe(0);
    });

    it('should return correct bonus count', async () => {
      mockRedisStore['referral:bonus:user-Y'] = 5;

      const bonus = await getReferralBonus('user-Y');
      expect(bonus).toBe(5);
    });
  });
});
