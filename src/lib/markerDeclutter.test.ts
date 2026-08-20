import { describe, expect, it } from "vitest";
import {
  computeDeclutterOffsets,
  DECLUTTER_COLLISION_RADIUS,
  MAX_CLUSTER_DIAGONAL,
  MAX_CLUSTER_MEMBERS,
} from "./markerDeclutter";
import type { ScreenPoint } from "./markerDeclutter";

describe("computeDeclutterOffsets", () => {
  it("returns an empty array for an empty array of points", () => {
    expect(computeDeclutterOffsets([])).toEqual([]);
  });

  it("gives a single point a zero offset", () => {
    const points: ScreenPoint[] = [{ key: "a", x: 100, y: 100 }];
    expect(computeDeclutterOffsets(points)).toEqual([
      { key: "a", dx: 0, dy: 0 },
    ]);
  });

  it("gives two points far apart both a zero offset", () => {
    const points: ScreenPoint[] = [
      { key: "a", x: 0, y: 0 },
      { key: "b", x: 300, y: 0 },
    ];
    const offsets = computeDeclutterOffsets(points);
    expect(offsets).toHaveLength(2);
    offsets.forEach((offset) => {
      expect(offset.dx).toBe(0);
      expect(offset.dy).toBe(0);
    });
  });

  it("nudges two very close points apart in roughly opposite directions", () => {
    const points: ScreenPoint[] = [
      { key: "a", x: 100, y: 100 },
      { key: "b", x: 105, y: 100 },
    ];
    const offsets = computeDeclutterOffsets(points);
    const a = offsets.find((offset) => offset.key === "a");
    const b = offsets.find((offset) => offset.key === "b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Neither point stayed put.
    expect(a?.dx !== 0 || a?.dy !== 0).toBe(true);
    expect(b?.dx !== 0 || b?.dy !== 0).toBe(true);

    // With a 2-member cluster, the algorithm places the points at angles 0
    // and PI apart (index 0 and 1 of 2) — i.e. diametrically opposite on the
    // spread circle. The cleanest way to assert "roughly opposite
    // directions" without depending on exact angle values is to check that
    // the vector connecting the two offset points has a magnitude of
    // roughly 2 * spreadRadius (since both points sit on a circle of that
    // radius, on opposite sides).
    const spreadRadius = DECLUTTER_COLLISION_RADIUS * (1 + 2 * 0.3);
    const dx = (a?.dx ?? 0) - (b?.dx ?? 0);
    const dy = (a?.dy ?? 0) - (b?.dy ?? 0);
    const separation = Math.sqrt(dx * dx + dy * dy);
    expect(separation).toBeCloseTo(2 * spreadRadius, 5);

    // Equivalently, their dx values should have opposite signs (or one is
    // zero) since they're spread along the x-axis at angles 0 and PI.
    expect(Math.sign(a?.dx ?? 0)).not.toBe(Math.sign(b?.dx ?? 0));
  });

  it("spreads three mutually-close points at roughly 120 degree angles", () => {
    const points: ScreenPoint[] = [
      { key: "a", x: 100, y: 100 },
      { key: "b", x: 103, y: 100 },
      { key: "c", x: 100, y: 103 },
    ];
    const offsets = computeDeclutterOffsets(points);
    expect(offsets).toHaveLength(3);
    offsets.forEach((offset) => {
      expect(offset.dx !== 0 || offset.dy !== 0).toBe(true);
    });

    const angles = offsets
      .map((offset) => Math.atan2(offset.dy, offset.dx))
      .sort((x, y) => x - y);

    // Angular gaps between consecutive points on the circle (wrapping the
    // last gap around through 2*PI) should each be close to 2*PI/3 (120deg).
    const gaps = [
      angles[1] - angles[0],
      angles[2] - angles[1],
      angles[0] + 2 * Math.PI - angles[2],
    ];
    gaps.forEach((gap) => {
      expect(gap).toBeCloseTo((2 * Math.PI) / 3, 1);
    });
  });

  it("clusters transitively: A-B close, B-C close, but A-C alone would be too far", () => {
    // A and B are 10px apart; B and C are 10px apart; A and C are 40px apart
    // (which alone exceeds the default 24px radius) but they're still one
    // cluster because collisions chain transitively through B. Note: with
    // A-B and B-C both 15px (comfortably inside the 24px radius), the
    // triangle inequality caps A-C at 30px when collinear — a smaller gap
    // than 40 is unavoidable while still keeping A-B and B-C each under the
    // radius, but 30px still clears the 24px radius on its own, which is
    // exactly the property under test: A and C would NOT cluster directly.
    const points: ScreenPoint[] = [
      { key: "a", x: 0, y: 0 },
      { key: "b", x: 15, y: 0 },
      { key: "c", x: 30, y: 0 },
    ];
    const offsets = computeDeclutterOffsets(points);
    expect(offsets).toHaveLength(3);
    offsets.forEach((offset) => {
      expect(offset.dx !== 0 || offset.dy !== 0).toBe(true);
    });
  });

  it("computes two separate far-apart clusters independently", () => {
    const cluster1: ScreenPoint[] = [
      { key: "a1", x: 0, y: 0 },
      { key: "a2", x: 5, y: 0 },
    ];
    const cluster2: ScreenPoint[] = [
      { key: "b1", x: 1000, y: 1000 },
      { key: "b2", x: 1005, y: 1000 },
    ];
    const points = [...cluster1, ...cluster2];
    const offsets = computeDeclutterOffsets(points);
    expect(offsets).toHaveLength(4);

    const spreadRadius = DECLUTTER_COLLISION_RADIUS * (1 + 2 * 0.3);
    const centroid1 = { x: 2.5, y: 0 };
    const centroid2 = { x: 1002.5, y: 1000 };

    function adjustedPositionFor(key: string): { x: number; y: number } {
      const truePoint = points.find((point) => point.key === key);
      const offset = offsets.find((candidate) => candidate.key === key);
      if (truePoint === undefined || offset === undefined) {
        throw new Error(`missing point or offset for ${key}`);
      }
      return { x: truePoint.x + offset.dx, y: truePoint.y + offset.dy };
    }

    function distance(
      p: { x: number; y: number },
      q: { x: number; y: number },
    ): number {
      return Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2);
    }

    // Cluster 1's nudged points stay near cluster 1's own centroid, and are
    // nowhere close to cluster 2's centroid (which is ~1400px away) — proof
    // the two clusters were spread independently rather than, say, being
    // treated as one big four-point cluster.
    ["a1", "a2"].forEach((key) => {
      const adjusted = adjustedPositionFor(key);
      expect(distance(adjusted, centroid1)).toBeLessThanOrEqual(
        spreadRadius + 1e-6,
      );
      expect(distance(adjusted, centroid2)).toBeGreaterThan(spreadRadius);
    });

    ["b1", "b2"].forEach((key) => {
      const adjusted = adjustedPositionFor(key);
      expect(distance(adjusted, centroid2)).toBeLessThanOrEqual(
        spreadRadius + 1e-6,
      );
      expect(distance(adjusted, centroid1)).toBeGreaterThan(spreadRadius);
    });
  });

  it("does not spread a long chain of merely-adjacent points into one giant cluster", () => {
    // Single-linkage (transitive) clustering means a chain of points each
    // just inside the collision radius of the next can bridge an enormous
    // distance overall — e.g. a pin in the USA transitively "colliding"
    // with one in Australia through many pins in between. Build a chain
    // whose consecutive gaps are all well inside the default 24px radius,
    // but whose overall span far exceeds MAX_CLUSTER_DIAGONAL.
    const chainLength = 30;
    const stepPx = 10;
    const points: ScreenPoint[] = Array.from(
      { length: chainLength },
      (_, index) => ({
        key: `chain-${index}`,
        x: index * stepPx,
        y: 0,
      }),
    );
    expect((chainLength - 1) * stepPx).toBeGreaterThan(MAX_CLUSTER_DIAGONAL);

    const offsets = computeDeclutterOffsets(points);
    expect(offsets).toHaveLength(chainLength);
    offsets.forEach((offset) => {
      expect(offset).toMatchObject({ dx: 0, dy: 0 });
    });
  });

  it("does not spread a cluster with more members than MAX_CLUSTER_MEMBERS, even if tightly packed", () => {
    const memberCount = MAX_CLUSTER_MEMBERS + 1;
    const points: ScreenPoint[] = Array.from(
      { length: memberCount },
      (_, index) => ({
        key: `dense-${index}`,
        // All within a couple of pixels of the origin — tightly packed,
        // well under MAX_CLUSTER_DIAGONAL — but too many members.
        x: (index % 3) * 2,
        y: Math.floor(index / 3) * 2,
      }),
    );
    const offsets = computeDeclutterOffsets(points);
    expect(offsets).toHaveLength(memberCount);
    offsets.forEach((offset) => {
      expect(offset).toMatchObject({ dx: 0, dy: 0 });
    });
  });

  it("still spreads a small, genuinely local cluster normally", () => {
    // Sanity check that the chain-rejection caps don't over-trigger for an
    // ordinary small local collision.
    const points: ScreenPoint[] = [
      { key: "a", x: 0, y: 0 },
      { key: "b", x: 5, y: 0 },
      { key: "c", x: 0, y: 5 },
    ];
    const offsets = computeDeclutterOffsets(points);
    expect(offsets).toHaveLength(3);
    offsets.forEach((offset) => {
      expect(offset.dx !== 0 || offset.dy !== 0).toBe(true);
    });
  });
});
