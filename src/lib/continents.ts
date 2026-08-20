export type Continent =
  "north-america" | "south-america" | "europe" | "africa" | "asia" | "oceania";

export interface ContinentOption {
  value: Continent;
  label: string;
  bbox: [number, number, number, number];
}

export const CONTINENTS: ContinentOption[] = [
  {
    value: "north-america",
    label: "North America",
    bbox: [-168, 5, -50, 85],
  },
  {
    value: "south-america",
    label: "South America",
    bbox: [-92, -60, -30, 15],
  },
  { value: "europe", label: "Europe", bbox: [-25, 34, 45, 72] },
  { value: "africa", label: "Africa", bbox: [-25, -35, 55, 38] },
  { value: "asia", label: "Asia", bbox: [25, -15, 180, 82] },
  { value: "oceania", label: "Oceania", bbox: [110, -55, 180, 5] },
];

export function getContinentBbox(
  continent: Continent,
): [number, number, number, number] | undefined {
  return CONTINENTS.find((option) => option.value === continent)?.bbox;
}
