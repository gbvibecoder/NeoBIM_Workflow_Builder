import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { kosLog } from "../kos-logger";

describe("kos-logger", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("level suppression", () => {
    it("suppresses debug when NODE_ENV !== 'development'", () => {
      vi.stubEnv("NODE_ENV", "production");
      kosLog.debug("ev_debug_should_be_silent", { drawingId: "d1" });
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("suppresses debug when NODE_ENV === 'test'", () => {
      vi.stubEnv("NODE_ENV", "test");
      kosLog.debug("ev_debug_test_silent");
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("emits debug when NODE_ENV === 'development'", () => {
      vi.stubEnv("NODE_ENV", "development");
      kosLog.debug("ev_debug_dev", { drawingId: "d1" });
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it("always emits info / warn / error regardless of env", () => {
      vi.stubEnv("NODE_ENV", "production");
      kosLog.info("ev_info");
      kosLog.warn("ev_warn");
      kosLog.error("ev_error");
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("output shape", () => {
    it("emits valid JSON with ts, level, event, plus ctx keys merged", () => {
      vi.stubEnv("NODE_ENV", "production");
      kosLog.info("ev_shape", {
        tenantId: "t_1",
        customerId: "c_1",
        durationMs: 123,
      });
      const line = logSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(line);
      expect(parsed.level).toBe("info");
      expect(parsed.event).toBe("ev_shape");
      expect(parsed.tenantId).toBe("t_1");
      expect(parsed.customerId).toBe("c_1");
      expect(parsed.durationMs).toBe(123);
      expect(typeof parsed.ts).toBe("string");
      // ISO 8601 sanity
      expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("routes error → console.error", () => {
      vi.stubEnv("NODE_ENV", "production");
      kosLog.error("ev_err", { errorCode: "KOS_X_001" });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
      expect(parsed.errorCode).toBe("KOS_X_001");
    });

    it("routes warn → console.warn", () => {
      vi.stubEnv("NODE_ENV", "production");
      kosLog.warn("ev_warn", {});
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("routes info → console.log", () => {
      vi.stubEnv("NODE_ENV", "production");
      kosLog.info("ev_info");
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("defensive ctx", () => {
    it("does NOT throw when ctx contains a circular reference", () => {
      vi.stubEnv("NODE_ENV", "production");
      const ctx: Record<string, unknown> = { tenantId: "t_1" };
      ctx.self = ctx;
      expect(() => kosLog.info("ev_circular", ctx)).not.toThrow();
      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed._ctxSerializationError).toBe(true);
    });
  });
});
