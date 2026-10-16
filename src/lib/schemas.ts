import { z } from "zod";
export const carrierIds = ["canada_post", "loomis", "fedex", "purolator"] as const;
export const addressSchema = z
  .object({
    contact_name: z.string().trim().max(100).default(""),
    company: z.string().trim().max(100).default(""),
    address_line1: z.string().trim().max(200).default(""),
    address_line2: z.string().trim().max(200).default(""),
    city: z.string().trim().min(1).max(100).regex(/\p{L}/u, "Enter a city name, not a phone number"),
    region: z.string().trim().min(1).max(100),
    postal_code: z.string().trim().min(1).max(20),
    country_code: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default("CA"),
    phone: z.string().max(40).default(""),
    email: z.union([z.literal(""), z.string().email()]).default(""),
  })
  .strict()
  .superRefine((a, c) => {
    if (
      a.country_code === "CA" &&
      !/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i.test(
        a.postal_code,
      )
    )
      c.addIssue({
        code: "custom",
        path: ["postal_code"],
        message: "Enter a valid Canadian postal code",
      });
    if (a.country_code === "US" && !/^\d{5}(-\d{4})?$/.test(a.postal_code))
      c.addIssue({
        code: "custom",
        path: ["postal_code"],
        message: "Enter a valid ZIP code",
      });
  })
  .transform((a) => ({
    ...a,
    postal_code:
      a.country_code === "CA"
        ? a.postal_code.replace(/\s/g, "").toUpperCase()
        : a.postal_code,
  }));
export type Address = z.infer<typeof addressSchema>;
export const profileSchema = z
  .object({
    profile_name: z.string().trim().min(1).max(100),
    address: addressSchema,
    is_default: z.boolean().default(false),
  })
  .strict();
export const shipmentSchema = z
  .object({
    ship_from: addressSchema,
    ship_to: addressSchema,
    ship_from_profile_id: z.string().uuid().optional(),
    shipDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (s) =>
          !Number.isNaN(Date.parse(s)) &&
          new Date(s).toISOString().slice(0, 10) === s,
        "Invalid date",
      ),
    packages: z
      .array(
        z
          .object({
            length: z.number().nonnegative().max(1000),
            width: z.number().nonnegative().max(1000),
            height: z.number().nonnegative().max(1000),
            dimensionUnit: z.enum(["cm", "in"]),
            weight: z.number().positive().max(1000),
            weightUnit: z.enum(["kg", "lb"]),
            quantity: z.number().int().min(1).max(100).optional(),
          })
          .strict()
          .refine((p) => [p.length, p.width, p.height].every((value) => value === 0) || [p.length, p.width, p.height].every((value) => value > 0), "Enter all three dimensions, or leave all three at 0"),
      )
      .length(1),
    signatureRequired: z.boolean().default(false),
    coverageAmount: z.number().min(0).max(99999.99).default(0),
    coverageCurrency: z.literal("CAD").default("CAD"),
    carriers: z
      .array(z.enum(carrierIds))
      .min(1)
      .max(carrierIds.length)
      .refine((a) => new Set(a).size === a.length, "Duplicate carriers")
      .default([...carrierIds]),
    carrierMode: z.enum(["sandbox", "production"]).default("sandbox"),
  })
  .strict();
export type Shipment = z.infer<typeof shipmentSchema>;
export type Profile = Address & {
  id: string;
  user_id: string;
  profile_name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};
