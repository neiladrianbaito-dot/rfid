import { pgTable, text, serial, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fareRoutesTable = pgTable("fare_routes", {
  id: serial("id").primaryKey(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  fareAmount: numeric("fare_amount", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertFareRouteSchema = createInsertSchema(fareRoutesTable).omit({ id: true });
export type InsertFareRoute = z.infer<typeof insertFareRouteSchema>;
export type FareRoute = typeof fareRoutesTable.$inferSelect;
