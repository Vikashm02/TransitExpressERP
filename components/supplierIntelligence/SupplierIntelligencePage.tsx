"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  MessageSquareText,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";
import {
  SUPPLIER_CONVERSATION_HISTORY_LIMIT,
  createSupplierConversation,
  formatSupplierError,
  getSupplierOrganizationById,
  listPeopleForOrganization,
  listSupplierConversations,
  searchSupplierOrganizations,
  searchSupplierPeople,
  type SupplierConversation,
  type SupplierConversationInputType,
  type SupplierOrganization,
  type SupplierPerson,
} from "@/components/services/supplierIntelligence.service";
import AddOrganizationDialog from "./AddOrganizationDialog";
import AddPersonDialog from "./AddPersonDialog";
import AskIntelligencePanel from "./AskIntelligencePanel";
import ConversationComposer from "./ConversationComposer";
import ConversationEntry from "./ConversationEntry";

type SearchHit =
  | { kind: "organization"; organization: SupplierOrganization }
  | {
      kind: "person";
      person: SupplierPerson;
      organization: { id: string; name: string };
    };

type WorkspaceMode = "landing" | "organization" | "person";

function buildIntelligenceHref(
  pathname: string,
  orgId: string | null,
  personId: string | null
): string {
  const params = new URLSearchParams();
  if (orgId) params.set("org", orgId);
  if (orgId && personId) params.set("person", personId);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export default function SupplierIntelligencePage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading Supplier Intelligence…
        </div>
      }
    >
      <SupplierIntelligencePageInner />
    </Suspense>
  );
}

