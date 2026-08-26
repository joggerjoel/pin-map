// Parses "your_posts__check_ins__photos_and_videos_N.html" from a Facebook
// data export. Verified structure (against a real export — see
// facebook-import-layout-todo.md's "not yet built" item this closes):
//
//   <main class="_a706" role="main">
//     <section class="_a6-g" aria-labelledby="u_0_vo_UZ">
//       <h2 class="_2ph_ _a6-h _a6-i" id="u_0_vo_UZ">{summary}</h2>
//       <div class="_2ph_ _a6-p">...photos/text...</div>
//       <footer class="_3-94 _a6-o"><a ...><div class="_a72d">{timestamp}</div></a></footer>
//     </section>
//     <section class="_a6-g" aria-labelledby="...">...next post...</section>
//   </main>
//
// Each post is delimited by the NEXT post's opening tag (or </main>) rather
// than its own closing </section> — a post's own body can contain nested
// <section> tags (seen in the sibling places-tagged-in file), so matching
// on the first </section> would truncate early. The aria-labelledby id is
// unique per post and always present, making it a safe split point.
//
// One caveat, stated plainly rather than silently assumed: the specific
// "checked in at X" phrasing below is a best-effort pattern based on
// Facebook's well-documented wording, NOT verified against a real check-in
// post in this codebase — the one real export available while building
// this had zero check-in-tagged posts in this file. Treat checkInPlaceName
// extraction as provisional until confirmed against a real example.

import { decodeHtmlEntities, parseVisitTime } from "./parsePlacesTaggedIn";

export interface ParsedPost {
  /** Facebook's auto-generated summary line, tags stripped and entities
   * decoded — e.g. "Jogger Joel added 10 new photos." */
  summaryText: string;
  timestamp: Date;
  /** Paths relative to the export zip root, e.g.
   * "your_facebook_activity/posts/media/Photos_.../123.jpg" — not yet
   * resolved to actual bytes; that's a separate staging step. */
  photoPaths: string[];
  /** Non-null only when summaryText matches a "checked in at X" pattern —
   * see the caveat above. */
  checkInPlaceName: string | null;
}

const POST_BLOCK_RE =
  /<section class="_a6-g" aria-labelledby="[^"]*">([\s\S]*?)(?=<section class="_a6-g" aria-labelledby="|<\/main>)/g;
const SUMMARY_RE = /<h2 class="_2ph_ _a6-h _a6-i"[^>]*>([\s\S]*?)<\/h2>/;
const TIMESTAMP_RE = /<div class="_a72d">([^<]+)<\/div>/;
const PHOTO_HREF_RE =
  /href="(your_facebook_activity\/posts\/media\/[^"]+\.(?:jpg|jpeg|png|gif|mp4|mov))"/gi;
const CHECKED_IN_AT_RE = /checked in at (.+?)\.?$/i;

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

export function parsePostsCheckInsPhotos(html: string): ParsedPost[] {
  const posts: ParsedPost[] = [];

  for (const blockMatch of html.matchAll(POST_BLOCK_RE)) {
    const block = blockMatch[1];

    const summaryMatch = SUMMARY_RE.exec(block);
    if (!summaryMatch) continue;
    const summaryText = decodeHtmlEntities(stripTags(summaryMatch[1]).trim());

    const timestampMatch = TIMESTAMP_RE.exec(block);
    if (!timestampMatch) continue;
    const timestamp = parseVisitTime(timestampMatch[1]);
    if (!timestamp) continue;

    const photoPaths = [...block.matchAll(PHOTO_HREF_RE)].map((m) => m[1]);

    const checkInMatch = CHECKED_IN_AT_RE.exec(summaryText);
    const checkInPlaceName = checkInMatch ? checkInMatch[1].trim() : null;

    posts.push({ summaryText, timestamp, photoPaths, checkInPlaceName });
  }

  return posts;
}
