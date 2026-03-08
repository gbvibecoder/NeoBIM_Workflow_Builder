import { describe, it, expect } from 'vitest';
import {
  validateTR003Input,
  validateGN003Input,
  validateTR007Input,
  validateTR008Input,
  validateEX002Input,
  validateNodeInput,
  assertValidInput,
} from '@/lib/validation';

describe('Validation - CRITICAL PATH', () => {
  describe('TR-003: Design Brief Analyzer', () => {
    it('should accept valid prompt (min 10 chars)', () => {
      const result = validateTR003Input({ prompt: 'Build a commercial office' });
      expect(result.valid).toBe(true);
    });

    it('should reject prompt < 10 chars', () => {
      const result = validateTR003Input({ prompt: 'Short' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too short');
    });

    it('should reject prompt > 500 chars', () => {
      const longPrompt = 'A'.repeat(501);
      const result = validateTR003Input({ prompt: longPrompt });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should reject non-string prompt', () => {
      const result = validateTR003Input({ prompt: 123 });
      expect(result.valid).toBe(false);
    });

    it('should accept content field as alias for prompt', () => {
      const result = validateTR003Input({ content: 'Valid building description' });
      expect(result.valid).toBe(true);
    });
  });

  describe('GN-003: Concept Render Generator', () => {
    it('should accept building description object with projectName', () => {
      const buildingDesc = {
        projectName: 'Commercial Office',
        buildingType: 'Office Building',
      };
      const result = validateGN003Input(buildingDesc);
      expect(result.valid).toBe(true);
    });

    it('should accept simple prompt string', () => {
      const result = validateGN003Input({ prompt: 'Modern office building with glass facade' });
      expect(result.valid).toBe(true);
    });

    it('should reject empty input', () => {
      const result = validateGN003Input(null);
      expect(result.valid).toBe(false);
    });

    it('should reject prompt < 10 chars', () => {
      const result = validateGN003Input({ prompt: 'Short' });
      expect(result.valid).toBe(false);
    });
  });

  describe('TR-007: Quantity Extractor', () => {
    it('should accept IFC data', () => {
      const result = validateTR007Input({ ifcData: { elements: [] } });
      expect(result.valid).toBe(true);
    });

    it('should accept null input (fallback mode)', () => {
      const result = validateTR007Input(null);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid IFC data format', () => {
      const result = validateTR007Input({ ifcData: 'invalid-string' });
      expect(result.valid).toBe(false);
    });
  });

  describe('TR-008: BOQ Cost Mapper', () => {
    it('should accept elements from TR-007', () => {
      const result = validateTR008Input({
        elements: [
          { name: 'Wall', quantity: 100 },
          { name: 'Door', quantity: 5 },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept rows field as alias', () => {
      const result = validateTR008Input({
        rows: [{ name: 'Wall', quantity: 100 }],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing elements', () => {
      const result = validateTR008Input({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No elements');
    });

    it('should reject empty elements array', () => {
      const result = validateTR008Input({ elements: [] });
      expect(result.valid).toBe(false);
    });
  });

  describe('EX-002: BOQ Spreadsheet Exporter', () => {
    it('should accept valid rows and headers', () => {
      const result = validateEX002Input({
        rows: [[1, 'Wall', 100, 5000]],
        headers: ['ID', 'Item', 'Quantity', 'Cost'],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing rows', () => {
      const result = validateEX002Input({ headers: ['ID', 'Item'] });
      expect(result.valid).toBe(false);
    });

    it('should reject missing headers', () => {
      const result = validateEX002Input({ rows: [[1, 'Wall']] });
      expect(result.valid).toBe(false);
    });

    it('should reject empty rows array', () => {
      const result = validateEX002Input({
        rows: [],
        headers: ['ID', 'Item'],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('validateNodeInput - Router Function', () => {
    it('should route TR-003 correctly', () => {
      const result = validateNodeInput('TR-003', { prompt: 'Valid prompt here' });
      expect(result.valid).toBe(true);
    });

    it('should route GN-003 correctly', () => {
      const result = validateNodeInput('GN-003', { prompt: 'Valid image prompt' });
      expect(result.valid).toBe(true);
    });

    it('should pass unknown nodes (future-proof)', () => {
      const result = validateNodeInput('UNKNOWN-999', { anyData: true });
      expect(result.valid).toBe(true);
    });
  });

  describe('assertValidInput - Throw on Invalid', () => {
    it('should NOT throw for valid input', () => {
      expect(() => {
        assertValidInput('TR-003', { prompt: 'Valid building prompt' });
      }).not.toThrow();
    });

    it('should throw APIError for invalid input', () => {
      expect(() => {
        assertValidInput('TR-003', { prompt: 'Short' });
      }).toThrow();
    });
  });
});
