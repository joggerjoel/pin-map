import { useEffect, useState } from "react";
import { fetchPublicRosterLocations } from "../lib/classPublicRosterRepository";
import type { PublicRosterLocation } from "../lib/classPublicRosterRepository";
import { ClassPublicMapView } from "./ClassPublicMapView";
import { LoginForm } from "./LoginForm";

export interface ClassPublicLandingProps {
  classSlug: string;
  token: string | null;
  onSendOtp: (email: string) => Promise<{ error: string | null }>;
  onVerifyOtp: (
    email: string,
    code: string,
  ) => Promise<{ error: string | null }>;
}

export function ClassPublicLanding({
  classSlug,
  token,
  onSendOtp,
  onVerifyOtp,
}: ClassPublicLandingProps) {
  const [people, setPeople] = useState<PublicRosterLocation[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchPublicRosterLocations(classSlug).then((fetched) => {
      if (!cancelled) setPeople(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [classSlug]);

  return (
    <div className="class-public-landing">
      {token !== null ? (
        <ClassPublicMapView
          classSlug={classSlug}
          token={token}
          people={people}
        />
      ) : (
        <div className="class-public-landing__no-token" />
      )}
      <div className="class-public-landing__login">
        <LoginForm onSendOtp={onSendOtp} onVerifyOtp={onVerifyOtp} />
      </div>
    </div>
  );
}
