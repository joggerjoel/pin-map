import { useState } from "react";
import type { FormEvent } from "react";
import { CONTINENTS } from "../lib/continents";
import type { Continent } from "../lib/continents";

export interface PlaceInputProps {
  onSubmit: (
    raw: string,
    checklistMode: boolean,
    continent: Continent | null,
  ) => void;
  isLoading: boolean;
}

export function PlaceInput({ onSubmit, isLoading }: PlaceInputProps) {
  const [value, setValue] = useState("");
  const [checklistMode, setChecklistMode] = useState(false);
  const [continent, setContinent] = useState<Continent | null>(null);

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
        Checklist mode (numbered list with X/XX/Y marks)
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
