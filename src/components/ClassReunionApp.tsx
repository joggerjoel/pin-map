import { useEffect, useState } from "react";
import { ClassRosterEditor } from "./ClassRosterEditor";
import { ClassMeetupBoard } from "./ClassMeetupBoard";
import { ClassAdminPanel } from "./ClassAdminPanel";
import { useRosterPhotos } from "../hooks/useRosterPhotos";
import { recordClassLogin } from "../lib/classLoginsRepository";
import { fetchOwnAccessStatus } from "../lib/classUserAccessRepository";
import type { AccessStatus } from "../lib/classUserAccessRepository";
import { CLASS_ADMIN_EMAIL } from "../lib/classAdmin";

export interface ClassReunionAppProps {
  classSlug: string;
  token: string | null;
  userId: string;
  userEmail: string;
}

type Tab = "meetups" | "roster" | "admin";

export function ClassReunionApp({
  classSlug,
  token,
  userId,
  userEmail,
}: ClassReunionAppProps) {
  const [tab, setTab] = useState<Tab>("meetups");
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const rosterPhotos = useRosterPhotos(classSlug, userId);
  const isAdmin = userEmail === CLASS_ADMIN_EMAIL;

  useEffect(() => {
    void recordClassLogin(classSlug, userId, userEmail);
  }, [classSlug, userId, userEmail]);

  useEffect(() => {
    let cancelled = false;
    fetchOwnAccessStatus(classSlug, userId).then((status) => {
      if (!cancelled) setAccessStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [classSlug, userId]);

  if (accessStatus === null) {
    return <p>Loading…</p>;
  }

  if (accessStatus === "disabled") {
    return (
      <div className="class-reunion__blocked">
        <p>Your access to this page has been disabled.</p>
      </div>
    );
  }

  const readOnly = accessStatus === "read_only";

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
        {isAdmin && (
          <button
            type="button"
            aria-pressed={tab === "admin"}
            onClick={() => setTab("admin")}
          >
            Admin
          </button>
        )}
      </div>
      {readOnly && (
        <p className="class-reunion__read-only-banner">
          You have read-only access — changes won't be saved.
        </p>
      )}
      {tab === "meetups" &&
        (token !== null ? (
          <ClassMeetupBoard
            classSlug={classSlug}
            token={token}
            userId={userId}
            userEmail={userEmail}
            readOnly={readOnly}
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
          readOnly={readOnly}
          photosByPersonId={rosterPhotos.photosByPersonId}
          onAddPhoto={rosterPhotos.addPhoto}
        />
      )}
      {tab === "admin" && isAdmin && (
        <ClassAdminPanel classSlug={classSlug} adminEmail={userEmail} />
      )}
    </div>
  );
}
