import { useCallback, useRef, useState } from "react";
import {
  clearMapboxToken,
  getMapboxToken,
  setMapboxToken,
} from "./lib/mapboxToken";
import { useGeocoder } from "./hooks/useGeocoder";
import { TokenSetup } from "./components/TokenSetup";
import { PlaceInput } from "./components/PlaceInput";
import { PlaceList } from "./components/PlaceList";
import { ErrorBanner } from "./components/ErrorBanner";
import { MapView } from "./components/MapView";
import type { MapSelection } from "./components/MapView";

export function App() {
  const [token, setToken] = useState<string | null>(() => getMapboxToken());
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const selectionNonceRef = useRef(0);
  const geocoder = useGeocoder(token ?? "");

  // Selecting a place is modeled as a one-shot event (a nonce, not just the
  // query string) so re-selecting the same place still triggers a fresh
  // fly-to in MapView, even though React would otherwise bail out on an
  // identical setState value.
  const handleSelect = useCallback((query: string) => {
    selectionNonceRef.current += 1;
    setSelection({ query, nonce: selectionNonceRef.current });
  }, []);

  if (token === null) {
    return (
      <TokenSetup
        onSubmit={(newToken) => {
          setMapboxToken(newToken);
          setToken(newToken);
        }}
      />
    );
  }

  return (
    <div className="app">
      <aside className="app__sidebar">
        <div className="app__sidebar-header">
          <h1>Pin Map</h1>
          <button
            type="button"
            className="app__change-token"
            onClick={() => {
              clearMapboxToken();
              setToken(null);
            }}
          >
            Change token
          </button>
        </div>
        <PlaceInput
          onSubmit={geocoder.pinPlaces}
          isLoading={geocoder.isLoading}
        />
        {geocoder.error !== null && (
          <ErrorBanner message={geocoder.error} onRetry={geocoder.retry} />
        )}
        <PlaceList
          pinnedPlaces={geocoder.pinnedPlaces}
          failedLines={geocoder.failedLines}
          onSelect={handleSelect}
          onRemove={geocoder.removePlace}
        />
      </aside>
      <main className="app__map">
        <MapView
          token={token}
          places={geocoder.pinnedPlaces}
          selection={selection}
        />
      </main>
    </div>
  );
}
