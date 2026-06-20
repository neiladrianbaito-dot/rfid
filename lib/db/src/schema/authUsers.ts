import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const authUsersTable = pgTable("auth_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  supabaseAuthId: uuid("supabase_auth_id").notNull().unique(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  linkedCardUid: text("linked_card_uid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
