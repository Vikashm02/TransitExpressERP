import { supabase } from "@/lib/supabase";

export type AnnouncementLocation =
  | "home"
  | "financials"
  | "lr"
  | "pod"
  | "delivery_challans"
  | "all";

export const ANNOUNCEMENT_LOCATIONS: { value: AnnouncementLocation; label: string }[] = [
  { value: "home", label: "Landing / Home" },
  { value: "financials", label: "Financials" },
  { value: "lr", label: "LR Entry" },
  { value: "pod", label: "POD" },
  { value: "delivery_challans", label: "Delivery Challan" },
  { value: "all", label: "All pages" },
];

export interface Announcement {
  id: number;
  title: string;
  message: string;
  imageUrl: string;
  displayLocation: AnnouncementLocation;
  startsAt: string;
  endsAt: string;
  active: boolean;
  archivedAt: string | null;
  contentVersion: string;
  createdAt?: string;
}

export type AnnouncementInput = Omit<Announcement, "id" | "archivedAt" | "createdAt" | "contentVersion"> & {
  contentVersion?: string;
};

function fromRow(row: Record<string, unknown>): Announcement {
  return {
    id: Number(row.id),
    title: String(row.title ?? ""),
    message: String(row.message ?? ""),
    imageUrl: String(row.image_url ?? ""),
    displayLocation: (row.display_location as AnnouncementLocation) || "home",
    startsAt: String(row.starts_at ?? ""),
    endsAt: row.ends_at ? String(row.ends_at) : "",
    active: Boolean(row.active),
    archivedAt: (row.archived_at as string | null) ?? null,
    contentVersion: String(row.content_version ?? row.updated_at ?? "1"),
    createdAt: row.created_at as string | undefined,
  };
}

export async function getAnnouncementsAdmin(): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
}

export async function getActiveAnnouncementsForLocation(
  location: AnnouncementLocation
): Promise<Announcement[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .eq("active", true)
    .is("archived_at", null)
    .lte("starts_at", now)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? [])
    .map((row) => fromRow(row as Record<string, unknown>))
    .filter(
      (item) =>
        item.displayLocation === "all" ||
        item.displayLocation === location ||
        (location === "home" && item.displayLocation === "home")
    );
}

export async function createAnnouncement(values: AnnouncementInput): Promise<Announcement> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("announcements")
    .insert({
      title: values.title.trim(),
      message: values.message.trim(),
      image_url: values.imageUrl.trim() || null,
      display_location: values.displayLocation,
      starts_at: values.startsAt || new Date().toISOString(),
      ends_at: values.endsAt ? values.endsAt : null,
      active: values.active,
      created_by: user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return fromRow(data as Record<string, unknown>);
}

export async function updateAnnouncement(id: number, values: AnnouncementInput): Promise<void> {
  const { error } = await supabase
    .from("announcements")
    .update({
      title: values.title.trim(),
      message: values.message.trim(),
      image_url: values.imageUrl.trim() || null,
      display_location: values.displayLocation,
      starts_at: values.startsAt || new Date().toISOString(),
      ends_at: values.endsAt ? values.endsAt : null,
      active: values.active,
      content_version: String(Date.now()),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function archiveAnnouncement(id: number): Promise<void> {
  const { error } = await supabase
    .from("announcements")
    .update({ archived_at: new Date().toISOString(), active: false })
    .eq("id", id);
  if (error) throw error;
}

export async function dismissAnnouncement(announcementId: number, contentVersion: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.from("announcement_dismissals").upsert(
    {
      announcement_id: announcementId,
      user_id: user.id,
      content_version: contentVersion,
      dismissed_at: new Date().toISOString(),
    },
    { onConflict: "announcement_id,user_id,content_version" }
  );
  if (error) throw error;
}

export async function getDismissedAnnouncementIds(): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from("announcement_dismissals")
    .select("announcement_id, content_version");
  if (error) throw error;
  const map = new Map<number, string>();
  for (const row of data ?? []) {
    map.set(Number(row.announcement_id), String(row.content_version));
  }
  return map;
}

const ASSETS_BUCKET = "announcement-assets";
const MAX_BYTES = 2 * 1024 * 1024;

export async function uploadAnnouncementImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Use PNG, JPG, JPEG or WebP.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image must be 2 MB or smaller.");
  }

  const ext = file.name.split(".").pop() || "png";
  const path = `banners/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
