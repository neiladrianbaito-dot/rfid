import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Matches the existing `devices` table already in Supabase.
// device_id has a UNIQUE constraint so fare_routes.device_id can reference it.
export const devicesTable = pgTable("devices", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull().unique(),
  name: text("name").notNull(),
  location: text("location"),
  status: text("status").notNull().default("OFFLINE"), // e.g. "ONLINE" / "OFFLINE"
  ipAddress: text("ip_address"),
  firmwareVersion: text("firmware_version"),
  lastPing: timestamp("last_ping"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const insertDeviceSchema = createInsertSchema(devicesTable).omit({ id: true });
export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type Device = typeof devicesTable.$inferSelect;