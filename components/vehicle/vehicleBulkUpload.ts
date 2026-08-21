import {
  validateVehicle,
  CAPACITY_UNIT_OPTIONS,
  HIRE_TYPE_OPTIONS,
  OWNER_TYPE_OPTIONS,
  VEHICLE_STATUS_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  type Vehicle,
} from "./vehicle.schema";
import type { VehicleRecord } from "@/components/services/vehicle.service";

/**
 * The exact Vehicle Master columns, in the same order/labels already used
 * by VehicleListPage.tsx's existing CSV Export (`handleExport`) — the
 * app's own established definition of "the Vehicle Master columns". No
 * field is invented here.
 */
export const VEHICLE_TEMPLATE_HEADERS = [
  "Vehicle Number",
  "RC Number",
  "Vehicle Type",
  "Owner Name",
  "Owner Type",
  "Mobile",
  "Capacity",
  "Capacity Unit",
  "Hire Rate",
  "Hire Type",
  "Chassis Number",
  "Engine Number",
  "Insurance Number",
  "Insurance Expiry",
  "Permit Number",
  "Permit Expiry",
  "Fitness Number",
  "Fitness Expiry",
  "PUC Number",
  "PUC Expiry",
  "Remarks",
  "Status",
] as const;

type TemplateHeader = (typeof VEHICLE_TEMPLATE_HEADERS)[number];

const DATE_HEADERS: TemplateHeader[] = [
  "Insurance Expiry",
  "Permit Expiry",
  "Fitness Expiry",
  "PUC Expiry",
];

/** One realistic example row for the "Sample" sheet, matching the fields
 * the Add Vehicle form already collects (see VehicleForm.tsx). */
const SAMPLE_ROW: Record<TemplateHeader, string> = {
  "Vehicle Number": "MH12AB1234",
  "RC Number": "RC-MH12AB1234",
  "Vehicle Type": "Truck",
  "Owner Name": "Ramesh Transport Co",
  "Owner Type": "Own Fleet",
  Mobile: "9876543210",
  Capacity: "10",
  "Capacity Unit": "TON",
  "Hire Rate": "35000",
  "Hire Type": "Fixed",
  "Chassis Number": "CH123456789",
  "Engine Number": "EN987654321",
  "Insurance Number": "INS-001",
  "Insurance Expiry": "2026-12-31",
  "Permit Number": "PERMIT-001",
  "Permit Expiry": "2026-12-31",
  "Fitness Number": "FIT-001",
  "Fitness Expiry": "2026-12-31",
  "PUC Number": "PUC-001",
  "PUC Expiry": "2026-12-31",
  Remarks: "",
  Status: "Active",
};

export interface VehicleUploadRow {
  /** 1-based row number as it appears in the Excel sheet (row 1 is the header). */
  excelRow: number;
  values: Vehicle;
}

export interface VehicleUploadRowError {
  excelRow: number;
  messages: string[];
}

export interface VehicleUploadParseResult {
  rows: VehicleUploadRow[];
  errors: VehicleUploadRowError[];
}

function cellToString(value: unknown): string {
  if (value == null) return "";

  if (value instanceof Date) {
    // exceljs parses genuinely date-formatted cells into JS Date objects;
    // normalize to the same "yyyy-MM-dd" format FormDatePicker already uses.
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (typeof value === "object") {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text.trim();

    const result = (value as { result?: unknown }).result;
    if (result != null) return String(result).trim();

    return "";
  }

  return String(value).trim();
}

function writeHeaderRow(sheet: import("exceljs").Worksheet) {
  sheet.columns = VEHICLE_TEMPLATE_HEADERS.map(() => ({ width: 20 }));

  const headerRow = sheet.getRow(1);
  VEHICLE_TEMPLATE_HEADERS.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  });
}

/**
 * Builds and downloads the two-sheet `.xlsx` template: "Upload Data"
 * (headers only, for the user to fill in) and "Sample" (headers + one
 * realistic example row). No other sheets are added.
 */
