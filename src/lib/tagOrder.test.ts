import { beforeEach, describe, expect, it } from "vitest";
import { getTagOrder, saveTagOrder } from "./tagOrder";

beforeEach(() => {
  window.localStorage.clear();
});

describe("getTagOrder", () => {
  it("returns an empty array when nothing is stored", () => {
    expect(getTagOrder()).toEqual([]);
  });

  it("returns an empty array for malformed JSON", () => {
    window.localStorage.setItem("pin-map:tag-order", "{not valid");
    expect(getTagOrder()).toEqual([]);
  });

  it("filters out non-string entries", () => {
    window.localStorage.setItem(
      "pin-map:tag-order",
      JSON.stringify(["category:visited", 42, null, "icon:triathlete"]),
    );
    expect(getTagOrder()).toEqual(["category:visited", "icon:triathlete"]);
  });
});

describe("saveTagOrder", () => {
  it("persists and round-trips an order", () => {
    saveTagOrder(["category:hometown", "category:visited"]);
    expect(getTagOrder()).toEqual(["category:hometown", "category:visited"]);
  });
});
