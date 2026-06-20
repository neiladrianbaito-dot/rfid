import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  cardUid: text("card_uid").notNull().unique(),
  fullName: text("full_name").notNull(),
  /** Lowercase app login email; must match auth_users.email when signing in. */
 
  contactNumber: text("contact_number").notNull(),
  type: text("type").notNull().default("Regular"), 
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable, {
  type: z.enum(['Student', 'Regular', 'PWD', 'Senior']).default('Regular'),
}).omit({ 
  id: true, 
  createdAt: true,
  // totalWallet removed — hindi existing field sa usersTable
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;