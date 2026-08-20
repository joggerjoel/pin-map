import { useState } from "react";
import { ClassRosterEditor } from "./ClassRosterEditor";
import { ClassMeetupBoard } from "./ClassMeetupBoard";
import { useRosterPhotos } from "../hooks/useRosterPhotos";

export interface ClassReunionAppProps {
  classSlug: string;
  token: string | null;
  userId: string;
  userEmail: string;
}

type Tab = "meetups" | "roster";

export function ClassReunionApp({
  classSlug,
  token,
  userId,
  userEmail,
}: ClassReunionAppProps) {
  const [tab, setTab] = useState<Tab>("meetups");
  const rosterPhotos = useRosterPhotos(classSlug, userId);

  return (
    <div className="class-reunion">
      <div className="class-reunion__tabs">
        <button
          type="button"
          aria-pressed={tab === "meetups"}
          onClick={() => setTab("meetups")}
        >
          Meetup Map
        </button>
        <button
          type="button"
          aria-pressed={tab === "roster"}
          onClick={() => setTab("roster")}
        >
          Edit Roster
        </button>
      </div>
      {tab === "meetups" &&
        (token !== null ? (
          <ClassMeetupBoard
            classSlug={classSlug}
            token={token}
            userId={userId}
            userEmail={userEmail}
            photosByPersonId={rosterPhotos.photosByPersonId}
            onAddPhoto={rosterPhotos.addPhoto}
          />
        ) : (
          <p>Connect a Mapbox token to use the meetup map.</p>
        ))}
      {tab === "roster" && (
        <ClassRosterEditor
          classSlug={classSlug}
          token={token}
          photosByPersonId={rosterPhotos.photosByPersonId}
          onAddPhoto={rosterPhotos.addPhoto}
        />
      )}
    </div>
  );
}
