export interface Driver {
  id?: string;

  driverName: string;
  mobile: string;
  licenseNumber: string;
  licenseExpiry: string;
  address: string;

  status: "Active" | "Inactive";
}