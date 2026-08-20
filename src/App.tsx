import { useState } from "react";
import { getMapboxToken, setMapboxToken } from "./lib/mapboxToken";
import { useGeocoder } from "./hooks/useGeocoder";
import { TokenSetup } from "./components/TokenSetup";
import { PlaceInput } from "./components/PlaceInput";
import { PlaceList } from "./components/PlaceList";
import { ErrorBanner } from "./components/ErrorBanner";
import { MapView } from "./components/MapView";

export function App() {
  const [token, setToken] = useState<string | null>(() => getMapboxToken());
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);
  const geocoder = useGeocoder(token ?? "");

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
        <h1>Pin Map</h1>
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
          onSelect={setSelectedQuery}
          onRemove={geocoder.removePlace}
        />
      </aside>
      <main className="app__map">
        <MapView
          token={token}
          places={geocoder.pinnedPlaces}
          selectedQuery={selectedQuery}
        />
      </main>
    </div>
  );
}
