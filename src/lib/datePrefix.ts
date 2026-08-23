export interface DatePrefixMatch {
  date: string;
  rest: string;
}

const DATE_PREFIX_PATTERN =
  /^(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{4}\s*-\s*\d{2}\/\d{4}|\d{4}\s*-\s*\d{4}|\d{2}\/\d{4}|\d{4}(?:\s*,\s*\d{4})*)\s*\|\s*(.+)$/;

export function extractDatePrefix(line: string): DatePrefixMatch | null {
  const match = line.trim().match(DATE_PREFIX_PATTERN);
  if (match === null) {
    return null;
  }
  const rest = match[2].trim();
  if (rest === "") {
    return null;
  }
  return { date: match[1].trim(), rest };
}
