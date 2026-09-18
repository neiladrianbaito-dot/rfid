import { pgTable, text, serial, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  cardUid: text("card_uid").notNull().unique(),
  fullName: text("full_name").notNull(),

  /** Lowercase app login email; must match auth_users.email when signing in. */
  email: text("email"),

  contactNumber: text("contact_number").notNull(),
  type: text("type").notNull().default("Regular"),
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expirationDate: timestamp("expiration_date", { withTimezone: true }), // 👈 idinagdag

  // Address / KYC fields — must stay in sync with `userAddressResponseFields` /
  // `userAddressBodyFields` in api.schemas.ts. These were referenced by the API
  // layer but had no backing columns, so the backend's column-detection fallback
  // was silently returning `null` for all of them.
  dateOfBirth: date("date_of_birth"),
  streetAddress: text("street_address"),
  zipCode: text("zip_code"),
  regionCode: text("region_code"),
  regionName: text("region_name"),
  provinceCode: text("province_code"),
  provinceName: text("province_name"),
  cityCode: text("city_code"),
  cityName: text("city_name"),
  barangayCode: text("barangay_code"),
  barangayName: text("barangay_name"),
  fullAddress: text("full_address"),
  idImagePath: text("id_image_path"),
});

export const insertUserSchema = createInsertSchema(usersTable, {
  type: z.enum(["Student", "Regular", "PWD", "Senior"]).default("Regular"),
  email: z.string().email().optional(),
  // Stored as a SQL `date` column, but accepted as an ISO "YYYY-MM-DD" string
  // from the <input type="date"> form value, matching CreateUserBody.
  dateOfBirth: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  expirationDate: true, // 👈 idinagdag — hindi kailangan sa insert, may DB trigger na gumagawa nito
  // totalWallet removed — hindi existing field sa usersTable
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;