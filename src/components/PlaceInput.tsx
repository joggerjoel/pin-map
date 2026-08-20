import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CONTINENTS } from "../lib/continents";
import type { Continent } from "../lib/continents";
import { looksLikeChecklistRow, parseChecklistLine } from "../lib/checklist";
import { extractDatePrefix } from "../lib/datePrefix";
import { resolvePlainLineName } from "../lib/plainLineName";

export interface PlaceInputProps {
  onSubmit: (raw: string, continent: Continent | null) => void;
  isLoading: boolean;
  removedPlace: { query: string; nonce: number } | null;
}

function removeMatchingLine(raw: string, query: string): string {
  const lines = raw.split("\n");
  const targetKey = query.toLowerCase();
  let removed = false;
  const kept = lines.filter((line) => {
    if (removed) return true;
    const dateMatch = extractDatePrefix(line);
    const workingLine = dateMatch ? dateMatch.rest : line;
    const identity = looksLikeChecklistRow(workingLine)
      ? parseChecklistLine(workingLine)?.name
      : resolvePlainLineName(workingLine).name;
    if (identity !== undefined && identity.toLowerCase() === targetKey) {
      removed = true;
      return false;
    }
    return true;
  });
  return kept.join("\n");
}

export function PlaceInput({
  onSubmit,
  isLoading,
  removedPlace,
}: PlaceInputProps) {
  const [value, setValue] = useState("");
  const [continent, setContinent] = useState<Continent | null>(null);

  useEffect(() => {
    if (removedPlace === null) return;
    setValue((prev) => removeMatchingLine(prev, removedPlace.query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removedPlace]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim() === "") return;
    onSubmit(value, continent);
  }

  return (
    <form className="place-input" onSubmit={handleSubmit}>
      <label>
        Continent
        <select
          value={continent ?? ""}
          onChange={(event) =>
            setContinent(
              event.target.value === ""
                ? null
                : (event.target.value as Continent),
            )
          }
        >
          <option value="">Any</option>
          {CONTINENTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="places-textarea">Paste places, one per line</label>
      <textarea
        id="places-textarea"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={8}
        placeholder={
          "2017 | Paris, France\nTokyo\n1600 Amphitheatre Pkwy, Mountain View\nHong Kong SAR, China, 22.3193,114.1694\nBoston, Massachusetts (home)"
        }
      />
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Pinning..." : "Pin Places"}
      </button>
    </form>
  );
}
