import { useState } from "react";
import type { FormEvent } from "react";

export interface PlaceInputProps {
  onSubmit: (raw: string, checklistMode: boolean) => void;
  isLoading: boolean;
}

export function PlaceInput({ onSubmit, isLoading }: PlaceInputProps) {
  const [value, setValue] = useState("");
  const [checklistMode, setChecklistMode] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim() === "") return;
    onSubmit(value, checklistMode);
  }

  return (
    <form className="place-input" onSubmit={handleSubmit}>
      <label>
        <input
          type="checkbox"
          checked={checklistMode}
          onChange={(event) => setChecklistMode(event.target.checked)}
        />
        Checklist mode (numbered list with X/XX/Y marks)
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
