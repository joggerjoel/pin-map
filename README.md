# Pin Map

Paste a list of places, one per line, and see them pinned on a map.

## Setup

1. `bun install`
2. Get a free Mapbox access token at https://account.mapbox.com/access-tokens/
3. Copy `.env.example` to `.env` and set `VITE_MAPBOX_TOKEN` to your token
   — or skip this and paste the token into the app's setup screen on first
   run instead; it's saved to your browser's local storage.
4. `bun run dev` and open the printed URL

## Testing

`bun run test`
