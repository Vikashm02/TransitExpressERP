"use client";

import { Search, Download, RotateCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  onExport?: () => void;
  onRefresh?: () => void;
}

export default function SearchToolbar({
  search,
  onSearchChange,
  placeholder = "Search...",
  onExport,
  onRefresh,
}: SearchToolbarProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-xl border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">

      <div className="relative w-full md:max-w-md">
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />

        <Input
          className="pl-10"
          value={search}
          placeholder={placeholder}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="flex gap-3">

        <Button
          variant="outline"
          onClick={onRefresh}
        >
          <RotateCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>

        <Button
          variant="outline"
          onClick={onExport}
        >
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>

      </div>

    </div>
  );
}