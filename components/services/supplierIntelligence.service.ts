import { supabase } from "@/lib/supabase";

/**
 * Supplier Intelligence — organizations, people, conversations, ask client.
 * Uses migration 067 tables + RLS via authenticated browser client.
 * Ask goes through POST /api/supplier/intelligence/ask (JWT). No service_role.
 */

export type SupplierConversationInputType = "text" | "voice";

export interface SupplierOrganizationType {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
}

export interface SupplierOrganization {
  id: string;
  name: string;
  code: string | null;
  notes: string | null;
  active: boolean;
  types: SupplierOrganizationType[];
}

export interface SupplierPerson {
  id: string;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  linkDesignation: string | null;
  isPrimary: boolean;
}

export interface SupplierConversation {
  id: string;
  organizationId: string | null;
  personId: string | null;
  locationId: string | null;
  title: string | null;
  originalText: string;
  inputType: SupplierConversationInputType;
  occurredAt: string;
  conductedByUserId: string | null;
  loggedByUserId: string;
  personNameSnapshot: string | null;
  personDesignationSnapshot: string | null;
  organizationNameSnapshot: string | null;
  locationNameSnapshot: string | null;
  createdAt: string;
  createdBy: string | null;
  loggedByName: string;
}

export interface CreateOrganizationInput {
  name: string;
  code?: string | null;
  notes?: string | null;
  organizationTypeId: string;
}

export interface CreatePersonInput {
  organizationId: string;
  name: string;
  designation?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  isPrimary?: boolean;
}

export interface CreateConversationInput {
  organizationId: string;
  personId?: string | null;
  originalText: string;
  inputType: SupplierConversationInputType;
  title?: string | null;
}

export const SUPPLIER_ORG_SEARCH_LIMIT = 25;
export const SUPPLIER_CONVERSATION_HISTORY_LIMIT = 100;

function asString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function formatSupplierError(error: unknown, fallback: string): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : error instanceof Error
        ? error.message
        : "";

  const lower = message.toLowerCase();
  if (lower.includes("permission") || lower.includes("row-level security") || lower.includes("rls")) {
    return "You do not have permission to perform this action.";
  }
  if (lower.includes("duplicate") || lower.includes("unique")) {
    return "A record with this name or code already exists.";
  }
  if (lower.includes("not-null") || lower.includes("null value") || lower.includes("check")) {
    return "Please fill in the required information and try again.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Network error. Check your connection and try again.";
  }
  return fallback;
}

function mapType(row: Record<string, unknown>): SupplierOrganizationType | null {
  if (asBoolean(row.active, true) === false) return null;
  return {
    id: asString(row.id),
    slug: asString(row.slug),
    name: asString(row.name),
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
  };
}

function mapOrganization(row: Record<string, unknown>): SupplierOrganization {
  const links = Array.isArray(row.supplier_organization_type_links)
    ? row.supplier_organization_type_links
    : [];

  const types: SupplierOrganizationType[] = [];
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const typeRow = (link as { supplier_organization_types?: unknown })
      .supplier_organization_types;
    if (typeRow && typeof typeRow === "object" && !Array.isArray(typeRow)) {
      const mapped = mapType(typeRow as Record<string, unknown>);
      if (mapped) types.push(mapped);
    } else if (Array.isArray(typeRow) && typeRow[0]) {
      const mapped = mapType(typeRow[0] as Record<string, unknown>);
      if (mapped) types.push(mapped);
    }
  }

  types.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return {
    id: asString(row.id),
    name: asString(row.name),
    code: asNullableString(row.code),
    notes: asNullableString(row.notes),
    active: asBoolean(row.active, true),
    types,
  };
}

function mapPersonFromJoin(row: Record<string, unknown>): SupplierPerson | null {
  const person = row.supplier_people;
  if (!person || typeof person !== "object" || Array.isArray(person)) return null;
  const p = person as Record<string, unknown>;
  if (asBoolean(p.active, true) === false) return null;

  return {
    id: asString(p.id),
    name: asString(p.name),
    designation: asNullableString(p.designation),
    phone: asNullableString(p.phone),
    email: asNullableString(p.email),
    notes: asNullableString(p.notes),
    active: asBoolean(p.active, true),
    linkDesignation: asNullableString(row.designation),
    isPrimary: asBoolean(row.is_primary, false),
  };
}

