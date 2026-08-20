import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CONTINENTS } from "../lib/continents";
import type { Continent } from "../lib/continents";
import { parseChecklistLine } from "../lib/checklist";

export interface PlaceInputProps {
  onSubmit: (
    raw: string,
    checklistMode: boolean,
    continent: Continent | null,
  ) => void;
  isLoading: boolean;
  removedPlace: { query: string; nonce: number } | null;
}

function removeMatchingLine(
  raw: string,
  query: string,
  checklistMode: boolean,
): string {
  const lines = raw.split("\n");
  const targetKey = query.toLowerCase();
  let removed = false;
  const kept = lines.filter((line) => {
    if (removed) return true;
    const identity = checklistMode
      ? parseChecklistLine(line)?.name
      : line.trim();
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
  const [checklistMode, setChecklistMode] = useState(false);
  const [continent, setContinent] = useState<Continent | null>(null);

  useEffect(() => {
    if (removedPlace === null) return;
    setValue((prev) =>
      removeMatchingLine(prev, removedPlace.query, checklistMode),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removedPlace]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim() === "") return;
    onSubmit(value, checklistMode, checklistMode ? null : continent);
  }

  return (
    <form className="place-input" onSubmit={handleSubmit}>
      <label>
        <input
          type="checkbox"
          checked={checklistMode}
          onChange={(event) => {
            const checked = event.target.checked;
            setChecklistMode(checked);
            if (checked) {
              setContinent(null);
            }
          }}
        />
        Checklist mode (numbered list with X/(home)/Y marks)
      </label>
      <label>
        Continent (optional)
        <select
          value={continent ?? ""}
          disabled={checklistMode}
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
          "Paris, France\nTokyo\n1600 Amphitheatre Pkwy, Mountain View"
        }
      />
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Pinning..." : "Pin Places"}
      </button>
    </form>
  );
}
