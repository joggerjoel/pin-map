// Parses "places_you_have_been_tagged_in.html" from a Facebook data
// export. The file's structure is fixed by Facebook's own export
// generator (verified against a real export, not guessed), so a targeted
// regex extraction is used rather than pulling in a full HTML/DOM parser
// for a single-source, well-understood format:
//
//   <table style="table-layout: fixed;"><tr><td class="_a6_q">Visit time</td>
//   <td class="_2piu _a6_r">Jul 09, 2024 10:46:03 am</td></tr><tr>...
//   <div class="_2ph_ _a6_q">Name</div><div><div><section ...>
//   <div class="_2pi8 _2pic _a6-p">The Twins</div></section>...</table>

export interface CheckIn {
  placeName: string;
  visitTime: Date;
}

const TABLE_BLOCK_RE =
  /<table style="table-layout: fixed;">([\s\S]*?)<\/table>/g;
const VISIT_TIME_RE =
  /<td class="_a6_q">Visit time<\/td><td class="_2piu _a6_r">([^<]+)<\/td>/;
const PLACE_NAME_RE =
  /<div class="_2ph_ _a6_q">Name<\/div>[\s\S]*?<div class="_2pi8 _2pic _a6-p">([^<]*)<\/div><\/section>/;

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

// "Jul 09, 2024 10:46:03 am" — no timezone in the source data (the export
// header only states the export-generation time's zone, not per-entry).
// Treated as UTC deliberately and documented here, not silently guessed
// elsewhere: callers that need local-time accuracy must account for this.
const VISIT_TIME_FORMAT_RE =
  /^([A-Za-z]{3}) (\d{2}), (\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (am|pm)$/i;

export function parseVisitTime(text: string): Date | null {
  const match = VISIT_TIME_FORMAT_RE.exec(text.trim());
  if (!match) return null;
  const [, monthName, day, year, hourStr, minute, second, meridiem] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) return null;

  let hour = Number.parseInt(hourStr, 10);
  const isPm = meridiem.toLowerCase() === "pm";
  if (isPm && hour !== 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;

  const timestamp = Date.UTC(
    Number.parseInt(year, 10),
    month,
    Number.parseInt(day, 10),
    hour,
    Number.parseInt(minute, 10),
    Number.parseInt(second, 10),
  );
  return new Date(timestamp);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

export function parsePlacesTaggedIn(html: string): CheckIn[] {
  const checkIns: CheckIn[] = [];

  for (const tableMatch of html.matchAll(TABLE_BLOCK_RE)) {
    const block = tableMatch[1];

    const visitTimeMatch = VISIT_TIME_RE.exec(block);
    const placeNameMatch = PLACE_NAME_RE.exec(block);
    if (!visitTimeMatch || !placeNameMatch) continue;

    const visitTime = parseVisitTime(visitTimeMatch[1]);
    if (!visitTime) continue;

    const placeName = decodeHtmlEntities(placeNameMatch[1]).trim();
    if (!placeName) continue;

    checkIns.push({ placeName, visitTime });
  }

  return checkIns;
}
