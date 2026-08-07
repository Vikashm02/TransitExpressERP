export interface VehicleData {
  vehicleNumber: string;
  vehicleType: string;
  transporter: string;
  driverName: string;
  driverMobile: string;
}

export const vehicles: VehicleData[] = [
  {
    vehicleNumber: "MH12AB1234",
    vehicleType: "Truck",
    transporter: "ABC Logistics",
    driverName: "Ramesh Patil",
    driverMobile: "9876543210",
  },
  {
    vehicleNumber: "MH14XY5678",
    vehicleType: "Trailer",
    transporter: "XYZ Transport",
    driverName: "Suresh Shah",
    driverMobile: "9822001122",
  },
];