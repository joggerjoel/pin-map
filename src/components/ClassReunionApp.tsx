import { useState } from "react";
import { ClassRosterEditor } from "./ClassRosterEditor";
import { ClassMeetupBoard } from "./ClassMeetupBoard";

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
          />
        ) : (
          <p>Connect a Mapbox token to use the meetup map.</p>
        ))}
      {tab === "roster" && <ClassRosterEditor classSlug={classSlug} />}
    </div>
  );
}
