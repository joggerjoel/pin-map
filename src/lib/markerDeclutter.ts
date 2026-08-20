export interface ScreenPoint {
  key: string;
  x: number;
  y: number;
}

export interface DeclutterOffset {
  key: string;
  dx: number;
  dy: number;
}

export const DECLUTTER_COLLISION_RADIUS = 24;

export function computeDeclutterOffsets(
  points: ScreenPoint[],
  collisionRadius: number = DECLUTTER_COLLISION_RADIUS,
): DeclutterOffset[] {
  const clusters = clusterPoints(points, collisionRadius);
  const offsets: DeclutterOffset[] = [];
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      offsets.push({ key: cluster[0].key, dx: 0, dy: 0 });
      continue;
    }
    const spreadRadius = collisionRadius * (1 + cluster.length * 0.3);
    cluster.forEach((point, index) => {
      const angle = (2 * Math.PI * index) / cluster.length;
      offsets.push({
        key: point.key,
        dx: Math.cos(angle) * spreadRadius,
        dy: Math.sin(angle) * spreadRadius,
      });
    });
  }
  return offsets;
}

// Transitive clustering: if A is close to B and B is close to C, all three
// end up in one cluster even if A and C alone would be far enough apart not
// to collide directly. Union-find over all pairwise distances.
function clusterPoints(points: ScreenPoint[], radius: number): ScreenPoint[][] {
  const n = points.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[rootA] = rootB;
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (Math.sqrt(dx * dx + dy * dy) < radius) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, ScreenPoint[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const existing = groups.get(root);
    if (existing) {
      existing.push(points[i]);
    } else {
      groups.set(root, [points[i]]);
    }
  }
  return Array.from(groups.values());
}
