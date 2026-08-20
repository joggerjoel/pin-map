import { useState } from "react";
import type { FormEvent } from "react";
import type { PlaceCategory } from "../lib/checklist";
import type { PlaceIcon } from "../lib/placeTags";
import {
  HOUSE_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
  TRIATHLETE_ICON_HEAD,
} from "../lib/iconShapes";

export type PinTag =
  | { kind: "category"; value: PlaceCategory }
  | { kind: "icon"; value: PlaceIcon };

export interface AddPinProps {
  onAdd: (city: string, tag: PinTag) => void;
  isLoading: boolean;
}

interface TagOption {
  tag: PinTag;
  label: string;
  color: string;
}

const TAG_OPTIONS: TagOption[] = [
  {
    tag: { kind: "category", value: "visited" },
    label: "Visited",
    color: "#3b82f6",
  },
  {
    tag: { kind: "category", value: "lived" },
    label: "Lived",
    color: "#f97316",
  },
  {
    tag: { kind: "category", value: "hometown" },
    label: "Hometown",
    color: "#eab308",
  },
  {
    tag: { kind: "icon", value: "triathlete" },
    label: "Ironman",
    color: "#dc2626",
  },
];

export function AddPin({ onAdd, isLoading }: AddPinProps) {
  const [city, setCity] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (city.trim() === "") return;
    onAdd(city, TAG_OPTIONS[selectedIndex].tag);
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
      <div className="add-pin__icons" role="radiogroup" aria-label="Pin icon">
        {TAG_OPTIONS.map((option, index) => (
          <button
            type="button"
            key={option.label}
            aria-label={option.label}
            aria-pressed={index === selectedIndex}
            className={
              index === selectedIndex
                ? "add-pin__swatch add-pin__swatch--selected"
                : "add-pin__swatch"
            }
            style={{ backgroundColor: option.color }}
            onClick={() => setSelectedIndex(index)}
          >
            {option.tag.kind === "icon" &&
              option.tag.value === "triathlete" && (
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <circle
                    cx={TRIATHLETE_ICON_HEAD.cx}
                    cy={TRIATHLETE_ICON_HEAD.cy}
                    r={TRIATHLETE_ICON_HEAD.r}
                    fill="#ffffff"
                  />
                  <path d={TRIATHLETE_ICON_BODY_PATH} fill="#ffffff" />
                </svg>
              )}
            {option.tag.kind === "category" &&
              option.tag.value === "hometown" && (
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d={HOUSE_ICON_PATH} fill="#ffffff" />
                </svg>
              )}
          </button>
        ))}
      </div>
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Pinning..." : "Pin it"}
      </button>
    </form>
  );
}
