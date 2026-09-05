import { pgTable, text, serial, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// 👇 If your devices table is exported from this same schema file (or an
// import from it), import it here so we can reference devices.device_id as
// a foreign key. Adjust the import path/name to match your actual devices
// table export — e.g. `import { devicesTable } from "./devices";`
// import { devicesTable } from "./devices";

export const fareRoutesTable = pgTable("fare_routes", {
  id: serial("id").primaryKey(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  fareAmount: numeric("fare_amount", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // ✅ NEW: links an active route to the RFID reader device that should
  // process taps for it. Nullable — a route can exist without a device
  // assigned yet (e.g. before first activation).
  deviceId: text("device_id"),
  // If devices.device_id has a UNIQUE constraint, you can enforce referential
  // integrity like this instead of the plain text column above:
  // deviceId: text("device_id").references(() => devicesTable.deviceId),
});

export const insertFareRouteSchema = createInsertSchema(fareRoutesTable).omit({ id: true });
export type InsertFareRoute = z.infer<typeof insertFareRouteSchema>;
export type FareRoute = typeof fareRoutesTable.$inferSelect;