export async function downloadVehicleUploadTemplate(): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Transjit Express TMS";
  workbook.created = new Date();

  writeHeaderRow(workbook.addWorksheet("Upload Data"));

  const sampleSheet = workbook.addWorksheet("Sample");
  writeHeaderRow(sampleSheet);
  const sampleRow = sampleSheet.getRow(2);
  VEHICLE_TEMPLATE_HEADERS.forEach((header, index) => {
    sampleRow.getCell(index + 1).value = SAMPLE_ROW[header];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vehicle-master-upload-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads only the "Upload Data" sheet (the "Sample" sheet is always
 * ignored) and validates every row against the EXISTING Vehicle Master
 * rules: `validateVehicle()` — the exact same schema the Add/Edit Vehicle
 * form already uses. `Vehicle Number` is the module's own existing
 * business identifier (it's what every other module — LR, POD, Lorry
 * Expenses — looks vehicles up by), so it is treated as the unique key
 * here, both within the file and against currently existing vehicles.
 * No new business rule or second validation path is invented here.
 *
 * All-or-nothing: if any row fails, `rows` is returned empty so the
 * caller never imports a partial file.
 */
export async function parseAndValidateVehicleUpload(
  file: File,
  existingVehicles: VehicleRecord[]
): Promise<VehicleUploadParseResult> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet("Upload Data");

  if (!sheet) {
    return {
      rows: [],
      errors: [
        {
          excelRow: 1,
          messages: ['Could not find an "Upload Data" sheet in this file. Please use the downloaded template.'],
        },
      ],
    };
  }

  const columnByHeader = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const header = cellToString(cell.value);
    if (header) columnByHeader.set(header, colNumber);
  });

  const missingHeaders = VEHICLE_TEMPLATE_HEADERS.filter((header) => !columnByHeader.has(header));

  if (missingHeaders.length > 0) {
    return {
      rows: [],
      errors: [
        {
          excelRow: 1,
          messages: [`Missing required column(s): ${missingHeaders.join(", ")}. Please use the downloaded template.`],
        },
      ],
    };
  }

  function cellValue(row: import("exceljs").Row, header: TemplateHeader): string {
    const colNumber = columnByHeader.get(header);
    return colNumber ? cellToString(row.getCell(colNumber).value) : "";
  }

  interface ParsedRow {
    excelRow: number;
    values: Vehicle;
    messages: string[];
  }

  const parsedRows: ParsedRow[] = [];
  const rowsByVehicleNumber = new Map<string, number[]>();

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const rawValues = VEHICLE_TEMPLATE_HEADERS.map((header) => cellValue(row, header));
    const isBlankRow = rawValues.every((value) => value === "");
    if (isBlankRow) return;

    const vehicleNumber = cellValue(row, "Vehicle Number").toUpperCase();
    const rcNumber = cellValue(row, "RC Number");
    const rawVehicleType = cellValue(row, "Vehicle Type");
    const ownerName = cellValue(row, "Owner Name");
    const rawOwnerType = cellValue(row, "Owner Type");
    const mobile = cellValue(row, "Mobile");
    const rawCapacity = cellValue(row, "Capacity");
    const rawCapacityUnit = cellValue(row, "Capacity Unit");
    const rawHireRate = cellValue(row, "Hire Rate");
    const rawHireType = cellValue(row, "Hire Type");
    const chassisNumber = cellValue(row, "Chassis Number");
    const engineNumber = cellValue(row, "Engine Number");
    const insuranceNumber = cellValue(row, "Insurance Number");
    const insuranceExpiry = cellValue(row, "Insurance Expiry");
    const permitNumber = cellValue(row, "Permit Number");
    const permitExpiry = cellValue(row, "Permit Expiry");
    const fitnessNumber = cellValue(row, "Fitness Number");
    const fitnessExpiry = cellValue(row, "Fitness Expiry");
    const pucNumber = cellValue(row, "PUC Number");
    const pucExpiry = cellValue(row, "PUC Expiry");
    const remarks = cellValue(row, "Remarks");
    const rawStatus = cellValue(row, "Status");

    const messages: string[] = [];

    let vehicleType = rawVehicleType;
    if (rawVehicleType) {
      const matched = VEHICLE_TYPE_OPTIONS.find(
        (option) => option.toLowerCase() === rawVehicleType.toLowerCase()
      );
      if (!matched) {
        messages.push(`Vehicle Type must be one of: ${VEHICLE_TYPE_OPTIONS.join(", ")}.`);
      } else {
        vehicleType = matched;
      }
    }

    // Same default the Add Vehicle form already uses for a new record.
    let ownerType: Vehicle["ownerType"] = "Own Fleet";
    if (rawOwnerType) {
      const matched = OWNER_TYPE_OPTIONS.find(
        (option) => option.toLowerCase() === rawOwnerType.toLowerCase()
      );
      if (!matched) {
        messages.push(`Owner Type must be one of: ${OWNER_TYPE_OPTIONS.join(", ")}.`);
      } else {
        ownerType = matched;
      }
    }

    let capacityUnit: Vehicle["capacityUnit"] = "TON";
    if (rawCapacityUnit) {
      const matched = CAPACITY_UNIT_OPTIONS.find(
        (option) => option.toLowerCase() === rawCapacityUnit.toLowerCase()
      );
      if (!matched) {
        messages.push(`Capacity Unit must be one of: ${CAPACITY_UNIT_OPTIONS.join(", ")}.`);
      } else {
        capacityUnit = matched;
      }
    }

    let hireType: Vehicle["hireType"] = "Fixed";
    if (rawHireType) {
      const matched = HIRE_TYPE_OPTIONS.find(
        (option) => option.toLowerCase() === rawHireType.toLowerCase()
      );
      if (!matched) {
        messages.push(`Hire Type must be one of: ${HIRE_TYPE_OPTIONS.join(", ")}.`);
      } else {
        hireType = matched;
      }
    }

    let status: Vehicle["status"] = "Active";
    if (rawStatus) {
      const matched = VEHICLE_STATUS_OPTIONS.find(
        (option) => option.toLowerCase() === rawStatus.toLowerCase()
      );
      if (!matched) {
        messages.push(`Status must be one of: ${VEHICLE_STATUS_OPTIONS.join(", ")}.`);
      } else {
        status = matched;
      }
    }

    let capacity = 0;
    if (rawCapacity) {
      const parsed = Number(rawCapacity);
      if (Number.isNaN(parsed)) {
        messages.push("Capacity must be a number.");
      } else {
        capacity = parsed;
      }
    }

    let hireRate = 0;
    if (rawHireRate) {
      const parsed = Number(rawHireRate);
      if (Number.isNaN(parsed)) {
        messages.push("Hire Rate must be a number.");
      } else {
        hireRate = parsed;
      }
    }

    for (const [label, value] of [
      ["Insurance Expiry", insuranceExpiry],
      ["Permit Expiry", permitExpiry],
      ["Fitness Expiry", fitnessExpiry],
      ["PUC Expiry", pucExpiry],
    ] as const) {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        messages.push(`${label} must be a valid date (YYYY-MM-DD).`);
      }
    }

    const candidate: Vehicle = {
      vehicleNumber,
      rcNumber,
      vehicleType,
      ownerName,
      ownerType,
      mobile,
      transporter: "",
      driverName: "",
      driverMobile: "",
      capacity,
      capacityUnit,
      hireRate,
      hireType,
      chassisNumber,
      engineNumber,
      insuranceNumber,
      insuranceExpiry,
      permitNumber,
      permitExpiry,
      fitnessNumber,
      fitnessExpiry,
      pucNumber,
      pucExpiry,
      remarks,
      status,
    };

    for (const message of Object.values(validateVehicle(candidate))) {
      if (message) messages.push(message);
    }

    if (vehicleNumber) {
      if (existingVehicles.some((existing) => existing.vehicleNumber === vehicleNumber)) {
        messages.push(`Vehicle Number "${vehicleNumber}" already exists in Vehicle Master.`);
      }
      rowsByVehicleNumber.set(vehicleNumber, [...(rowsByVehicleNumber.get(vehicleNumber) ?? []), rowNumber]);
    }

    parsedRows.push({ excelRow: rowNumber, values: candidate, messages });
  });

  // In-file duplicate vehicle numbers: every row sharing a non-blank
  // vehicle number is invalid, even if it otherwise passed every check above.
  for (const [vehicleNumber, rowNumbers] of rowsByVehicleNumber) {
    if (rowNumbers.length <= 1) continue;

    const message = `Vehicle Number "${vehicleNumber}" is used by more than one row in this file (rows ${rowNumbers.join(", ")}).`;
    for (const parsedRow of parsedRows) {
      if (rowNumbers.includes(parsedRow.excelRow)) parsedRow.messages.push(message);
    }
  }

  const errors: VehicleUploadRowError[] = parsedRows
    .filter((row) => row.messages.length > 0)
    .map((row) => ({ excelRow: row.excelRow, messages: row.messages }))
    .sort((a, b) => a.excelRow - b.excelRow);

  const rows: VehicleUploadRow[] =
    errors.length > 0
      ? []
      : parsedRows.map((row) => ({ excelRow: row.excelRow, values: row.values }));

  return { rows, errors };
}
