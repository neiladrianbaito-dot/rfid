import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const profilesTable = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name").notNull().default(""),
  linkedCardUid: text("linked_card_uid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profilesTable.$inferSelect;
