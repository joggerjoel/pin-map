import { useCallback, useRef, useState } from "react";
import {
  clearMapboxToken,
  getMapboxToken,
  setMapboxToken,
} from "./lib/mapboxToken";
import { useGeocoder } from "./hooks/useGeocoder";
import { useSidebarLayout } from "./hooks/useSidebarLayout";
import { useAuth } from "./hooks/useAuth";
import { TokenSetup } from "./components/TokenSetup";
import { LoginForm } from "./components/LoginForm";
import { AddPin } from "./components/AddPin";
import { PlaceInput } from "./components/PlaceInput";
import { PlaceList } from "./components/PlaceList";
import { ErrorBanner } from "./components/ErrorBanner";
import { MapView } from "./components/MapView";
import type { MapSelection } from "./components/MapView";
import { getCustomTags, addCustomTag, updateCustomTag } from "./lib/customTags";
import type { CustomTag } from "./lib/customTags";
import {
  getResolvedBuiltinAppearance,
  saveTagAppearanceOverride,
} from "./lib/tagAppearance";
import type {
  BuiltinTagKey,
  IconShape,
  TagAppearance,
} from "./lib/tagAppearance";
import {
  getDeclutterEnabled,
  saveDeclutterEnabled,
} from "./lib/declutterSettings";

export function App() {
  const [token, setToken] = useState<string | null>(() => getMapboxToken());
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [highlightedQuery, setHighlightedQuery] = useState<string | null>(null);
  const [lastRemoval, setLastRemoval] = useState<{
    query: string;
    nonce: number;
  } | null>(null);
  const [customTags, setCustomTags] = useState<CustomTag[]>(() =>
    getCustomTags(),
  );
  const [builtinAppearance, setBuiltinAppearance] = useState<
    Record<BuiltinTagKey, TagAppearance>
  >(() => getResolvedBuiltinAppearance());
  const [declutterEnabled, setDeclutterEnabled] = useState<boolean>(() =>
    getDeclutterEnabled(),
  );
  const selectionNonceRef = useRef(0);
  const removalNonce = useRef(0);
  const geocoder = useGeocoder(token ?? "");
  const sidebarLayout = useSidebarLayout();
  const auth = useAuth();

  function handleCreateCustomTag(
    label: string,
    color: string,
    iconShape: IconShape,
  ) {
    setCustomTags(addCustomTag(label, color, iconShape));
  }

  function handleEditBuiltinTag(key: BuiltinTagKey, appearance: TagAppearance) {
    saveTagAppearanceOverride(key, appearance);
    setBuiltinAppearance(getResolvedBuiltinAppearance());
  }

  function handleEditCustomTag(
    id: string,
    updates: { label: string; color: string; iconShape: IconShape },
  ) {
    setCustomTags(updateCustomTag(id, updates));
  }

  function handleToggleDeclutter() {
    setDeclutterEnabled((prev) => {
      const next = !prev;
      saveDeclutterEnabled(next);
      return next;
    });
  }

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
    <div
      className="app"
      style={{
        gridTemplateColumns: sidebarLayout.collapsed
          ? "0px 0px 1fr"
          : `${sidebarLayout.width}px 6px 1fr`,
      }}
    >
      <button
        type="button"
        className="app__sidebar-toggle"
        onClick={sidebarLayout.toggleCollapsed}
        aria-label={sidebarLayout.collapsed ? "Show sidebar" : "Hide sidebar"}
        style={{
          left: sidebarLayout.collapsed ? 0 : sidebarLayout.width - 14,
        }}
      >
        {sidebarLayout.collapsed ? "›" : "‹"}
      </button>
      <aside className="app__sidebar">
        <div className="app__sidebar-header">
          <h1>Pin Map</h1>
          <button
            type="button"
            className="app__declutter-toggle"
            aria-pressed={declutterEnabled}
            onClick={handleToggleDeclutter}
          >
            {declutterEnabled ? "Spider: On" : "Spider: Off"}
          </button>
          {auth.status === "signed-in" && (
            <button
              type="button"
              className="app__sign-out"
              onClick={() => {
                void auth.signOut();
              }}
            >
              Sign out{auth.email ? ` (${auth.email})` : ""}
            </button>
          )}
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
        {auth.status === "loading" && <p>Loading…</p>}
        {auth.status === "signed-out" && (
          <LoginForm onSendOtp={auth.sendOtp} onVerifyOtp={auth.verifyOtp} />
        )}
        {auth.status === "signed-in" && (
          <>
            <AddPin
              onAdd={(city, tag) =>
                geocoder.pinPlace(
                  city,
                  tag.kind === "category"
                    ? { category: tag.value }
                    : tag.kind === "icon"
                      ? { icon: tag.value }
                      : { customTag: tag.value },
                )
              }
              isLoading={geocoder.isLoading}
              customTags={customTags}
              onCreateCustomTag={handleCreateCustomTag}
              builtinAppearance={builtinAppearance}
              onEditBuiltinTag={handleEditBuiltinTag}
              onEditCustomTag={handleEditCustomTag}
            />
            <PlaceInput
              onSubmit={geocoder.pinPlaces}
              isLoading={geocoder.isLoading}
              removedPlace={lastRemoval}
            />
            {geocoder.error !== null && (
              <ErrorBanner message={geocoder.error} onRetry={geocoder.retry} />
            )}
            <PlaceList
              pinnedPlaces={geocoder.pinnedPlaces}
              failedLines={geocoder.failedLines}
              onSelect={handleSelect}
              onRemove={(query) => {
                geocoder.removePlace(query);
                removalNonce.current += 1;
                setLastRemoval({ query, nonce: removalNonce.current });
              }}
              onChangeTag={geocoder.changeTag}
              highlightedQuery={highlightedQuery}
              customTags={customTags}
              onCreateCustomTag={handleCreateCustomTag}
              onReorder={geocoder.reorderPlaces}
              onRelocate={geocoder.relocatePlace}
              onSetLocation={geocoder.setLocation}
              builtinAppearance={builtinAppearance}
              onEditBuiltinTag={handleEditBuiltinTag}
              onEditCustomTag={handleEditCustomTag}
            />
          </>
        )}
      </aside>
      <div
        className="app__splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={sidebarLayout.onSplitterMouseDown}
      />
      <main className="app__map">
        <MapView
          token={token}
          places={geocoder.pinnedPlaces}
          selection={selection}
          onMarkerClick={setHighlightedQuery}
          onRelocate={geocoder.relocatePlace}
          onSetLocation={geocoder.setLocation}
          builtinAppearance={builtinAppearance}
          declutterEnabled={declutterEnabled}
        />
      </main>
    </div>
  );
}
