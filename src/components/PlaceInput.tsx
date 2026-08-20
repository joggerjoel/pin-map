import { useState } from "react";
import type { FormEvent } from "react";

export interface PlaceInputProps {
  onSubmit: (raw: string) => void;
  isLoading: boolean;
}

export function PlaceInput({ onSubmit, isLoading }: PlaceInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim() === "") return;
    onSubmit(value);
  }

  return (
    <form className="place-input" onSubmit={handleSubmit}>
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
