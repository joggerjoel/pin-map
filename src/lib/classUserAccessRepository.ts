import { supabase } from "./supabaseClient";

export type AccessStatus = "active" | "read_only" | "disabled";

export interface ClassUserAccess {
  userId: string;
  email: string;
  status: AccessStatus;
}

interface ClassUserAccessRow {
  user_id: string;
  email: string;
  status: AccessStatus;
}

function toClassUserAccess(row: ClassUserAccessRow): ClassUserAccess {
  return {
    userId: row.user_id,
    email: row.email,
    status: row.status,
  };
}

// No row means active — matches the database default and the RLS helper
// functions' fallback (see schema_class_access_control.sql).
export async function fetchOwnAccessStatus(
  classSlug: string,
  userId: string,
): Promise<AccessStatus> {
  try {
    const { data, error } = await supabase
      .from("pinmap_class_user_access")
      .select("status")
      .eq("class_slug", classSlug)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || data === null) {
      return "active";
    }
    return (data as { status: AccessStatus }).status;
  } catch {
    return "active";
  }
}

// Admin-only: RLS restricts select-all on pinmap_class_user_access to
// joel.labelle@gmail.com, so this resolves to [] for anyone else.
export async function fetchAllAccessStatuses(
  classSlug: string,
): Promise<ClassUserAccess[]> {
  try {
    const { data, error } = await supabase
      .from("pinmap_class_user_access")
      .select("user_id, email, status")
      .eq("class_slug", classSlug);
    if (error || data === null) {
      return [];
    }
    return (data as ClassUserAccessRow[]).map(toClassUserAccess);
  } catch {
    return [];
  }
}

export async function setUserAccessStatus(
  classSlug: string,
  userId: string,
  email: string,
  status: AccessStatus,
  updatedByEmail: string,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("pinmap_class_user_access").upsert(
      {
        class_slug: classSlug,
        user_id: userId,
        email,
        status,
        updated_by: updatedByEmail,
      },
      { onConflict: "class_slug,user_id" },
    );
    return error === null;
  } catch {
    return false;
  }
}
