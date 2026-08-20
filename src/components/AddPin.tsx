import { useState } from "react";
import type { FormEvent } from "react";
import { TagPicker, TAG_OPTIONS } from "./TagPicker";
import type { PinTag } from "./TagPicker";

export type { PinTag };

export interface AddPinProps {
  onAdd: (city: string, tag: PinTag) => void;
  isLoading: boolean;
}

export function AddPin({ onAdd, isLoading }: AddPinProps) {
  const [city, setCity] = useState("");
  const [selectedTag, setSelectedTag] = useState<PinTag>(TAG_OPTIONS[0].tag);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (city.trim() === "") return;
    onAdd(city, selectedTag);
    setCity("");
  }

  return (
    <form className="add-pin" onSubmit={handleSubmit}>
      <label htmlFor="add-pin-city">Add a pin</label>
      <input
        id="add-pin-city"
        type="text"
        value={city}
        onChange={(event) => setCity(event.target.value)}
        placeholder="City name"
      />
      <TagPicker selectedTag={selectedTag} onSelect={setSelectedTag} />
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Pinning..." : "Pin it"}
      </button>
    </form>
  );
}