function mapConversation(
  row: Record<string, unknown>,
  loggedByNameFallback = "Unknown"
): SupplierConversation {
  const user = row.app_users;
  let loggedByName = loggedByNameFallback;
  if (user && typeof user === "object" && !Array.isArray(user)) {
    const u = user as Record<string, unknown>;
    loggedByName =
      asNullableString(u.display_name) ||
      asNullableString(u.email) ||
      loggedByNameFallback;
  }

  return {
    id: asString(row.id),
    organizationId: asNullableString(row.organization_id),
    personId: asNullableString(row.person_id),
    locationId: asNullableString(row.location_id),
    title: asNullableString(row.title),
    originalText: asString(row.original_text),
    inputType: row.input_type === "voice" ? "voice" : "text",
    occurredAt: asString(row.occurred_at),
    conductedByUserId: asNullableString(row.conducted_by_user_id),
    loggedByUserId: asString(row.logged_by_user_id),
    personNameSnapshot: asNullableString(row.person_name_snapshot),
    personDesignationSnapshot: asNullableString(row.person_designation_snapshot),
    organizationNameSnapshot: asNullableString(row.organization_name_snapshot),
    locationNameSnapshot: asNullableString(row.location_name_snapshot),
    createdAt: asString(row.created_at),
    createdBy: asNullableString(row.created_by),
    loggedByName,
  };
}

const ORG_SELECT = `
  id,
  name,
  code,
  notes,
  active,
  supplier_organization_type_links (
    organization_type_id,
    supplier_organization_types ( id, slug, name, sort_order, active )
  )
`;

export async function listSupplierOrganizationTypes(): Promise<SupplierOrganizationType[]> {
  const { data, error } = await supabase
    .from("supplier_organization_types")
    .select("id, slug, name, sort_order, active")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? [])
    .map((row) => mapType(row as Record<string, unknown>))
    .filter((row): row is SupplierOrganizationType => row != null);
}

export async function searchSupplierOrganizations(
  query: string,
  limit = SUPPLIER_ORG_SEARCH_LIMIT
): Promise<SupplierOrganization[]> {
  const trimmed = query.trim();
  const capped = Math.min(Math.max(limit, 1), 50);

  let builder = supabase
    .from("supplier_organizations")
    .select(ORG_SELECT)
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(capped);

  if (trimmed) {
    // Escape ILIKE wildcards in user input; no trigram/FTS in this phase.
    const escaped = trimmed.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    builder = builder.or(`name.ilike.%${escaped}%,code.ilike.%${escaped}%`);
  }

  const { data, error } = await builder;
  if (error) throw error;
  return (data ?? []).map((row) => mapOrganization(row as Record<string, unknown>));
}

export async function searchSupplierPeople(
  query: string,
  limit = SUPPLIER_ORG_SEARCH_LIMIT
): Promise<
  Array<{
    person: SupplierPerson;
    organizations: Array<{ id: string; name: string }>;
  }>
> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const capped = Math.min(Math.max(limit, 1), 50);
  const escaped = trimmed.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  const { data: peopleRows, error: peopleError } = await supabase
    .from("supplier_people")
    .select("id, name, designation, phone, email, notes, active")
    .eq("active", true)
    .ilike("name", `%${escaped}%`)
    .order("name", { ascending: true })
    .limit(capped);

  if (peopleError) throw peopleError;
  if (!peopleRows?.length) return [];

  const personIds = peopleRows.map((p) => p.id as string);

  const { data: links, error: linksError } = await supabase
    .from("supplier_person_organization_links")
    .select(
      `
      person_id,
      designation,
      is_primary,
      active,
      supplier_organizations ( id, name, active )
    `
    )
    .in("person_id", personIds)
    .eq("active", true);

  if (linksError) throw linksError;

  const orgsByPerson = new Map<string, Array<{ id: string; name: string }>>();
  for (const link of links ?? []) {
    const personId = asString(link.person_id);
    const org = link.supplier_organizations;
    if (!org || typeof org !== "object" || Array.isArray(org)) continue;
    const o = org as Record<string, unknown>;
    if (asBoolean(o.active, true) === false) continue;
    const list = orgsByPerson.get(personId) ?? [];
    list.push({ id: asString(o.id), name: asString(o.name) });
    orgsByPerson.set(personId, list);
  }

  return peopleRows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      person: {
        id: asString(record.id),
        name: asString(record.name),
        designation: asNullableString(record.designation),
        phone: asNullableString(record.phone),
        email: asNullableString(record.email),
        notes: asNullableString(record.notes),
        active: asBoolean(record.active, true),
        linkDesignation: null,
        isPrimary: false,
      },
      organizations: orgsByPerson.get(asString(record.id)) ?? [],
    };
  });
}

