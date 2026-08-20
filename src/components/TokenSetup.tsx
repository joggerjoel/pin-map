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
        Paste a Mapbox access token to get started. It's free, and it's saved
        only in your own browser — never sent anywhere but Mapbox.
      </p>
      <ol className="token-setup__steps">
        <li>
          <a
            href="https://account.mapbox.com/auth/signup/?route-to=https%3A%2F%2Fconsole.mapbox.com%2F%3Fauth%3D1"
            target="_blank"
            rel="noopener noreferrer"
          >
            Create a free Mapbox account
          </a>
        </li>
        <li>
          Once you're signed in, open your{" "}
          <a
            href="https://console.mapbox.com/account/access-tokens/"
            target="_blank"
            rel="noopener noreferrer"
          >
            access tokens page
          </a>
        </li>
        <li>Click "Create a token"</li>
        <li>Copy the token it gives you</li>
        <li>Paste it below and save</li>
      </ol>
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
