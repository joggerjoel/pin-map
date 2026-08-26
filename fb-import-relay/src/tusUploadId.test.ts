import { describe, expect, test } from "bun:test";
import { isValidTusUploadId } from "./tusUploadId";

describe("isValidTusUploadId", () => {
  test("accepts a real tusd-generated id", () => {
    expect(isValidTusUploadId("6978e95d42c08815618d3bd8a9688e19")).toBe(true);
    expect(isValidTusUploadId("d364a396498101f11c3869dea8d1f148")).toBe(true);
  });

  test.each([
    "",
    "not-hex-at-all",
    "6978e95d42c08815618d3bd8a9688e1", // 31 chars, one short
    "6978e95d42c08815618d3bd8a9688e199", // 34 chars, too long
    "6978E95D42C08815618D3BD8A9688E19", // uppercase
    "../../../etc/passwd",
    "6978e95d42c08815618d3bd8a9688e19/../x",
    "6978e95d42c08815618d3bd8a9688e1g", // non-hex char
  ])("rejects %p", (id) => {
    expect(isValidTusUploadId(id)).toBe(false);
  });
});
