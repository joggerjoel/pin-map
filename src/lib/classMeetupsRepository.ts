import { supabase } from "./supabaseClient";

export interface ClassMeetup {
  id: string;
  submittedByEmail: string;
  metPersonId: number | null;
  metPersonName: string;
  query: string;
  name: string;
  lat: number;
  lng: number;
  metDate: string;
}

interface MeetupRow {
  id: string;
  submitted_by_email: string;
  met_person_id: number | null;
  met_person_name: string;
  query: string;
  name: string;
  lat: number;
  lng: number;
  met_date: string;
}

function toClassMeetup(row: MeetupRow): ClassMeetup {
  return {
    id: row.id,
    submittedByEmail: row.submitted_by_email,
    metPersonId: row.met_person_id,
    metPersonName: row.met_person_name,
    query: row.query,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    metDate: row.met_date,
  };
}

export async function fetchMeetups(classSlug: string): Promise<ClassMeetup[]> {
  try {
    const { data, error } = await supabase
      .from("pinmap_class_meetups")
      .select(
        "id, submitted_by_email, met_person_id, met_person_name, query, name, lat, lng, met_date",
      )
      .eq("class_slug", classSlug);
    if (error || data === null) {
      return [];
    }
    return (data as MeetupRow[]).map(toClassMeetup);
  } catch {
    return [];
  }
}

export interface NewClassMeetup {
  submittedBy: string;
  submittedByEmail: string;
  metPersonId: number | null;
  metPersonName: string;
  query: string;
  name: string;
  lat: number;
  lng: number;
  metDate: string;
}

export async function addMeetup(
  classSlug: string,
  meetup: NewClassMeetup,
): Promise<ClassMeetup | null> {
  try {
    const { data, error } = await supabase
      .from("pinmap_class_meetups")
      .insert({
        class_slug: classSlug,
        submitted_by: meetup.submittedBy,
        submitted_by_email: meetup.submittedByEmail,
        met_person_id: meetup.metPersonId,
        met_person_name: meetup.metPersonName,
        query: meetup.query,
        name: meetup.name,
        lat: meetup.lat,
        lng: meetup.lng,
        met_date: meetup.metDate,
      })
      .select(
        "id, submitted_by_email, met_person_id, met_person_name, query, name, lat, lng, met_date",
      )
      .single();
    if (error || data === null) {
      return null;
    }
    return toClassMeetup(data as MeetupRow);
  } catch {
    return null;
  }
}

export async function deleteMeetup(id: string): Promise<void> {
  try {
    await supabase.from("pinmap_class_meetups").delete().eq("id", id);
  } catch {
    // Fire-and-forget — see pinsRepository.upsertPins.
  }
}
