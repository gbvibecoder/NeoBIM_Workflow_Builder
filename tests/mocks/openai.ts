import { vi } from 'vitest';

// 1×1 transparent PNG — valid, decodable, tiny. Used as the canonical
// b64_json value for images.* mocks so tests exercising the b64 → R2 path
// receive a well-formed image.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9XQpCcMAAAAASUVORK5CYII=';

export const mockOpenAI = {
  chat: {
    completions: {
      create: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                projectName: 'Modern Office Building',
                buildingType: 'Commercial',
                floors: 5,
                plotArea: 1000,
              }),
            },
          },
        ],
      }),
    },
  },
  images: {
    // images.generate — returns URL by default for back-compat with existing tests.
    // normalizeImageResponse handles both URL and b64_json paths transparently.
    generate: vi.fn().mockResolvedValue({
      data: [
        {
          url: 'https://example.com/generated-image.png',
          b64_json: undefined,
          revised_prompt: 'mock revised prompt',
        },
      ],
    }),
    // images.edit — gpt-image-1.x always returns b64_json (no URL field).
    // Tests asserting on the b64 → R2 / data-URI path read this shape.
    edit: vi.fn().mockResolvedValue({
      data: [
        {
          url: undefined,
          b64_json: TINY_PNG_B64,
          revised_prompt: 'mock revised prompt',
        },
      ],
    }),
  },
};

vi.mock('openai', () => ({
  default: vi.fn(() => mockOpenAI),
}));
