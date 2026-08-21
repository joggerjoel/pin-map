import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassMeetupMapView } from "./ClassMeetupMapView";
import type { ClassMeetup } from "../lib/classMeetupsRepository";
import type { RosterPerson } from "../lib/classRosterRepository";
import type { RosterPersonPhoto } from "../lib/classRosterPhotosRepository";

const { mapInstances, markerInstances, MockMap, MockMarker, MockPopup } =
  vi.hoisted(() => {
    const markerInstances: InstanceType<typeof MockMarker>[] = [];
    const mapInstances: InstanceType<typeof MockMap>[] = [];

    class MockMap {
      handlers: Record<string, Array<(event?: unknown) => void>> = {};
      flyToCalls: unknown[] = [];
      sources = new Map<string, { data: unknown }>();
      constructor(public options: unknown) {
        mapInstances.push(this);
      }
      on(event: string, handler: (event?: unknown) => void): void {
        (this.handlers[event] ??= []).push(handler);
      }
      off(event: string, handler: (event?: unknown) => void): void {
        this.handlers[event] = (this.handlers[event] ?? []).filter(
          (h) => h !== handler,
        );
      }
      once(_event: string, handler: (event?: unknown) => void): void {
        handler();
      }
      isStyleLoaded(): boolean {
        return true;
      }
      getSource(id: string): { setData: (data: unknown) => void } | undefined {
        const record = this.sources.get(id);
        if (record === undefined) return undefined;
        return { setData: (data: unknown) => (record.data = data) };
      }
      addSource(id: string, options: { data: unknown }): void {
        this.sources.set(id, { data: options.data });
      }
      addLayer(): void {}
      project([lng, lat]: [number, number]): { x: number; y: number } {
        return { x: lng, y: lat };
      }
      unproject([x, y]: [number, number]): { lng: number; lat: number } {
        return { lng: x, lat: y };
      }
      // mapbox-gl-js fires the map's own click handlers even when the click
      // originated on a marker (default target: a plain element, standing
      // in for real map background — pass a marker's element to simulate
      // the click having bubbled up from that marker instead).
      triggerClick(target: unknown = document.createElement("div")): void {
        (this.handlers.click ?? []).forEach((handler) =>
          handler({ originalEvent: { target } }),
        );
      }
      flyTo(options: unknown): void {
        this.flyToCalls.push(options);
      }
      remove(): void {}
    }

    class MockPopup {
      domContent: unknown;
      setDOMContent(content: unknown): MockPopup {
        this.domContent = content;
        return this;
      }
    }

    class MockMarker {
      lngLat: [number, number] | undefined;
      popup: MockPopup | undefined;
      removed = false;
      element: HTMLElement | undefined;
      constructor(options?: { element?: HTMLElement }) {
        this.element = options?.element;
        markerInstances.push(this);
      }
      setLngLat(lngLat: [number, number]): MockMarker {
        this.lngLat = lngLat;
        return this;
      }
      setPopup(popup: MockPopup): MockMarker {
        this.popup = popup;
        return this;
      }
      addTo(): MockMarker {
        // Real mapbox-gl-js always adds this class, whether or not a
        // custom element was supplied — production code relies on it to
        // tell a marker click apart from a genuine background click.
        this.element?.classList.add("mapboxgl-marker");
        return this;
      }
      remove(): void {
        this.removed = true;
      }
    }

    return { mapInstances, markerInstances, MockMap, MockMarker, MockPopup };
  });

vi.mock("mapbox-gl", () => ({
  default: {
    Map: MockMap,
    Marker: MockMarker,
    Popup: MockPopup,
    accessToken: "",
  },
}));

beforeEach(() => {
  markerInstances.length = 0;
  mapInstances.length = 0;
  window.localStorage.clear();
});

const meetup: ClassMeetup = {
  id: "meetup-1",
  submittedByEmail: "joel@example.com",
  metPersonId: 5,
  metPersonName: "Jane Smith Johnson",
  query: "Chicago",
  name: "Chicago, Illinois, USA",
  lat: 41.88,
  lng: -87.63,
  metDate: "06/1995",
};

const jane: RosterPerson = {
  id: 1,
  filename: "class1989-001_sheet1_row1_col1.png",
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
  highSchoolName: "Jane Smith",
  currentName: "Jane Smith Johnson",
  hometown: "Belding, Michigan",
  living: "Grand Rapids, Michigan",
  livingLat: 42.96,
  livingLng: -85.67,
  currentLocation: "",
};

