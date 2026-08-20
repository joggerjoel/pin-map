const STATE_NAME_ALIASES: Record<string, string> = {
  "washington dc": "District of Columbia",
};

export function toGeoJsonStateName(name: string): string {
  return STATE_NAME_ALIASES[name.toLowerCase()] ?? name;
}
