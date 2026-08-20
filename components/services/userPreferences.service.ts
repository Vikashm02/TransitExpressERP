import { supabase } from "@/lib/supabase";

const TABLE = "user_preferences";

export interface UserPreferences {
  userId: string;
  learningMode: boolean;
  updatedAt: string;
}

interface UserPreferencesRow {
  user_id: string;
  learning_mode: boolean;
  updated_at: string;
}

function fromRow(row: UserPreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    learningMode: row.learning_mode,
    updatedAt: row.updated_at,
  };
}

/**
 * Load the current user's preference row (RLS: own row only).
 * Returns null when no row exists yet (should be rare after migration 043).
 */
export async function getMyUserPreferences(): Promise<UserPreferences | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("user_id, learning_mode, updated_at")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return fromRow(data as UserPreferencesRow);
}

/**
 * Upsert learning_mode for the signed-in user.
 * Does not invent defaults for other users — caller passes the desired value.
 */
export async function setMyLearningMode(
  learningMode: boolean
): Promise<UserPreferences> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        user_id: user.id,
        learning_mode: learningMode,
      },
      { onConflict: "user_id" }
    )
    .select("user_id, learning_mode, updated_at")
    .single();

  if (error) throw error;
  return fromRow(data as UserPreferencesRow);
}
