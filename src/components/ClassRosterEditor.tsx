import { useEffect, useState } from "react";
import { fetchRoster, saveRosterPerson } from "../lib/classRosterRepository";
import type { RosterPerson } from "../lib/classRosterRepository";
import { RosterGrid } from "./RosterGrid";

export interface ClassRosterEditorProps {
  classSlug: string;
}

interface FormState {
  highSchoolName: string;
  currentName: string;
  hometown: string;
  currentLocation: string;
}

function toFormState(person: RosterPerson): FormState {
  return {
    highSchoolName: person.highSchoolName,
    currentName: person.currentName,
    hometown: person.hometown,
    currentLocation: person.currentLocation,
  };
}

function isDirty(form: FormState, person: RosterPerson): boolean {
  return (
    form.highSchoolName !== person.highSchoolName ||
    form.currentName !== person.currentName ||
    form.hometown !== person.hometown ||
    form.currentLocation !== person.currentLocation
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ClassRosterEditor({ classSlug }: ClassRosterEditorProps) {
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
      currentLocation: form.currentLocation.trim(),
    };
    const ok = await saveRosterPerson(classSlug, {
      id: selected.id,
      ...trimmed,
    });
    if (!ok) {
      setSaveStatus("error");
      return;
    }
    setPeople((prev) =>
      prev.map((p) => (p.id === selected.id ? { ...p, ...trimmed } : p)),
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
      />
      {selected !== null && form !== null && (
        <div className="class-roster__panel">
          <label>
            High school name
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
            Current location
            <input
              type="text"
              value={form.currentLocation}
              onChange={(event) =>
                setForm({ ...form, currentLocation: event.target.value })
              }
            />
          </label>
          <label>
            Image URL
            <input type="text" value={selected.imageUrl} readOnly />
          </label>
          <button type="button" onClick={() => void handleSave()}>
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
