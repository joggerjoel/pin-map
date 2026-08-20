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

// Union-find clustering is single-linkage: A-B close and B-C close merges
// all three even if A and C are far apart. With enough points, that lets a
// "chain" of merely-adjacent pins bridge all the way across a map (e.g. a
// pin in the USA transitively linked to one in Australia through many
// pins in between). Real visual overlaps are a handful of pins in a small
// screen area, not dozens spanning the whole viewport — so any cluster
// that's implausibly large or spread out is treated as a chaining
// artifact, not a genuine collision, and its members are left alone
// rather than being spread into a giant, meaningless fan.
export const MAX_CLUSTER_MEMBERS = 12;
export const MAX_CLUSTER_DIAGONAL = 150;

function clusterDiagonal(cluster: ScreenPoint[]): number {
  const xs = cluster.map((point) => point.x);
  const ys = cluster.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return Math.sqrt(width * width + height * height);
}

export function computeDeclutterOffsets(
  points: ScreenPoint[],
  collisionRadius: number = DECLUTTER_COLLISION_RADIUS,
): DeclutterOffset[] {
  const clusters = clusterPoints(points, collisionRadius);
  const offsets: DeclutterOffset[] = [];
  for (const cluster of clusters) {
    const isChainArtifact =
      cluster.length > MAX_CLUSTER_MEMBERS ||
      clusterDiagonal(cluster) > MAX_CLUSTER_DIAGONAL;
    if (cluster.length === 1 || isChainArtifact) {
      cluster.forEach((point) => {
        offsets.push({ key: point.key, dx: 0, dy: 0 });
      });
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
