import type { ReviewOrder } from "../lib/importCandidateOrder";

export interface OrderPickerProps {
  order: ReviewOrder;
  onChange: (order: ReviewOrder) => void;
}

const OPTIONS: { value: ReviewOrder; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "random", label: "Random" },
];

export function OrderPicker({ order, onChange }: OrderPickerProps) {
  return (
    <label className="order-picker">
      Order
      <select
        value={order}
        onChange={(event) => onChange(event.target.value as ReviewOrder)}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
