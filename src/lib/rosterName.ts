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
