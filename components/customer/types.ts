export interface Customer {
  code: string;
  name: string;
  gst: string;
  mobile: string;
  email: string;
  city: string;
  address: string;
  status: "Active" | "Inactive";
}