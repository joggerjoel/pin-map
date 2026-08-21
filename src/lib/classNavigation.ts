const LAST_CLASS_KEY = "pin-map:last-class-slug";

// Lets the travel map's "swap to class" button route back to whichever
// class the visitor actually came from — there can be more than one
// ?class=<slug> instance (belding1989, wtc2026, ...), so a single
// hardcoded target would only ever work for one of them.
export function getLastClassSlug(): string | null {
  return window.localStorage.getItem(LAST_CLASS_KEY);
}

export function saveLastClassSlug(slug: string): void {
  window.localStorage.setItem(LAST_CLASS_KEY, slug);
}

// "belding1989" -> "Belding 1989", "wtc2026" -> "WTC 2026". Short
// alphabetic prefixes read as acronyms (WTC, IBM) and get fully
// uppercased; longer ones are treated as an ordinary name and just
// get their first letter capitalized.
export function formatClassDisplayName(slug: string): string {
  const match = slug.match(/^([a-z]+)(\d+)$/i);
  if (match === null) return slug;
  const [, name, year] = match;
  const formattedName =
    name.length <= 4
      ? name.toUpperCase()
      : name[0].toUpperCase() + name.slice(1).toLowerCase();
  return `${formattedName} ${year}`;
}
