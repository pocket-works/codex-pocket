import { describe, expect, it } from "vitest";
import { developmentVersion, developmentVersionAt } from "../src/development-version.js";

describe("development version", () => {
  it("uses the release version with a UTC timestamp", () => {
    expect(developmentVersion("0.3.0", new Date("2026-10-19T07:21:31.000Z"))).toBe("0.3.0-dev.20261019T072131Z");
  });

  it("preserves prerelease identifiers", () => {
    expect(developmentVersion("0.4.0-rc.1", new Date("2026-10-19T07:21:31.123Z"))).toBe("0.4.0-rc.1-dev.20261019T072131Z");
  });

  it("accepts a fixed UTC build timestamp", () => {
    expect(developmentVersionAt("0.3.0", "20261019T072131Z")).toBe("0.3.0-dev.20261019T072131Z");
    expect(() => developmentVersionAt("0.3.0", "2026-10-19")).toThrow("Invalid development build timestamp");
  });
});
