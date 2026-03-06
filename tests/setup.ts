import { beforeAll, afterAll, afterEach } from 'vitest';

// Mock environment variables
beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.NEXTAUTH_SECRET = 'test-secret-key-for-testing-only';
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock';
  process.env.STRIPE_PRO_PRICE_ID = 'price_test_pro';
  process.env.UPSTASH_REDIS_REST_URL = 'http://localhost:8079';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  process.env.OPENAI_API_KEY = 'sk-test-mock-openai-key';
  process.env.ADMIN_EMAILS = 'admin@test.com,rutik@neobim.com';
});

afterEach(() => {
  // Clear all mocks after each test
});

afterAll(() => {
  // Cleanup
});