export async function getSupplierOrganizationById(
  id: string
): Promise<SupplierOrganization | null> {
  const { data, error } = await supabase
    .from("supplier_organizations")
    .select(ORG_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapOrganization(data as Record<string, unknown>);
}

export async function createSupplierOrganization(
  input: CreateOrganizationInput
): Promise<SupplierOrganization> {
  const name = input.name.trim();
  if (!name) throw new Error("Organization name is required.");
  if (!input.organizationTypeId) throw new Error("Organization type is required.");

  const code = asNullableString(input.code);
  const notes = asNullableString(input.notes);

  const { data: org, error: orgError } = await supabase
    .from("supplier_organizations")
    .insert({
      name,
      code,
      notes,
      active: true,
    })
    .select("id")
    .single();

  if (orgError) throw orgError;

  const { error: linkError } = await supabase
    .from("supplier_organization_type_links")
    .insert({
      organization_id: org.id,
      organization_type_id: input.organizationTypeId,
    });

  if (linkError) {
    // Best-effort cleanup if type link fails (no authenticated DELETE; leave orphan rare).
    throw linkError;
  }

  const full = await getSupplierOrganizationById(org.id as string);
  if (!full) throw new Error("Organization was created but could not be reloaded.");
  return full;
}

export async function listPeopleForOrganization(
  organizationId: string
): Promise<SupplierPerson[]> {
  const { data, error } = await supabase
    .from("supplier_person_organization_links")
    .select(
      `
      designation,
      is_primary,
      active,
      supplier_people ( id, name, designation, phone, email, notes, active )
    `
    )
    .eq("organization_id", organizationId)
    .eq("active", true)
    .order("is_primary", { ascending: false });

  if (error) throw error;

  const people: SupplierPerson[] = [];
  for (const row of data ?? []) {
    const person = mapPersonFromJoin(row as Record<string, unknown>);
    if (person) people.push(person);
  }

  people.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return people;
}

export async function createSupplierPerson(
  input: CreatePersonInput
): Promise<SupplierPerson> {
  const name = input.name.trim();
  if (!name) throw new Error("Person name is required.");
  if (!input.organizationId) throw new Error("Organization is required.");

  const { data: person, error: personError } = await supabase
    .from("supplier_people")
    .insert({
      name,
      designation: asNullableString(input.designation),
      phone: asNullableString(input.phone),
      email: asNullableString(input.email),
      notes: asNullableString(input.notes),
      active: true,
    })
    .select("id, name, designation, phone, email, notes, active")
    .single();

  if (personError) throw personError;

  const isPrimary = input.isPrimary !== false;

  const { data: link, error: linkError } = await supabase
    .from("supplier_person_organization_links")
    .insert({
      person_id: person.id,
      organization_id: input.organizationId,
      designation: asNullableString(input.designation),
      is_primary: isPrimary,
      active: true,
    })
    .select("designation, is_primary")
    .single();

  if (linkError) throw linkError;

  return {
    id: asString(person.id),
    name: asString(person.name),
    designation: asNullableString(person.designation),
    phone: asNullableString(person.phone),
    email: asNullableString(person.email),
    notes: asNullableString(person.notes),
    active: asBoolean(person.active, true),
    linkDesignation: asNullableString(link?.designation),
    isPrimary: asBoolean(link?.is_primary, isPrimary),
  };
}

export async function listSupplierConversations(params: {
  organizationId: string;
  /**
   * When set: conversations for that person only.
   * When null/undefined: organization-level notes only (person_id IS NULL).
   * Never returns other people's conversations for an organization-wide dump.
   */
  personId?: string | null;
  limit?: number;
}): Promise<SupplierConversation[]> {
  const capped = Math.min(
    Math.max(params.limit ?? SUPPLIER_CONVERSATION_HISTORY_LIMIT, 1),
    200
  );

  let builder = supabase
    .from("supplier_conversations")
    .select(
      `
      id,
      organization_id,
      person_id,
      location_id,
      title,
      original_text,
      input_type,
      occurred_at,
      conducted_by_user_id,
      logged_by_user_id,
      person_name_snapshot,
      person_designation_snapshot,
      organization_name_snapshot,
      location_name_snapshot,
      created_at,
      created_by,
      app_users!logged_by_user_id ( display_name, email )
    `
    )
    .eq("organization_id", params.organizationId)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(capped);

  if (params.personId) {
    builder = builder.eq("person_id", params.personId);
  } else {
    // Organization-level notes only — do not mix in person-owned conversations.
    builder = builder.is("person_id", null);
  }

  const { data, error } = await builder;
  if (error) throw error;

  return (data ?? []).map((row) => mapConversation(row as Record<string, unknown>));
}

export async function createSupplierConversation(
  input: CreateConversationInput,
  options?: { loggedByName?: string }
): Promise<SupplierConversation> {
  const text = input.originalText.trim();
  if (!text) throw new Error("Conversation text is required.");
  if (!input.organizationId) throw new Error("Organization is required.");

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) throw authError;
  if (!user?.id) throw new Error("You must be signed in to save a conversation.");

  const payload = {
    organization_id: input.organizationId,
    person_id: input.personId || null,
    original_text: text,
    input_type: input.inputType === "voice" ? "voice" : "text",
    title: asNullableString(input.title),
    // Required by RLS WITH CHECK; trigger also forces auth.uid().
    logged_by_user_id: user.id,
    occurred_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("supplier_conversations")
    .insert(payload)
    .select(
      `
      id,
      organization_id,
      person_id,
      location_id,
      title,
      original_text,
      input_type,
      occurred_at,
      conducted_by_user_id,
      logged_by_user_id,
      person_name_snapshot,
      person_designation_snapshot,
      organization_name_snapshot,
      location_name_snapshot,
      created_at,
      created_by
    `
    )
    .single();

  if (error) throw error;

  return mapConversation(
    data as Record<string, unknown>,
    options?.loggedByName || "Unknown"
  );
}

/** Public ask API response shapes (browser-safe; no secrets / contentBlocks). */
export type SupplierAskMode = "DB_ONLY" | "SYNTHESIS";

export interface SupplierAskSource {
  conversationId: string;
  occurredAt: string;
  organizationName: string | null;
  personName: string | null;
  personDesignation: string | null;
  inputType: "text" | "voice";
}

export interface SupplierAskResult {
  ok: true;
  mode: SupplierAskMode;
  answer: string | null;
  message: string | null;
  sources: SupplierAskSource[];
  truncated: boolean;
  /** Whether a model was invoked for this answer (user-facing only). */
  providerCalled: boolean;
}

export interface SupplierAskErrorResult {
  ok: false;
  error: string;
  message: string;
}

export type SupplierAskResponse = SupplierAskResult | SupplierAskErrorResult;

export type SupplierAskScope =
  | "organization"
  | "organization_type"
  | "all";

/**
 * Ask Supplier Intelligence via the authenticated Next.js route.
 * Does NOT create supplier_conversations. Does NOT use service role.
 */
export async function askSupplierIntelligence(params: {
  question: string;
  scope?: SupplierAskScope | null;
  organizationId?: string | null;
  personId?: string | null;
  organizationTypeSlug?: string | null;
}): Promise<SupplierAskResponse> {
  const question = params.question.trim();
  if (!question) {
    return {
      ok: false,
      error: "invalid_request",
      message: "Enter a question before asking.",
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return {
      ok: false,
      error: "unauthenticated",
      message: "You must be signed in to ask Supplier Intelligence.",
    };
  }

  const response = await fetch("/api/supplier/intelligence/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      question,
      scope: params.scope ?? "organization",
      organizationId: params.organizationId || null,
      personId: params.personId || null,
      organizationTypeSlug: params.organizationTypeSlug || null,
    }),
  });

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      ok: false,
      error: "retrieval_failure",
      message: "Unable to read the Supplier Intelligence response. Please try again.",
    };
  }

  if (!json || typeof json !== "object") {
    return {
      ok: false,
      error: "retrieval_failure",
      message: "Unexpected response from Supplier Intelligence.",
    };
  }

  const body = json as Record<string, unknown>;

  if (body.ok === true) {
    const usage =
      body.usage && typeof body.usage === "object"
        ? (body.usage as Record<string, unknown>)
        : null;
    const sourcesRaw = Array.isArray(body.sources) ? body.sources : [];
    const sources: SupplierAskSource[] = sourcesRaw
      .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      .map((row) => ({
        conversationId: asString(row.conversationId),
        occurredAt: asString(row.occurredAt),
        organizationName: asNullableString(row.organizationName),
        personName: asNullableString(row.personName),
        personDesignation: asNullableString(row.personDesignation),
        inputType: row.inputType === "voice" ? "voice" : "text",
      }));

    return {
      ok: true,
      mode: body.mode === "SYNTHESIS" ? "SYNTHESIS" : "DB_ONLY",
      answer: asNullableString(body.answer),
      message: asNullableString(body.message),
      sources,
      truncated: asBoolean(body.truncated, false),
      providerCalled: asBoolean(usage?.providerCalled, false),
    };
  }

  const message =
    asNullableString(body.message) ||
    "Unable to answer right now. Please try again.";

  return {
    ok: false,
    error: asString(body.error, "retrieval_failure"),
    message,
  };
}
