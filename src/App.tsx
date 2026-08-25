import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearMapboxToken,
  getMapboxToken,
  getPersonalMapboxToken,
  setMapboxToken,
} from "./lib/mapboxToken";
import { fetchTokenUsage, shouldForcePersonalToken } from "./lib/tokenUsage";
import type { TokenUsage } from "./lib/tokenUsage";
import { useGeocoder } from "./hooks/useGeocoder";
import { useSidebarLayout } from "./hooks/useSidebarLayout";
import { useAuth } from "./hooks/useAuth";
import { usePhotos } from "./hooks/usePhotos";
import { fetchOwnerId } from "./lib/pinsRepository";
import { TokenSetup } from "./components/TokenSetup";
import { LoginForm } from "./components/LoginForm";
import { ClassReunionApp } from "./components/ClassReunionApp";
import { ClassPublicLanding } from "./components/ClassPublicLanding";
import { AddPin } from "./components/AddPin";
import { ImportsPanel } from "./components/ImportsPanel";
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
import {
  formatClassDisplayName,
  getLastClassSlug,
  saveLastClassSlug,
} from "./lib/classNavigation";
import {
  fetchDeclutterEnabled,
  saveDeclutterEnabledRemote,
} from "./lib/userSettings";

export function App() {
  const [token, setToken] = useState<string | null>(() => getMapboxToken());
  const [personalToken, setPersonalToken] = useState<string | null>(() =>
    getPersonalMapboxToken(),
  );
  const [usage, setUsage] = useState<TokenUsage | null>(null);
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
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [showImports, setShowImports] = useState(false);
  const selectionNonceRef = useRef(0);
  const removalNonce = useRef(0);
  const sidebarLayout = useSidebarLayout();
  const auth = useAuth();
  const classSlug = new URLSearchParams(window.location.search).get("class");
  const [lastClassSlug] = useState<string | null>(() => getLastClassSlug());

  useEffect(() => {
    if (classSlug !== null) {
      saveLastClassSlug(classSlug);
    }
  }, [classSlug]);

  useEffect(() => {
    fetchOwnerId().then(setOwnerUserId);
  }, []);

  const userId = auth.status === "signed-in" ? auth.userId : null;

  useEffect(() => {
    if (userId === null) {
      return;
    }
    let cancelled = false;
    fetchDeclutterEnabled(userId).then((remote) => {
      if (!cancelled && remote !== null) {
        setDeclutterEnabled(remote);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (userId === null) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    fetchTokenUsage(userId).then((result) => {
      if (!cancelled) {
        setUsage(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Everyone but the owner is limited to the shared/bundled Mapbox token up
  // to PLACES_PINNED_LIMIT/LOGIN_LIMIT (see tokenUsage.ts) to protect the
  // owner's Mapbox quota; past that they must supply their own token, same
  // as the "Change token" flow already requires.
  const isForcedOffSharedToken =
    userId !== null &&
    userId !== ownerUserId &&
    usage !== null &&
    shouldForcePersonalToken(usage);
  const effectiveToken = isForcedOffSharedToken ? personalToken : token;

  const geocoder = useGeocoder(effectiveToken ?? "", {
    userId,
    ownerUserId,
    customTags,
  });
  const photos = usePhotos(userId, ownerUserId);

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
      if (userId !== null) {
        void saveDeclutterEnabledRemote(userId, next);
      }
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

  // "?class=<slug>" is a completely separate mode (a shared class-reunion
  // meetup map + roster editor) with nothing in common with the travel-map
  // UI below. A signed-out visitor gets a public teaser — the globe with
  // avatar pins but no names — over which the login form floats; the
  // roster grid, meetup board, and every name stay behind the login gate.
  if (classSlug !== null) {
    if (auth.status === "loading") {
      return (
        <div className="class-login-page">
          <p>Loading…</p>
        </div>
      );
    }
    if (auth.status === "signed-out") {
      return (
        <ClassPublicLanding
          classSlug={classSlug}
          token={effectiveToken}
          onSendOtp={auth.sendOtp}
          onVerifyOtp={auth.verifyOtp}
        />
      );
    }
    return (
      <ClassReunionApp
        classSlug={classSlug}
        token={effectiveToken}
        userId={auth.userId ?? ""}
        userEmail={auth.email ?? ""}
      />
    );
  }

  // Owner-only, opt-in via the sidebar's "Imports" button (see below) —
  // swaps the whole travel-map view for the review UI, same shape as the
  // classSlug branch above.
  if (
    showImports &&
    userId !== null &&
    userId === ownerUserId &&
    auth.accessToken !== null &&
    effectiveToken !== null
  ) {
    return (
      <ImportsPanel
        mapboxToken={effectiveToken}
        userId={userId}
        accessToken={auth.accessToken}
        onClose={() => setShowImports(false)}
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
          {auth.status === "signed-in" && userId === ownerUserId && (
            <button
              type="button"
              className="app__imports-toggle"
              onClick={() => setShowImports(true)}
            >
              Imports
            </button>
          )}
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
              setPersonalToken(null);
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
            {effectiveToken !== null ? (
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
              </>
            ) : (
              <p className="app__no-token-notice">
                Connect a Mapbox token to add new places or move pins on the
                map. Your existing places below can still be edited, tagged, and
                reordered.
              </p>
            )}
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
              photosByQuery={photos.photosByQuery}
              onAddPhoto={photos.addPhoto}
              onRemovePhoto={photos.removePhoto}
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
        {lastClassSlug !== null && (
          <a
            href={`/?class=${lastClassSlug}`}
            className="class-map__declutter-toggle"
          >
            {formatClassDisplayName(lastClassSlug)}
          </a>
        )}
        {effectiveToken !== null ? (
          <MapView
            token={effectiveToken}
            places={geocoder.pinnedPlaces}
            selection={selection}
            onMarkerClick={setHighlightedQuery}
            onRelocate={geocoder.relocatePlace}
            onSetLocation={geocoder.setLocation}
            builtinAppearance={builtinAppearance}
            declutterEnabled={declutterEnabled}
            canEdit={auth.status === "signed-in"}
            photosByQuery={photos.photosByQuery}
            onAddPhoto={photos.addPhoto}
          />
        ) : (
          <TokenSetup
            onSubmit={(newToken) => {
              setMapboxToken(newToken);
              setToken(newToken);
              setPersonalToken(newToken);
            }}
          />
        )}
      </main>
    </div>
  );
}