const bob: RosterPerson = {
  id: 2,
  filename: "class1989-002_sheet1_row1_col2.png",
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-002_sheet1_row1_col2.png",
  highSchoolName: "Bob Lee",
  currentName: "",
  hometown: "Belding, Michigan",
  living: "",
  livingLat: null,
  livingLng: null,
  currentLocation: "",
};

describe("ClassMeetupMapView", () => {
  it("places a marker for each meetup at its coordinates", () => {
    render(
      <ClassMeetupMapView token="pk.test" meetups={[meetup]} people={[]} />,
    );

    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0]?.lngLat).toEqual([meetup.lng, meetup.lat]);
  });

  it("builds popup content with the place, who was met, the date, and who submitted it", () => {
    render(
      <ClassMeetupMapView token="pk.test" meetups={[meetup]} people={[]} />,
    );

    const content = markerInstances[0]?.popup?.domContent as HTMLDivElement;
    expect(content.textContent).toContain("Chicago, Illinois, USA");
    expect(content.textContent).toContain("Met: Jane Smith Johnson");
    expect(content.textContent).toContain("06/1995");
    expect(content.textContent).toContain("Added by joel@example.com");
  });

  it("re-renders markers when the meetups list changes", () => {
    const { rerender } = render(
      <ClassMeetupMapView token="pk.test" meetups={[meetup]} people={[]} />,
    );
    expect(markerInstances).toHaveLength(1);

    const second: ClassMeetup = { ...meetup, id: "meetup-2", query: "Tokyo" };
    rerender(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[meetup, second]}
        people={[]}
      />,
    );

    expect(markerInstances).toHaveLength(3);
    expect(markerInstances[0]?.removed).toBe(true);
  });

  it("places an avatar marker only for people with a cached living location", () => {
    render(
      <ClassMeetupMapView token="pk.test" meetups={[]} people={[jane, bob]} />,
    );

    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0]?.lngLat).toEqual([
      jane.livingLng,
      jane.livingLat,
    ]);
    expect(
      markerInstances[0]?.element?.classList.contains(
        "class-meetup-map__avatar-marker",
      ),
    ).toBe(true);
    const img = markerInstances[0]?.element?.querySelector("img");
    expect(img?.src).toBe(jane.imageUrl);
    expect(img?.alt).toBe("Jane Smith Johnson");
  });

  it("builds avatar popup content with the person's name and where they live", () => {
    render(<ClassMeetupMapView token="pk.test" meetups={[]} people={[jane]} />);

    const content = markerInstances[0]?.popup?.domContent as HTMLDivElement;
    expect(content.textContent).toContain("Jane Smith Johnson");
    expect(content.textContent).toContain("Grand Rapids, Michigan");
  });

  it("re-renders avatar markers when the people list changes", () => {
    const { rerender } = render(
      <ClassMeetupMapView token="pk.test" meetups={[]} people={[jane]} />,
    );
    expect(markerInstances).toHaveLength(1);

    const relocatedBob: RosterPerson = {
      ...bob,
      livingLat: 41.5,
      livingLng: -81.6,
    };
    rerender(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[jane, relocatedBob]}
      />,
    );

    expect(markerInstances).toHaveLength(3);
    expect(markerInstances[0]?.removed).toBe(true);
  });

  it("calls onAvatarClick with the person when their marker is clicked", () => {
    const onAvatarClick = vi.fn();
    render(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[jane]}
        onAvatarClick={onAvatarClick}
      />,
    );

    markerInstances[0]?.element?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(onAvatarClick).toHaveBeenCalledWith(jane);
  });

  it("calls onAvatarClick with null when the map background is clicked", () => {
    const onAvatarClick = vi.fn();
    render(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[jane]}
        onAvatarClick={onAvatarClick}
      />,
    );

    mapInstances[0]?.triggerClick();

    expect(onAvatarClick).toHaveBeenCalledWith(null);
  });

  it("does not deselect when a marker click bubbles up to the map's own click handler", () => {
    // Regression: mapbox-gl-js fires the map's "click" event for a click
    // that originated on a marker too (markers share the canvas
    // container the map listens on). Without filtering those out here,
    // every avatar click immediately triggered the background-click
    // deselect right after selecting, undoing it — this is what "click
    // on avatar stopped working" turned out to be.
    const onAvatarClick = vi.fn();
    render(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[jane]}
        onAvatarClick={onAvatarClick}
      />,
    );
    const markerElement = markerInstances[0]?.element as HTMLElement;

    markerElement.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    mapInstances[0]?.triggerClick(markerElement);

    expect(onAvatarClick).toHaveBeenCalledWith(jane);
    expect(onAvatarClick).not.toHaveBeenCalledWith(null);
  });

  it("marks the active person's marker with the active class", () => {
    render(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[jane]}
        activePersonId={jane.id}
      />,
    );

    expect(
      markerInstances[0]?.element?.classList.contains(
        "class-meetup-map__avatar-marker--active",
      ),
    ).toBe(true);
  });

  it("flies to the active person's cached location", () => {
    const { rerender } = render(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[jane]}
        activePersonId={null}
      />,
    );
    expect(mapInstances[0]?.flyToCalls).toHaveLength(0);

    rerender(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[jane]}
        activePersonId={jane.id}
      />,
    );

    expect(mapInstances[0]?.flyToCalls).toEqual([
      { center: [jane.livingLng, jane.livingLat], zoom: 8 },
    ]);
  });

  it("does not fly when the active person has no cached location", () => {
    render(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[bob]}
        activePersonId={bob.id}
      />,
    );

    expect(mapInstances[0]?.flyToCalls).toHaveLength(0);
  });

  it("shows a Spider toggle defaulting to on", () => {
    render(<ClassMeetupMapView token="pk.test" meetups={[]} people={[]} />);

    expect(
      screen.getByRole("button", { name: "Spider: On" }),
    ).toBeInTheDocument();
  });

  it("toggles the Spider label and persists the preference on click", async () => {
    const user = userEvent.setup();
    render(<ClassMeetupMapView token="pk.test" meetups={[]} people={[]} />);

    await user.click(screen.getByRole("button", { name: "Spider: On" }));

    expect(
      screen.getByRole("button", { name: "Spider: Off" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("pin-map:class-declutter-enabled")).toBe(
      "false",
    );
  });

  it("shows a Photos toggle defaulting to Original", () => {
    render(<ClassMeetupMapView token="pk.test" meetups={[]} people={[jane]} />);

    expect(
      screen.getByRole("button", { name: "Photos: Original" }),
    ).toBeInTheDocument();
  });

  it("uses the official portrait for the avatar marker by default", () => {
    const recentPhoto: RosterPersonPhoto = {
      id: "photo-1",
      personId: jane.id,
      storagePath: "user-1/class-roster/belding1989/1/a.jpg",
      year: null,
      url: "https://cdn.example.com/recent.jpg",
    };
    render(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[jane]}
        photosByPersonId={{ [jane.id]: [recentPhoto] }}
      />,
    );

    const img = markerInstances[0]?.element?.querySelector("img");
    expect(img?.src).toBe(jane.imageUrl);
  });

  it("swaps the avatar marker to the recent personal photo when toggled to Personal", async () => {
    const recentPhoto: RosterPersonPhoto = {
      id: "photo-1",
      personId: jane.id,
      storagePath: "user-1/class-roster/belding1989/1/a.jpg",
      year: null,
      url: "https://cdn.example.com/recent.jpg",
    };
    const user = userEvent.setup();
    render(
      <ClassMeetupMapView
        token="pk.test"
        meetups={[]}
        people={[jane]}
        photosByPersonId={{ [jane.id]: [recentPhoto] }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Photos: Original" }));

    expect(
      screen.getByRole("button", { name: "Photos: Personal" }),
    ).toBeInTheDocument();
    const img =
      markerInstances[markerInstances.length - 1]?.element?.querySelector(
        "img",
      );
    expect(img?.src).toBe(recentPhoto.url);
  });

  it("falls back to the official portrait in Personal mode when no personal photo exists", async () => {
    const user = userEvent.setup();
    render(<ClassMeetupMapView token="pk.test" meetups={[]} people={[jane]} />);

    await user.click(screen.getByRole("button", { name: "Photos: Original" }));

    const img =
      markerInstances[markerInstances.length - 1]?.element?.querySelector(
        "img",
      );
    expect(img?.src).toBe(jane.imageUrl);
  });

  it("links back to the travel map, labeled Personal Travel", () => {
    render(<ClassMeetupMapView token="pk.test" meetups={[]} people={[]} />);

    const link = screen.getByRole("link", { name: "Personal Travel" });
    expect(link).toHaveAttribute("href", "/");
  });
});
