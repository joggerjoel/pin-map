import { useEffect, useMemo, useState } from "react";
import type { PinnedPlace } from "../hooks/useGeocoder";
import {
  buildGeoTree,
  collectPlacesUnder,
  countPlacesUnder,
  getDominantAppearance,
  getPlaceChain,
  type GeoTreeNode,
} from "../lib/geoHierarchy";
import type { BuiltinTagKey, TagAppearance } from "../lib/tagAppearance";
import { renderIconGlyph } from "../lib/iconGlyph";
import { useGeoTrayLayout } from "../hooks/useGeoTrayLayout";

export interface GeoDrillDownTrayProps {
  places: PinnedPlace[];
  builtinAppearance: Record<BuiltinTagKey, TagAppearance>;
  onSelectPlaces: (cycleKey: string, places: PinnedPlace[]) => void;
  onFocusPlaces: (places: PinnedPlace[]) => void;
  /** Set whenever something external — the legend's "zoom to next" click —
   * moves the map to a specific pin. The tray drills to that pin's parent
   * level and highlights it, so the browse panel stays in sync with
   * wherever the map just flew to instead of silently going stale. */
  focusedPlace?: PinnedPlace | null;
}

const MAX_HEIGHT_RATIO = 0.25;

function sortedChildren(node: GeoTreeNode): GeoTreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    const diff = countPlacesUnder(b) - countPlacesUnder(a);
    return diff !== 0 ? diff : a.label.localeCompare(b.label);
  });
}

function walkPath(root: GeoTreeNode, path: string[]): GeoTreeNode {
  let node = root;
  for (const segment of path) {
    const next = node.children.get(segment);
    if (!next) return node;
    node = next;
  }
  return node;
}

export function GeoDrillDownTray({
  places,
  builtinAppearance,
  onSelectPlaces,
  onFocusPlaces,
  focusedPlace = null,
}: GeoDrillDownTrayProps) {
  const [viewportHeight, setViewportHeight] = useState(
    () => window.innerHeight,
  );
  useEffect(() => {
    function handleResize() {
      setViewportHeight(window.innerHeight);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const maxHeight = Math.round(viewportHeight * MAX_HEIGHT_RATIO);

  const tray = useGeoTrayLayout(maxHeight);
  const [path, setPath] = useState<string[]>([]);
  const tree = useMemo(() => buildGeoTree(places), [places]);
  const currentNode = walkPath(tree, path);
  const children = sortedChildren(currentNode);

  useEffect(() => {
    if (focusedPlace === null) return;
    const chain = getPlaceChain(focusedPlace);
    // Drill to the focused place's *parent* level (chain minus the final
    // city segment) — that's the view where the place itself shows up as
    // a highlighted item, not one level past it.
    setPath(chain.slice(0, -1));
    tray.expand();
    // Deliberately keyed on the place object's identity, not `tray` (which
    // changes identity every render) — this should fire once per distinct
    // focus event, not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPlace]);

  if (tree.children.size === 0) {
    return null;
  }

  const focusChain = focusedPlace ? getPlaceChain(focusedPlace) : null;
  const highlightedLabel =
    focusChain &&
    focusChain.length === path.length + 1 &&
    focusChain.slice(0, -1).join("|") === path.join("|")
      ? focusChain[focusChain.length - 1]
      : null;

  function navigateTo(newPath: string[]) {
    setPath(newPath);
    onFocusPlaces(collectPlacesUnder(walkPath(tree, newPath)));
  }

  function handleChildClick(child: GeoTreeNode) {
    if (child.children.size > 0) {
      navigateTo([...path, child.label]);
    } else {
      onSelectPlaces([...path, child.label].join("|"), child.places);
    }
  }

  function handleBreadcrumbClick(index: number) {
    navigateTo(path.slice(0, index));
  }

  return (
    <div
      className={tray.collapsed ? "geo-tray geo-tray--collapsed" : "geo-tray"}
      style={!tray.collapsed ? { height: tray.height } : undefined}
    >
      {!tray.collapsed && (
        <div
          className="geo-tray__handle"
          onMouseDown={tray.onDragHandleMouseDown}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize places browser"
        />
      )}
      <button
        type="button"
        className="geo-tray__toggle"
        onClick={tray.toggleCollapsed}
        aria-expanded={!tray.collapsed}
        aria-label={
          tray.collapsed ? "Show places browser" : "Hide places browser"
        }
      >
        {tray.collapsed ? "▲" : "▼"} Browse places
      </button>
      {!tray.collapsed && (
        <div className="geo-tray__body">
          <nav className="geo-tray__breadcrumb" aria-label="Browse path">
            <button type="button" onClick={() => handleBreadcrumbClick(0)}>
              World
            </button>
            {path.map((segment, index) => (
              <span key={`${segment}-${index}`}>
                <span className="geo-tray__breadcrumb-sep">›</span>
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(index + 1)}
                >
                  {segment}
                </button>
              </span>
            ))}
          </nav>
          {currentNode.places.length > 0 && (
            <button
              type="button"
              className="geo-tray__item geo-tray__item--direct"
              onClick={() =>
                onSelectPlaces(
                  [...path, "(direct)"].join("|"),
                  currentNode.places,
                )
              }
            >
              {currentNode.places.length} pin
              {currentNode.places.length === 1 ? "" : "s"} directly here
            </button>
          )}
          <div className="geo-tray__items" role="list">
            {children.map((child) => {
              const dominant = getDominantAppearance(child, builtinAppearance);
              const isHighlighted = child.label === highlightedLabel;
              return (
                <button
                  type="button"
                  className={
                    isHighlighted
                      ? "geo-tray__item geo-tray__item--highlighted"
                      : "geo-tray__item"
                  }
                  role="listitem"
                  key={child.label}
                  onClick={() => handleChildClick(child)}
                  aria-label={`${child.label} (${countPlacesUnder(child)})`}
                >
                  {dominant && (
                    <span
                      className="geo-tray__item-icon"
                      style={{ backgroundColor: dominant.color }}
                    >
                      {renderIconGlyph(dominant.iconShape)}
                    </span>
                  )}
                  <span>{child.label}</span>
                  <span className="geo-tray__count">
                    {countPlacesUnder(child)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
