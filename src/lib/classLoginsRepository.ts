import { supabase } from "./supabaseClient";

export interface ClassLogin {
  userId: string;
  email: string;
  loggedInAt: string;
}

interface ClassLoginRow {
  user_id: string;
  email: string;
  logged_in_at: string;
}

function toClassLogin(row: ClassLoginRow): ClassLogin {
  return {
    userId: row.user_id,
    email: row.email,
    loggedInAt: row.logged_in_at,
  };
}

export async function recordClassLogin(
  classSlug: string,
  userId: string,
  email: string,
): Promise<void> {
  try {
    await supabase.from("pinmap_class_logins").insert({
      class_slug: classSlug,
      user_id: userId,
      email,
    });
  } catch {
    // Fire-and-forget — see pinsRepository.upsertPins. A missed audit-log
    // row shouldn't block anyone from using the app.
  }
}

// Admin-only: RLS restricts select on pinmap_class_logins to
// joel.labelle@gmail.com, so this resolves to [] for anyone else.
export async function fetchClassLogins(
  classSlug: string,
): Promise<ClassLogin[]> {
  try {
    const { data, error } = await supabase
      .from("pinmap_class_logins")
      .select("user_id, email, logged_in_at")
      .eq("class_slug", classSlug)
      .order("logged_in_at");
    if (error || data === null) {
      return [];
    }
    return (data as ClassLoginRow[]).map(toClassLogin);
  } catch {
    return [];
  }
}
