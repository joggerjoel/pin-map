import type { UnsortedPhotoCursor } from "./photosRepository";

interface Cursorable {
  createdAt: string;
  id: string;
}

// Walks a keyset-paginated fetch function to its end, accumulating every
// matching row -- never a single uncapped fetch (image-group-plan.md,
// "Mass actions": PostgREST's own row cap would silently truncate a
// naive "just raise the page size" request against this table's real
// backlog size). Termination: a page shorter than `pageSize` means the
// query is exhausted, the standard keyset-pagination signal -- not a
// separate "has more" flag the caller has to thread through.
export async function walkAllPages<T extends Cursorable>(
  fetchPage: (after: UnsortedPhotoCursor | null) => Promise<T[] | null>,
  pageSize: number,
): Promise<T[] | null> {
  const rows: T[] = [];
  let after: UnsortedPhotoCursor | null = null;
  for (;;) {
    const page = await fetchPage(after);
    if (page === null) {
      return null;
    }
    rows.push(...page);
    if (page.length < pageSize) {
      return rows;
    }
    const last = page[page.length - 1];
    after = { createdAt: last.createdAt, id: last.id };
  }
}
