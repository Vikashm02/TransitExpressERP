export interface CustomerData {
  id: number;

  name: string;

  gst: string;

  address: string;

  city: string;

  state: string;
}

export const customers: CustomerData[] = [
  {
    id: 1,
    name: "ABC Steel Pvt Ltd",
    gst: "27ABCDE1234F1Z5",
    address: "MIDC Industrial Area, Pune",
    city: "Pune",
    state: "Maharashtra",
  },
  {
    id: 2,
    name: "XYZ Industries",
    gst: "27XYZAB1234Q1Z8",
    address: "Chakan, Pune",
    city: "Pune",
    state: "Maharashtra",
  },
];