function SupplierIntelligencePageInner() {
  const { hasPermission, hasAction, profile } = useAuth();
  const canView = hasPermission("supplier_intelligence", "view");
  const canCreate = hasAction("supplier_intelligence", "create");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const orgIdFromUrl = searchParams.get("org");
  const personIdFromUrl = searchParams.get("person");

  const [search, setSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [contactFilter, setContactFilter] = useState("");

  /** Browse list of active organizations (empty-query load). Not auto-selected. */
  const [browseOrgs, setBrowseOrgs] = useState<SupplierOrganization[]>([]);
  const [browseLoading, setBrowseLoading] = useState(canView);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const [organization, setOrganization] = useState<SupplierOrganization | null>(
    null
  );
  const [orgLoading, setOrgLoading] = useState(false);
  const [people, setPeople] = useState<SupplierPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  const [conversations, setConversations] = useState<SupplierConversation[]>(
    []
  );
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [draftInputType, setDraftInputType] =
    useState<SupplierConversationInputType>("text");
  const [sending, setSending] = useState(false);

  const [addOrgOpen, setAddOrgOpen] = useState(false);
  const [addPersonOpen, setAddPersonOpen] = useState(false);

  const timelineEndRef = useRef<HTMLDivElement>(null);
  const searchRequestId = useRef(0);
  const browseRequestId = useRef(0);
  /** Monotonic generation for org/person context loads and save-draft gating. */
  const contextGenerationRef = useRef(0);
  const loadedOrganizationIdRef = useRef<string | null>(null);
  /** Bumps when composer text changes or is programmatically reset — used to protect in-flight drafts. */
  const draftGenerationRef = useRef(0);

  const workspaceMode: WorkspaceMode = !orgIdFromUrl
    ? "landing"
    : personIdFromUrl
      ? "person"
      : "organization";

  const selectedPerson = useMemo(
    () => people.find((p) => p.id === selectedPersonId) ?? null,
    [people, selectedPersonId]
  );

  const chronological = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const ta = new Date(a.occurredAt).getTime();
      const tb = new Date(b.occurredAt).getTime();
      if (ta !== tb) return ta - tb;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [conversations]);

  const typeLabels = organization?.types.map((t) => t.name).join(", ") || null;

  const filteredPeople = useMemo(() => {
    const q = contactFilter.trim().toLowerCase();
    if (!q) return people;
    return people.filter((person) => {
      const haystack = [
        person.name,
        person.designation,
        person.linkDesignation,
        person.phone,
        person.email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [people, contactFilter]);

  function navigate(orgId: string | null, personId: string | null = null) {
    router.push(buildIntelligenceHref(pathname, orgId, personId));
  }

  function updateDraft(next: string) {
    draftGenerationRef.current += 1;
    setDraft(next);
  }

  function resetComposer() {
    draftGenerationRef.current += 1;
    setDraft("");
    setDraftInputType("text");
  }

  useEffect(() => {
    if (!canView) return;
    const q = search.trim();
    if (!q) {
      setSearchHits([]);
      setSearchLoading(false);
      return;
    }

    const requestId = ++searchRequestId.current;
    const handle = window.setTimeout(() => {
      void runSearch(q, requestId);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [search, canView]);

  /**
   * Browse-on-load: empty query returns active organizations (limit 25).
   * Does not auto-select an organization.
   */
  useEffect(() => {
    if (!canView) {
      setBrowseOrgs([]);
      setBrowseLoading(false);
      setBrowseError(null);
      return;
    }

    const requestId = ++browseRequestId.current;
    setBrowseLoading(true);
    setBrowseError(null);

    void (async () => {
      try {
        const rows = await searchSupplierOrganizations("");
        if (requestId !== browseRequestId.current) return;
        setBrowseOrgs(rows);
      } catch (error) {
        console.error(error);
        if (requestId !== browseRequestId.current) return;
        setBrowseOrgs([]);
        const message = formatSupplierError(
          error,
          "Unable to load organizations."
        );
        setBrowseError(message);
        toast.error(message);
      } finally {
        if (requestId === browseRequestId.current) {
          setBrowseLoading(false);
        }
      }
    })();
  }, [canView]);

  /**
   * Sync selection from URL. Prefer router navigation so browser Back works.
   */
  useEffect(() => {
    if (!canView) return;

    let cancelled = false;

    async function syncFromUrl() {
      if (!orgIdFromUrl) {
        contextGenerationRef.current += 1;
        loadedOrganizationIdRef.current = null;
        setOrganization(null);
        setPeople([]);
        setSelectedPersonId(null);
        setConversations([]);
        setTimelineError(null);
        setContactFilter("");
        resetComposer();
        setOrgLoading(false);
        return;
      }

      setOrgLoading(true);
      try {
        let nextOrg = organization;
        if (!nextOrg || nextOrg.id !== orgIdFromUrl) {
          const loaded = await getSupplierOrganizationById(orgIdFromUrl);
          if (cancelled) return;
          if (!loaded) {
            toast.error("Organization not found.");
            navigate(null);
            return;
          }
          nextOrg = loaded;
          contextGenerationRef.current += 1;
          loadedOrganizationIdRef.current = null;
          setOrganization(loaded);
          setPeople([]);
          setConversations([]);
          setContactFilter("");
          resetComposer();
        }

        const nextPersonId = personIdFromUrl;
        if (nextPersonId !== selectedPersonId) {
          contextGenerationRef.current += 1;
          setSelectedPersonId(nextPersonId);
          setConversations([]);
          setTimelineError(null);
          resetComposer();
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          toast.error(
            formatSupplierError(error, "Unable to open that organization.")
          );
        }
      } finally {
        if (!cancelled) setOrgLoading(false);
      }
    }

    void syncFromUrl();
    return () => {
      cancelled = true;
    };
    // organization/selectedPersonId intentionally omitted — URL is source of truth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, orgIdFromUrl, personIdFromUrl]);

  /**
   * Single authoritative context loader.
   * Organization mode loads people + organization-level notes (person_id IS NULL).
   * Person mode loads only that person's conversations.
   */
  useEffect(() => {
    if (!organization || !canView || !orgIdFromUrl) {
      loadedOrganizationIdRef.current = null;
      setPeople([]);
      setPeopleLoading(false);
      setConversations([]);
      setTimelineLoading(false);
      setTimelineError(null);
      return;
    }

    const generation = ++contextGenerationRef.current;
    const orgId = organization.id;
    const requestedPersonId = selectedPersonId;
    const organizationChanged = loadedOrganizationIdRef.current !== orgId;

    setConversations([]);
    setTimelineError(null);
    setTimelineLoading(true);

    if (organizationChanged) {
      setPeople([]);
      setPeopleLoading(true);
    }

    let cancelled = false;

    async function loadContext() {
      let personIdForTimeline = requestedPersonId;

      if (organizationChanged) {
        try {
          const rows = await listPeopleForOrganization(orgId);
          if (cancelled || generation !== contextGenerationRef.current) return;

          setPeople(rows);
          loadedOrganizationIdRef.current = orgId;

          if (
            requestedPersonId &&
            !rows.some((p) => p.id === requestedPersonId)
          ) {
            personIdForTimeline = null;
            // Person not linked to this org — drop to org contacts via URL.
            navigate(orgId, null);
            return;
          }
        } catch (error) {
          console.error(error);
          if (cancelled || generation !== contextGenerationRef.current) return;
          setPeople([]);
          loadedOrganizationIdRef.current = orgId;
          toast.error(formatSupplierError(error, "Unable to load contacts."));
        } finally {
          if (!cancelled && generation === contextGenerationRef.current) {
            setPeopleLoading(false);
          }
        }
      } else if (
        requestedPersonId &&
        people.length > 0 &&
        !people.some((p) => p.id === requestedPersonId)
      ) {
        navigate(orgId, null);
        return;
      }

      if (cancelled || generation !== contextGenerationRef.current) return;

      try {
        // personId null → organization-level notes only (service enforces IS NULL).
        // personId set → that person's conversations only.
        const rows = await listSupplierConversations({
          organizationId: orgId,
          personId: personIdForTimeline,
          limit: SUPPLIER_CONVERSATION_HISTORY_LIMIT,
        });
        if (cancelled || generation !== contextGenerationRef.current) return;
        setConversations(rows);
      } catch (error) {
        console.error(error);
        if (cancelled || generation !== contextGenerationRef.current) return;
        setConversations([]);
        setTimelineError(
          formatSupplierError(error, "Unable to load conversation history.")
        );
      } finally {
        if (!cancelled && generation === contextGenerationRef.current) {
          setTimelineLoading(false);
        }
      }
    }

    void loadContext();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id, selectedPersonId, canView, orgIdFromUrl]);

  useEffect(() => {
    if (!organization || timelineLoading) return;
    if (workspaceMode === "landing") return;
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    organization?.id,
    selectedPersonId,
    chronological.length,
    timelineLoading,
    workspaceMode,
  ]);

  async function runSearch(query: string, requestId: number) {
    try {
      setSearchLoading(true);
      const [orgs, peopleHits] = await Promise.all([
        searchSupplierOrganizations(query),
        searchSupplierPeople(query),
      ]);

      if (requestId !== searchRequestId.current) return;

      const hits: SearchHit[] = [
        ...orgs.map((organizationHit) => ({
          kind: "organization" as const,
          organization: organizationHit,
        })),
        ...peopleHits.flatMap((hit) =>
          hit.organizations.length > 0
            ? hit.organizations.map((organizationHit) => ({
                kind: "person" as const,
                person: hit.person,
                organization: organizationHit,
              }))
            : []
        ),
      ];

      setSearchHits(hits);
    } catch (error) {
      console.error(error);
      if (requestId === searchRequestId.current) {
        toast.error(
          formatSupplierError(error, "Unable to search organizations and people.")
        );
      }
    } finally {
      if (requestId === searchRequestId.current) {
        setSearchLoading(false);
      }
    }
  }

  async function handleSend() {
    if (!organization || sending || !canCreate) return;

    // Person workspace: notes belong to the selected person.
    // Organization workspace: notes are organization-level (person_id null).
    if (workspaceMode === "landing") return;

    const text = draft.trim();
    if (!text) {
      toast.error("Enter a conversation note before sending.");
      return;
    }

    const orgId = organization.id;
    const saveMode = workspaceMode;
    const personId = saveMode === "person" ? selectedPersonId : null;
    if (saveMode === "person" && !personId) {
      toast.error("Select a contact before saving a conversation.");
      return;
    }
    const saveContextGeneration = contextGenerationRef.current;
    const saveDraftGeneration = draftGenerationRef.current;
    const saveInputType = draftInputType;

    try {
      setSending(true);
      const created = await createSupplierConversation(
        {
          organizationId: orgId,
          personId,
          originalText: text,
          inputType: saveInputType,
        },
        { loggedByName: profile?.displayName || profile?.email || "Unknown" }
      );

      const stillSameContext =
        saveContextGeneration === contextGenerationRef.current &&
        organization?.id === orgId &&
        (saveMode === "person"
          ? selectedPersonId === personId
          : selectedPersonId === null);

      if (stillSameContext) {
        setConversations((prev) => {
          if (prev.some((row) => row.id === created.id)) return prev;
          return [created, ...prev];
        });
      }

      const stillSameDraft =
        stillSameContext &&
        saveDraftGeneration === draftGenerationRef.current;

      if (stillSameDraft) {
        resetComposer();
      }

      toast.success("Conversation saved.");
    } catch (error) {
      console.error(error);
      toast.error(
        formatSupplierError(
          error,
          "Unable to save this conversation. Your draft was kept."
        )
      );
    } finally {
      setSending(false);
    }
  }

  if (!canView) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        You do not have permission to view Supplier Intelligence.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-5">
      <header className="space-y-1.5 border-b border-border/60 pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">
          Relationship memory
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Supplier Intelligence
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Capture conversation memory with organizations and contacts. Meeting
          context is recorded separately from any later interpretation.
        </p>
      </header>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] lg:items-start">
        {/* Context panel — sticky on desktop so it stays put while the right column scrolls */}
        <aside className="supplier-panel flex flex-col gap-3 p-3 sm:p-4 lg:sticky lg:top-4 lg:self-start">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search organizations / people"
              className="pl-9 text-foreground caret-foreground placeholder:text-muted-foreground"
              aria-label="Search organizations and people"
            />
            {search ? (
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearch("");
                  setSearchHits([]);
                }}
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}

            {searchOpen && search.trim() ? (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                {searchLoading ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    Searching…
                  </p>
                ) : searchHits.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No matches found
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {searchHits.map((hit) =>
                      hit.kind === "organization" ? (
                        <li key={`org-${hit.organization.id}`}>
                          <button
                            type="button"
                            className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-muted/50"
                            onClick={() => {
                              setSearch("");
                              setSearchHits([]);
                              setSearchOpen(false);
                              navigate(hit.organization.id, null);
                            }}
                          >
                            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              {hit.organization.name}
                            </span>
                            <span className="pl-5 text-xs text-muted-foreground">
                              {[
                                "Organization",
                                hit.organization.types
                                  .map((t) => t.name)
                                  .join(", ") || null,
                                hit.organization.code,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </button>
                        </li>
                      ) : (
                        <li
                          key={`person-${hit.person.id}-${hit.organization.id}`}
                        >
                          <button
                            type="button"
                            className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-muted/50"
                            onClick={() => {
                              setSearch("");
                              setSearchHits([]);
                              setSearchOpen(false);
                              navigate(hit.organization.id, hit.person.id);
                            }}
                          >
                            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              {hit.person.name}
                            </span>
                            <span className="pl-5 text-xs text-muted-foreground">
                              {[
                                "Contact",
                                hit.person.designation,
                                hit.organization.name,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </button>
                        </li>
                      )
                    )}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          {canCreate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => setAddOrgOpen(true)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Organization
            </Button>
          ) : null}

          {workspaceMode === "landing" ? (
            <div className="space-y-3 border-t border-border pt-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Organizations
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Select an organization to view its contacts.
                </p>
              </div>

              {browseLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Loading organizations…
                </p>
              ) : browseError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-4 text-center">
                  <p className="text-sm text-destructive">{browseError}</p>
                </div>
              ) : browseOrgs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center">
                  <Building2 className="mx-auto h-7 w-7 text-muted-foreground/70" />
                  <p className="mt-2 text-sm font-medium text-foreground">
                    No organizations yet
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {canCreate
                      ? "Add an organization to begin capturing conversations."
                      : "Ask an administrator to add organizations, or request create access."}
                  </p>
                </div>
              ) : (
                <ul className="max-h-[min(60vh,420px)] space-y-1 overflow-y-auto">
                  {browseOrgs.map((org) => (
                    <li key={org.id}>
                      <button
                        type="button"
                        onClick={() => navigate(org.id, null)}
                        className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-muted/60"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {org.name}
                        </span>
                        <span className="pl-5 text-xs text-muted-foreground">
                          {[
                            org.types.map((t) => t.name).join(", ") ||
                              "Organization",
                            org.code,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : organization ? (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Organization
                  </p>
                  <p className="truncate font-heading text-base font-semibold text-foreground">
                    {organization.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[typeLabels, organization.code].filter(Boolean).join(" · ") ||
                      "Organization"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(null)}
                  className="shrink-0"
                >
                  All orgs
                </Button>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Contacts
                  </p>
                  {canCreate ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAddPersonOpen(true)}
                      className="h-7 px-2 text-xs"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add Person
                    </Button>
                  ) : null}
                </div>

                {people.length > 0 ? (
                  <div className="relative mb-2">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={contactFilter}
                      onChange={(e) => setContactFilter(e.target.value)}
                      placeholder="Filter contacts"
                      className="h-8 pl-8 text-xs text-foreground caret-foreground placeholder:text-muted-foreground"
                      aria-label="Filter contacts in this organization"
                    />
                  </div>
                ) : null}

                {peopleLoading ? (
                  <p className="text-sm text-muted-foreground">Loading contacts…</p>
                ) : people.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      No contacts linked yet.
                    </p>
                    {canCreate ? (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-2"
                        onClick={() => setAddPersonOpen(true)}
                      >
                        Add Person
                      </Button>
                    ) : null}
                  </div>
                ) : filteredPeople.length === 0 ? (
                  <p className="px-1 py-2 text-sm text-muted-foreground">
                    No contacts match this filter.
                  </p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {filteredPeople.map((person) => (
                      <li key={person.id}>
                        <button
                          type="button"
                          onClick={() => navigate(organization.id, person.id)}
                          className={cn(
                            "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-foreground transition-colors",
                            selectedPersonId === person.id
                              ? "bg-primary/10"
                              : "hover:bg-muted/60"
                          )}
                        >
                          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            {person.name}
                          </span>
                          {(person.linkDesignation || person.designation) && (
                            <span className="pl-5 text-xs text-muted-foreground">
                              {person.linkDesignation || person.designation}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="border-t border-border pt-3">
              <p className="py-4 text-sm text-muted-foreground">
                {orgLoading ? "Loading organization…" : "Organization unavailable."}
              </p>
            </div>
          )}
        </aside>

        {/* Main workspace — conversation history scrolls inside this column */}
        <section className="supplier-panel flex min-h-[min(70vh,720px)] flex-col overflow-hidden">
          {workspaceMode === "landing" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center">
              <Building2 className="h-8 w-8 text-muted-foreground/70" />
              <p className="text-sm font-medium text-foreground">
                Organizations
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Choose an organization to see its contacts. Conversations open
                after you select a person.
              </p>
            </div>
          ) : workspaceMode === "organization" && organization ? (
            <>
              <header className="space-y-2 border-b border-border px-3 py-3 sm:px-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground"
                  onClick={() => navigate(null)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <div>
                  <p className="truncate font-heading text-base font-semibold text-foreground sm:text-lg">
                    {organization.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {typeLabels || "Organization"}
                  </p>
                </div>
              </header>

              <AskIntelligencePanel
                key={`ask-org-${organization.id}`}
                organizationId={organization.id}
                personId={null}
                organizationName={organization.name}
              />

              <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4 sm:px-4">
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Contacts / People
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Select a contact to open their conversation history.
                      </p>
                    </div>
                    {canCreate ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAddPersonOpen(true)}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Add Person
                      </Button>
                    ) : null}
                  </div>

                  {peopleLoading ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Loading contacts…
                    </p>
                  ) : people.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                      <UserRound className="mx-auto h-7 w-7 text-muted-foreground/70" />
                      <p className="mt-2 text-sm font-medium text-foreground">
                        No contacts yet
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Add people linked to this organization before logging
                        person-level conversations.
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {filteredPeople.map((person) => (
                        <li key={person.id}>
                          <button
                            type="button"
                            onClick={() => navigate(organization.id, person.id)}
                            className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50"
                          >
                            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-foreground">
                                {person.name}
                              </span>
                              {(person.linkDesignation ||
                                person.designation) && (
                                <span className="block text-xs text-muted-foreground">
                                  {person.linkDesignation || person.designation}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="space-y-3 border-t border-border pt-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Organization-level notes
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Notes with no contact selected. These are not shown as a
                      person’s conversations.
                    </p>
                  </div>

                  {timelineLoading ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Loading organization notes…
                    </p>
                  ) : timelineError ? (
                    <p className="py-6 text-center text-sm text-destructive">
                      {timelineError}
                    </p>
                  ) : chronological.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                      <MessageSquareText className="mx-auto h-7 w-7 text-muted-foreground/70" />
                      <p className="mt-2 text-sm font-medium text-foreground">
                        No organization-level notes yet
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Use the composer below for notes that belong to the
                        organization rather than a specific contact.
                      </p>
                    </div>
                  ) : (
                    chronological.map((conversation) => (
                      <ConversationEntry
                        key={conversation.id}
                        conversation={conversation}
                      />
                    ))
                  )}
                  <div ref={timelineEndRef} />
                </section>
              </div>

              {canCreate ? (
                <div className="border-t border-border">
                  <div className="px-3 pt-3 sm:px-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Log a conversation
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Record what you learned in a meeting. This saves a note —
                      it does not ask AI.
                    </p>
                  </div>
                  <ConversationComposer
                    value={draft}
                    onChange={updateDraft}
                    onSend={handleSend}
                    sending={sending}
                    inputType={draftInputType}
                    onInputTypeChange={setDraftInputType}
                  />
                </div>
              ) : (
                <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                  You can view this organization, but you do not have permission
                  to add notes.
                </div>
              )}
            </>
          ) : workspaceMode === "person" && organization ? (
            <>
              <header className="space-y-2 border-b border-border px-3 py-3 sm:px-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground"
                  onClick={() => navigate(organization.id, null)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    {organization.name}
                    {typeLabels ? ` · ${typeLabels}` : ""}
                  </p>
                  <p className="truncate font-heading text-base font-semibold text-foreground sm:text-lg">
                    {selectedPerson?.name ?? "Contact"}
                  </p>
                  {(selectedPerson?.linkDesignation ||
                    selectedPerson?.designation) && (
                    <p className="text-xs text-muted-foreground">
                      {selectedPerson.linkDesignation ||
                        selectedPerson.designation}
                    </p>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Conversations for this contact only · up to{" "}
                  {SUPPLIER_CONVERSATION_HISTORY_LIMIT} recent
                </p>
              </header>

              <AskIntelligencePanel
                key={`ask-person-${organization.id}-${selectedPersonId ?? "none"}`}
                organizationId={organization.id}
                personId={selectedPersonId}
                organizationName={organization.name}
                personName={selectedPerson?.name}
              />

              <div className="border-b border-border px-3 py-2 sm:px-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Conversation history
                </p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4">
                {peopleLoading || timelineLoading ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Loading conversations…
                  </p>
                ) : timelineError ? (
                  <p className="py-10 text-center text-sm text-destructive">
                    {timelineError}
                  </p>
                ) : chronological.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                    <MessageSquareText className="h-8 w-8 text-muted-foreground/70" />
                    <p className="text-sm font-medium text-foreground">
                      {selectedPerson?.name ?? "Contact"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {organization.name}
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      No conversations yet.
                    </p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Start a conversation below.
                    </p>
                  </div>
                ) : (
                  chronological.map((conversation) => (
                    <ConversationEntry
                      key={conversation.id}
                      conversation={conversation}
                    />
                  ))
                )}
                <div ref={timelineEndRef} />
              </div>

              {canCreate ? (
                <div className="border-t border-border">
                  <div className="px-3 pt-3 sm:px-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Log a conversation
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Record what you learned in a meeting. This saves a note —
                      it does not ask AI.
                    </p>
                  </div>
                  <ConversationComposer
                    value={draft}
                    onChange={updateDraft}
                    onSend={handleSend}
                    sending={sending}
                    inputType={draftInputType}
                    onInputTypeChange={setDraftInputType}
                  />
                </div>
              ) : (
                <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                  You can view this timeline, but you do not have permission to
                  add conversations.
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {orgLoading ? "Loading organization…" : "Unable to open workspace."}
              </p>
            </div>
          )}
        </section>
      </div>

      <AddOrganizationDialog
        open={addOrgOpen}
        onOpenChange={setAddOrgOpen}
        onCreated={(created) => {
          setBrowseOrgs((prev) => {
            if (prev.some((o) => o.id === created.id)) return prev;
            return [...prev, created].sort((a, b) =>
              a.name.localeCompare(b.name)
            );
          });
          navigate(created.id, null);
        }}
      />

      {organization ? (
        <AddPersonDialog
          open={addPersonOpen}
          organizationId={organization.id}
          organizationName={organization.name}
          onOpenChange={setAddPersonOpen}
          onCreated={(person) => {
            setPeople((prev) => {
              if (prev.some((p) => p.id === person.id)) return prev;
              return [person, ...prev];
            });
            navigate(organization.id, person.id);
          }}
        />
      ) : null}
    </div>
  );
}
