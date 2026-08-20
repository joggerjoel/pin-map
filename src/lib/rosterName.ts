import type { RosterPerson } from "./classRosterRepository";

export function displayName(person: RosterPerson): string {
  return (
    person.currentName.trim() ||
    person.highSchoolName.trim() ||
    `Person ${String(person.id).padStart(3, "0")}`
  );
}

function normalize(text: string): string {
  return text.normalize("NFKD").toLocaleLowerCase();
}

export function matchesSearch(person: RosterPerson, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") {
    return true;
  }
  const haystack = normalize(`${person.highSchoolName} ${person.currentName}`);
  return haystack.includes(normalize(trimmed));
}

// Convention: "RIP" in the Living field marks someone as deceased, in place
// of a city. \b after "rip" keeps a real place name like "Ripon, Wisconsin"
// from false-matching, while still matching "RIP", "RIP 2015", "RIP - cancer".
export function isDeceased(person: RosterPerson): boolean {
  return /^rip\b/i.test(person.living.trim());
}
