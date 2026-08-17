import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

export const CUSTOMER_STATUS_OPTIONS = ["Active", "Inactive"] as const;

const GST_PATTERN = /^[0-9A-Z]{15}$/;
const MOBILE_PATTERN = /^\d{10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const customerSchema = z.object({
  code: z.string(),
  name: z.string().trim().min(1, "Customer name is required."),
  gst: z
    .string()
    .trim()
    .refine((value) => value === "" || GST_PATTERN.test(value), {
      message: "Enter a valid 15-character GST number.",
    }),
  mobile: z
    .string()
    .trim()
    .refine((value) => value === "" || MOBILE_PATTERN.test(value), {
      message: "Enter a valid 10-digit mobile number.",
    }),
  email: z
    .string()
    .trim()
    .refine((value) => value === "" || EMAIL_PATTERN.test(value), {
      message: "Enter a valid email address.",
    }),
  city: z.string().trim(),
  address: z.string().trim(),
  status: z.enum(CUSTOMER_STATUS_OPTIONS),
  entryStatus: z.enum(["draft", "final"]).default("final"),
});

export type Customer = z.infer<typeof customerSchema>;
export type CustomerStatus = Customer["status"];

export function validateCustomer(values: Customer) {
  return getFieldErrors(customerSchema, values);
}
