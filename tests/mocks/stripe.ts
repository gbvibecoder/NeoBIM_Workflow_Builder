import { vi } from 'vitest';

export const mockStripe = {
  webhooks: {
    constructEvent: vi.fn((_body, signature) => {
      if (signature === 'invalid') {
        throw new Error('Invalid signature');
      }
      return {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            mode: 'subscription',
            customer: 'cus_test_123',
            subscription: 'sub_test_123',
          },
        },
      };
    }),
  },
  subscriptions: {
    retrieve: vi.fn().mockResolvedValue({
      id: 'sub_test_123',
      customer: 'cus_test_123',
      status: 'active',
      items: {
        data: [
          {
            price: {
              id: 'price_test_pro',
            },
          },
        ],
      },
      current_period_end: Math.floor(Date.now() / 1000) + 2592000, // 30 days
    }),
  },
  customers: {
    create: vi.fn().mockResolvedValue({
      id: 'cus_test_123',
    }),
  },
  checkout: {
    sessions: {
      create: vi.fn().mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      }),
    },
  },
};

vi.mock('@/features/billing/lib/stripe', () => ({
  stripe: mockStripe,
  getPlanByPriceId: vi.fn((priceId) => {
    if (priceId === 'price_test_pro') return 'PRO';
    return 'FREE';
  }),
}));
