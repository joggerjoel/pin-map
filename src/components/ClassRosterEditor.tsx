import { useEffect, useState } from "react";
import { fetchRoster, saveRosterPerson } from "../lib/classRosterRepository";
import type { RosterPerson } from "../lib/classRosterRepository";
import type { RosterPersonPhoto } from "../lib/classRosterPhotosRepository";
import { geocodeLine } from "../lib/geocoder";
import { CLASS_GEOCODE_COUNTRY_BIAS } from "../lib/classGeocodeBias";
import { RosterGrid } from "./RosterGrid";

export interface ClassRosterEditorProps {
  classSlug: string;
  token?: string | null;
  readOnly?: boolean;
  photosByPersonId?: Record<number, RosterPersonPhoto[]>;
  onAddPhoto?: (personId: number, file: File, year: number | null) => void;
}

interface FormState {
  highSchoolName: string;
  currentName: string;
  hometown: string;
  living: string;
  currentLocation: string;
}

function toFormState(person: RosterPerson): FormState {
  return {
    highSchoolName: person.highSchoolName,
    currentName: person.currentName,
    hometown: person.hometown,
    living: person.living,
    currentLocation: person.currentLocation,
  };
}

function isDirty(form: FormState, person: RosterPerson): boolean {
  return (
    form.highSchoolName !== person.highSchoolName ||
    form.currentName !== person.currentName ||
    form.hometown !== person.hometown ||
    form.living !== person.living ||
    form.currentLocation !== person.currentLocation
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ClassRosterEditor({
  classSlug,
  token,
  readOnly = false,
  photosByPersonId,
  onAddPhoto,
}: ClassRosterEditorProps) {
  const [people, setPeople] = useState<RosterPerson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    let cancelled = false;
    fetchRoster(classSlug).then((fetched) => {
      if (!cancelled) {
        setPeople(fetched);
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [classSlug]);

  const selected = people.find((p) => p.id === selectedId) ?? null;
  const dirty = selected !== null && form !== null && isDirty(form, selected);

  function selectPerson(person: RosterPerson) {
    if (dirty) {
      const proceed = window.confirm(
        "You have unsaved changes. Discard them and switch portraits?",
      );
      if (!proceed) {
        return;
      }
    }
    setSelectedId(person.id);
    setForm(toFormState(person));
    setSaveStatus("idle");
  }

  async function handleSave() {
    if (selected === null || form === null) {
      return;
    }
    setSaveStatus("saving");
    const trimmed: FormState = {
      highSchoolName: form.highSchoolName.trim(),
      currentName: form.currentName.trim(),
      hometown: form.hometown.trim(),
      living: form.living.trim(),
      currentLocation: form.currentLocation.trim(),
    };

    // The map avatar pin needs coordinates, but geocoding on every save
    // (rather than only when "living" actually changed) would burn quota
    // re-resolving a city that hasn't moved.
    let livingLat = selected.livingLat;
    let livingLng = selected.livingLng;
    if (trimmed.living !== selected.living) {
      if (trimmed.living === "") {
        livingLat = null;
        livingLng = null;
      } else if (token) {
        const geocoded = await geocodeLine(
          trimmed.living,
          token,
          CLASS_GEOCODE_COUNTRY_BIAS,
        );
        livingLat = geocoded?.lat ?? null;
        livingLng = geocoded?.lng ?? null;
      }
    }

    const ok = await saveRosterPerson(classSlug, {
      id: selected.id,
      ...trimmed,
      livingLat,
      livingLng,
    });
    if (!ok) {
      setSaveStatus("error");
      return;
    }
    setPeople((prev) =>
      prev.map((p) =>
        p.id === selected.id ? { ...p, ...trimmed, livingLat, livingLng } : p,
      ),
    );
    setForm(trimmed);
    setSaveStatus("saved");
  }

  return (
    <div className="class-roster">
      <RosterGrid
        people={people}
        selectedId={selectedId}
        searchText={searchText}
        onSearchChange={setSearchText}
        onSelect={selectPerson}
        isLoading={isLoading}
        photosByPersonId={photosByPersonId}
        onAddPhoto={
          onAddPhoto &&
          ((person, file, year) => onAddPhoto(person.id, file, year))
        }
      />
      {selected !== null && form !== null && (
        <div className="class-roster__panel">
          <label>
            Birth name
            <input
              type="text"
              value={form.highSchoolName}
              onChange={(event) =>
                setForm({ ...form, highSchoolName: event.target.value })
              }
            />
          </label>
          <label>
            Current name
            <input
              type="text"
              value={form.currentName}
              onChange={(event) =>
                setForm({ ...form, currentName: event.target.value })
              }
            />
          </label>
          <label>
            Hometown
            <input
              type="text"
              value={form.hometown}
              onChange={(event) =>
                setForm({ ...form, hometown: event.target.value })
              }
            />
          </label>
          <label>
            Current Residence
            <input
              type="text"
              value={form.living}
              onChange={(event) =>
                setForm({ ...form, living: event.target.value })
              }
            />
          </label>
          <label>
            Current Location
            <input
              type="text"
              value={form.currentLocation}
              onChange={(event) =>
                setForm({ ...form, currentLocation: event.target.value })
              }
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={readOnly}
          >
            Save
          </button>
          {saveStatus === "saving" && <span>Saving…</span>}
          {saveStatus === "saved" && <span>Saved</span>}
          {saveStatus === "error" && (
            <span role="alert">Couldn't save — try again.</span>
          )}
        </div>
      )}
    </div>
  );
}
