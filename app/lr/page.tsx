"use client";

import { useEffect, useState } from "react";

import LRDialog from "@/components/lr/LRDialog";
import LRTable from "@/components/lr/LRTable";

import { getLRs } from "@/components/services/lr.service";

import { LR } from "@/components/lr/types";

export default function LRPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const [lrs, setLRs] = useState<LR[]>([]);

  async function loadLRs() {
    try {
      const data = await getLRs();

      setLRs(data ?? []);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadLRs();
  }, []);

  return (
    <>
      <LRTable
        lrs={lrs}
        onCreate={() => setDialogOpen(true)}
        onRefresh={loadLRs}
      />

      <LRDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);

          if (!open) {
            loadLRs();
          }
        }}
      />
    </>
  );
}