/**
 * Smoke test: confirm the logger is a real pino instance and that calling
 * `.child()` returns a usable child logger.
 *
 * Why: every other agent imports `log` from this file. A test that fails
 * here means *every* downstream test is at risk. Cheap insurance.
 */
import { describe, it, expect } from "vitest";
import { log } from "@/lib/logger";

describe("logger", () => {
  it("exports a pino-like instance with the standard methods", () => {
    expect(typeof log.info).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.child).toBe("function");
  });

  it("child() returns a logger with the same methods", () => {
    const child = log.child({ requestId: "test-123" });
    expect(typeof child.info).toBe("function");
    // Children preserve bindings; calling them should not throw.
    expect(() => child.info("smoke")).not.toThrow();
  });
});
