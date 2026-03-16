import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to test a module that checks `typeof window`, so we'll
// mock the module in two scenarios: with and without window/localStorage.

describe("Cookie Consent — Client Side (window defined)", () => {
  let getTrackingConsent: typeof import("@/lib/cookie-consent").getTrackingConsent;
  let setTrackingConsent: typeof import("@/lib/cookie-consent").setTrackingConsent;
  let hasTrackingConsent: typeof import("@/lib/cookie-consent").hasTrackingConsent;

  const mockStorage: Record<string, string> = {};
  const mockDispatchEvent = vi.fn();

  beforeEach(async () => {
    // Clear storage
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    mockDispatchEvent.mockClear();

    // Set up window/localStorage mocks
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    };

    // Ensure window is defined (node env)
    if (typeof globalThis.window === "undefined") {
      Object.defineProperty(globalThis, "window", {
        value: {
          localStorage: mockLocalStorage,
          dispatchEvent: mockDispatchEvent,
        },
        writable: true,
        configurable: true,
      });
    } else {
      Object.defineProperty(globalThis.window, "localStorage", {
        value: mockLocalStorage,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(globalThis.window, "dispatchEvent", {
        value: mockDispatchEvent,
        writable: true,
        configurable: true,
      });
    }

    // Also set localStorage on globalThis for Node env
    Object.defineProperty(globalThis, "localStorage", {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });

    // Re-import to get fresh module with window defined
    vi.resetModules();
    const mod = await import("@/lib/cookie-consent");
    getTrackingConsent = mod.getTrackingConsent;
    setTrackingConsent = mod.setTrackingConsent;
    hasTrackingConsent = mod.hasTrackingConsent;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getTrackingConsent", () => {
    it("should return null when no consent has been set", () => {
      const result = getTrackingConsent();
      expect(result).toBeNull();
    });

    it('should return "accepted" when consent was accepted', () => {
      mockStorage["buildflow-cookie-consent"] = "accepted";
      const result = getTrackingConsent();
      expect(result).toBe("accepted");
    });

    it('should return "rejected" when consent was rejected', () => {
      mockStorage["buildflow-cookie-consent"] = "rejected";
      const result = getTrackingConsent();
      expect(result).toBe("rejected");
    });
  });

  describe("setTrackingConsent", () => {
    it("should store accepted consent in localStorage", () => {
      setTrackingConsent("accepted");
      expect(mockStorage["buildflow-cookie-consent"]).toBe("accepted");
    });

    it("should store rejected consent in localStorage", () => {
      setTrackingConsent("rejected");
      expect(mockStorage["buildflow-cookie-consent"]).toBe("rejected");
    });

    it("should dispatch CustomEvent with consent value", () => {
      setTrackingConsent("accepted");
      expect(mockDispatchEvent).toHaveBeenCalledTimes(1);

      const eventArg = mockDispatchEvent.mock.calls[0][0];
      expect(eventArg).toBeInstanceOf(CustomEvent);
      expect(eventArg.type).toBe("cookie-consent-change");
      expect(eventArg.detail).toBe("accepted");
    });

    it("should dispatch event with rejected value", () => {
      setTrackingConsent("rejected");

      const eventArg = mockDispatchEvent.mock.calls[0][0];
      expect(eventArg.detail).toBe("rejected");
    });

    it("should overwrite previous consent value", () => {
      setTrackingConsent("accepted");
      expect(mockStorage["buildflow-cookie-consent"]).toBe("accepted");

      setTrackingConsent("rejected");
      expect(mockStorage["buildflow-cookie-consent"]).toBe("rejected");
    });
  });

  describe("hasTrackingConsent", () => {
    it("should return false when no consent is set", () => {
      expect(hasTrackingConsent()).toBe(false);
    });

    it("should return true when consent is accepted", () => {
      mockStorage["buildflow-cookie-consent"] = "accepted";
      expect(hasTrackingConsent()).toBe(true);
    });

    it("should return false when consent is rejected", () => {
      mockStorage["buildflow-cookie-consent"] = "rejected";
      expect(hasTrackingConsent()).toBe(false);
    });
  });
});

describe("Cookie Consent — SSR (window undefined)", () => {
  let getTrackingConsent: typeof import("@/lib/cookie-consent").getTrackingConsent;
  let setTrackingConsent: typeof import("@/lib/cookie-consent").setTrackingConsent;
  let hasTrackingConsent: typeof import("@/lib/cookie-consent").hasTrackingConsent;

  beforeEach(async () => {
    // Remove window to simulate SSR
    // @ts-expect-error Intentionally removing window for SSR test
    delete globalThis.window;

    vi.resetModules();
    const mod = await import("@/lib/cookie-consent");
    getTrackingConsent = mod.getTrackingConsent;
    setTrackingConsent = mod.setTrackingConsent;
    hasTrackingConsent = mod.hasTrackingConsent;

    // We need to keep window undefined for the test
    // Restore in afterEach if needed
  });

  afterEach(() => {
    // Restore window if it was removed — next test block will set it up again
    if (typeof globalThis.window === "undefined") {
      Object.defineProperty(globalThis, "window", {
        value: {},
        writable: true,
        configurable: true,
      });
    }
  });

  it("getTrackingConsent should return null on SSR", () => {
    const result = getTrackingConsent();
    expect(result).toBeNull();
  });

  it("setTrackingConsent should be a no-op on SSR (no error)", () => {
    expect(() => setTrackingConsent("accepted")).not.toThrow();
  });

  it("hasTrackingConsent should return false on SSR", () => {
    expect(hasTrackingConsent()).toBe(false);
  });
});
