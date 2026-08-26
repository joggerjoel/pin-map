import { describe, expect, it, vi } from "vitest";
import { walkAllPages } from "./pagination";

function row(id: string, createdAt: string) {
  return { id, createdAt };
}

describe("walkAllPages", () => {
  it("returns everything from a single short page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce([row("1", "2026-01-01T00:00:00.000Z")]);

    const result = await walkAllPages(fetchPage, 60);

    expect(result).toEqual([row("1", "2026-01-01T00:00:00.000Z")]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null);
  });

  it("walks every page of a multi-page result set, not just the first", async () => {
    const page1 = [
      row("1", "2026-01-01T00:00:00.000Z"),
      row("2", "2026-01-02T00:00:00.000Z"),
    ];
    const page2 = [row("3", "2026-01-03T00:00:00.000Z")];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const result = await walkAllPages(fetchPage, 2);

    expect(result).toEqual([...page1, ...page2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      createdAt: "2026-01-02T00:00:00.000Z",
      id: "2",
    });
  });

  it("stops exactly on a page equal to pageSize followed by an empty page", async () => {
    const fullPage = [
      row("1", "2026-01-01T00:00:00.000Z"),
      row("2", "2026-01-02T00:00:00.000Z"),
    ];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([]);

    const result = await walkAllPages(fetchPage, 2);

    expect(result).toEqual(fullPage);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("returns null (not a partial list) if any page fetch fails", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce([
        row("1", "2026-01-01T00:00:00.000Z"),
        row("2", "2026-01-02T00:00:00.000Z"),
      ])
      .mockResolvedValueOnce(null);

    const result = await walkAllPages(fetchPage, 2);

    expect(result).toBeNull();
  });
});
