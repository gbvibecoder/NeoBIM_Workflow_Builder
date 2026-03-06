import { vi } from 'vitest';

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
    generate: vi.fn().mockResolvedValue({
      data: [
        {
          url: 'https://example.com/generated-image.png',
        },
      ],
    }),
  },
};

vi.mock('openai', () => ({
  default: vi.fn(() => mockOpenAI),
}));
