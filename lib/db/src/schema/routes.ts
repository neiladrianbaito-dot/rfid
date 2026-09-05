import { pgTable, text, serial, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
// 👇 adjust the path below to wherever you save devices-schema.ts in your project
import { devicesTable } from "./devices-schema";

export const fareRoutesTable = pgTable("fare_routes", {
  id: serial("id").primaryKey(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  fareAmount: numeric("fare_amount", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // ✅ NEW: links an active route to the RFID reader device that should
  // process taps for it. Nullable — a route can exist without a device
  // assigned yet (e.g. before first activation). References devices.device_id,
  // matching the UNIQUE constraint + FK you already added in Supabase.
  deviceId: text("device_id").references(() => devicesTable.deviceId),
});

export const insertFareRouteSchema = createInsertSchema(fareRoutesTable).omit({ id: true });
export type InsertFareRoute = z.infer<typeof insertFareRouteSchema>;
export type FareRoute = typeof fareRoutesTable.$inferSelect;