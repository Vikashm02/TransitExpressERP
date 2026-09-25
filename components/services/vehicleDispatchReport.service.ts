import { supabase } from "@/lib/supabase";

export interface VehicleDispatchFilters {
  fromDate: string;
  toDate: string;
  consignor?: string;
  consignee?: string;
  page?: number;
  pageSize?: number;
}

export interface VehicleDispatchRow {
  id: string;
  lrDate: string;
  lrNumber: string;
  vehicleNumber: string;
  consignor: string;
  consignee: string;
  material: string;
  loadingWeight: number;
  from: string;
  to: string;
}

export interface VehicleDispatchReport {
  filters: Required<Pick<VehicleDispatchFilters, "fromDate" | "toDate">> & { consignor: string; consignee: string };
  summary: { totalLoads: number; uniqueVehicles: number; totalLoadingWeight: number };
  filterOptions: { consignors: string[]; consignees: string[] };
  pagination: { page: number; pageSize: number; totalCount: number };
  rows: VehicleDispatchRow[];
}

function numberValue(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function mapReport(data: Record<string, unknown>): VehicleDispatchReport {
  const filters = (data.filters ?? {}) as Record<string, unknown>;
  const summary = (data.summary ?? {}) as Record<string, unknown>;
  const options = (data.filter_options ?? {}) as Record<string, unknown>;
  const pagination = (data.pagination ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(data.rows) ? data.rows : [];

  return {
    filters: {
      fromDate: stringValue(filters.from_date),
      toDate: stringValue(filters.to_date),
      consignor: stringValue(filters.consignor),
      consignee: stringValue(filters.consignee),
    },
    summary: {
      totalLoads: numberValue(summary.total_loads),
      uniqueVehicles: numberValue(summary.unique_vehicles),
      totalLoadingWeight: numberValue(summary.total_loading_weight),
    },
    filterOptions: {
      consignors: stringList(options.consignors),
      consignees: stringList(options.consignees),
    },
    pagination: {
      page: numberValue(pagination.page) || 1,
      pageSize: numberValue(pagination.page_size) || 50,
      totalCount: numberValue(pagination.total_count),
    },
    rows: rows.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: stringValue(row.id),
        lrDate: stringValue(row.lr_date),
        lrNumber: stringValue(row.lr_number),
        vehicleNumber: stringValue(row.vehicle_number),
        consignor: stringValue(row.consignor),
        consignee: stringValue(row.consignee),
        material: stringValue(row.material),
        loadingWeight: numberValue(row.loading_weight),
        from: stringValue(row.from_station),
        to: stringValue(row.to_station),
      };
    }),
  };
}

export async function getVehicleDispatchReport(filters: VehicleDispatchFilters): Promise<VehicleDispatchReport> {
  const { data, error } = await supabase.rpc("get_vehicle_dispatch_report", {
    p_from: filters.fromDate,
    p_to: filters.toDate,
    p_consignor: filters.consignor?.trim() || null,
    p_consignee: filters.consignee?.trim() || null,
    p_page: filters.page ?? 1,
    p_page_size: filters.pageSize ?? 50,
  });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("Vehicle Dispatch Report returned no data.");
  return mapReport(data as Record<string, unknown>);
}

/** Retrieves every result through bounded report-RPC pages for export only. */
export async function getAllVehicleDispatchRows(filters: Omit<VehicleDispatchFilters, "page" | "pageSize">): Promise<VehicleDispatchReport> {
  const pageSize = 100;
  const first = await getVehicleDispatchReport({ ...filters, page: 1, pageSize });
  const rows = [...first.rows];
  const pages = Math.ceil(first.pagination.totalCount / pageSize);
  for (let page = 2; page <= pages; page += 1) {
    const next = await getVehicleDispatchReport({ ...filters, page, pageSize });
    rows.push(...next.rows);
  }
  return { ...first, rows, pagination: { ...first.pagination, page: 1, pageSize: rows.length, totalCount: rows.length } };
}
