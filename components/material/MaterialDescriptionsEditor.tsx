"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormSection from "@/components/ui/FormSection";
import {
  createMaterialDescription,
  getMaterialDescriptions,
  updateMaterialDescription,
  type MaterialDescriptionRecord,
} from "@/components/services/material.service";

export default function MaterialDescriptionsEditor({ materialId }: { materialId: number }) {
  const [rows, setRows] = useState<MaterialDescriptionRecord[]>([]);
  const [draft, setDraft] = useState("");

  async function load() {
    try {
      setRows(await getMaterialDescriptions(materialId));
    } catch (error) {
      console.error(error);
      toast.error("Unable to load recommended descriptions.");
    }
  }

  useEffect(() => { void load(); }, [materialId]);

  async function add() {
    const description = draft.trim();
    if (!description) return;
    try {
      await createMaterialDescription(materialId, description);
      setDraft("");
      await load();
    } catch (error) {
      console.error(error);
      toast.error("Unable to add the recommended description.");
    }
  }

  async function save(row: MaterialDescriptionRecord, patch: Partial<Pick<MaterialDescriptionRecord, "description" | "active" | "sortOrder">>) {
    const description = (patch.description ?? row.description).trim();
    if (!description) return;
    try {
      await updateMaterialDescription(row.id, {
        description,
        active: patch.active ?? row.active,
        sortOrder: patch.sortOrder ?? row.sortOrder,
      });
      await load();
    } catch (error) {
      console.error(error);
      toast.error("Unable to update the recommended description.");
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const row = rows[index];
    const other = rows[index + direction];
    if (!row || !other) return;
    try {
      await Promise.all([
        updateMaterialDescription(row.id, { description: row.description, active: row.active, sortOrder: other.sortOrder }),
        updateMaterialDescription(other.id, { description: other.description, active: other.active, sortOrder: row.sortOrder }),
      ]);
      await load();
    } catch (error) {
      console.error(error);
      toast.error("Unable to reorder recommended descriptions.");
    }
  }

  return (
    <FormSection title="Recommended Descriptions" subtitle="Suggestions for LR staff. LR descriptions remain editable free text.">
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a recommended description" />
          <Button type="button" onClick={() => void add()}>Add</Button>
        </div>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No recommendations yet.</p> : (
          <ul className="space-y-2">
            {rows.map((row, index) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                <Input
                  defaultValue={row.description}
                  aria-label="Recommended description"
                  className={row.active ? "min-w-48 flex-1" : "min-w-48 flex-1 text-muted-foreground"}
                  onBlur={(event) => void save(row, { description: event.target.value })}
                />
                <Button type="button" size="sm" variant="outline" onClick={() => void save(row, { active: !row.active })}>
                  {row.active ? "Deactivate" : "Activate"}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => void move(index, -1)}>Up</Button>
                <Button type="button" size="sm" variant="ghost" disabled={index === rows.length - 1} onClick={() => void move(index, 1)}>Down</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormSection>
  );
}
