import { useState } from "react";
import type { FormEvent } from "react";

export interface TokenSetupProps {
  onSubmit: (token: string) => void;
}

export function TokenSetup({ onSubmit }: TokenSetupProps) {
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "") return;
    onSubmit(trimmed);
  }

  return (
    <div className="token-setup">
      <h1>Pin Map</h1>
      <p>
        Paste a Mapbox access token to get started. Create a free one at{" "}
        <code>account.mapbox.com/access-tokens</code>.
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="mapbox-token-input">Mapbox access token</label>
        <input
          id="mapbox-token-input"
          type="text"
          placeholder="pk.eyJ1Ijoi..."
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit">Save token</button>
      </form>
    </div>
  );
}
