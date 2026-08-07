export interface Vehicle {
  id?: string;

  vehicleNumber: string;
  vehicleType: string;
  ownerName: string;
  mobile: string;

  rcNumber: string;
  insuranceNumber: string;

  status: "Active" | "Inactive";
}