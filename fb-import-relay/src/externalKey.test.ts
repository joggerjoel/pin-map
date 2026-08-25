import { describe, expect, test } from "bun:test";
import { computeExternalKey } from "./externalKey";

describe("computeExternalKey", () => {
  test("is deterministic for the same name and time", () => {
    const time = new Date("2011-11-30T21:49:51.000Z");
    const a = computeExternalKey("Busselton, Western Australia", time);
    const b = computeExternalKey("Busselton, Western Australia", time);
    expect(a).toBe(b);
  });

  test("differs for different visit times", () => {
    const a = computeExternalKey(
      "Busselton, Western Australia",
      new Date("2011-11-30T21:49:51.000Z"),
    );
    const b = computeExternalKey(
      "Busselton, Western Australia",
      new Date("2011-12-01T11:55:58.000Z"),
    );
    expect(a).not.toBe(b);
  });

  test("differs for different place names at the same time", () => {
    const time = new Date("2011-11-30T21:49:51.000Z");
    const a = computeExternalKey("Busselton, Western Australia", time);
    const b = computeExternalKey("Somewhere Else", time);
    expect(a).not.toBe(b);
  });

  test("is case- and whitespace-insensitive on the name (same real place)", () => {
    const time = new Date("2011-11-30T21:49:51.000Z");
    const a = computeExternalKey("Busselton, Western Australia", time);
    const b = computeExternalKey("  BUSSELTON,  Western Australia  ", time);
    expect(a).toBe(b);
  });

  test("distinguishes near-duplicate names that are not the same place", () => {
    const time = new Date("2012-09-01T06:40:30.000Z");
    const a = computeExternalKey("圓方", time);
    const b = computeExternalKey("ELEMENTS 圓方", time);
    expect(a).not.toBe(b);
  });
});
