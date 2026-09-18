import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, transactionsTable } from "@workspace/db";
import {
  ListUsersQueryParams,
  ListUsersResponse,
  CreateUserBody,
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeleteUserParams,
  ListRecentUsersResponse,
} from "@workspace/api-zod";
import { verifyAdminToken } from "../lib/admin-token";
import { logAudit } from "../lib/audit-logger";
import { unlinkCardFromAnyAccount } from "./auth"; // adjust path if your auth routes file has a different name/location

const router: IRouter = Router();

// ============================================================================
// ⚠️ IMPORTANT — companion change needed outside this file:
// CreateUserBody / UpdateUserBody / GetUserResponse / ListUsersResponse /
// ListRecentUsersResponse in @workspace/api-zod must also declare the new
// optional fields below (dateOfBirth, streetAddress, zipCode, regionCode,
// regionName, provinceCode, provinceName, cityCode, cityName, barangayCode,
// barangayName, fullAddress, idImagePath) or Zod will silently strip them
// from parsed.data / from the response, even though this route reads and
// writes them correctly. `.parse()` drops unknown keys by default instead
// of throwing, so this failure mode is silent — test it after wiring both
// sides up.
// ============================================================================

// Column name (snake_case in DB) <-> body/response field name (camelCase)
// for every field that may or may not exist yet, same spirit as the
// existing `type` column detection below. Add/remove entries here once
// you've run add_registration_fields.sql and don't need the fallback anymore.
const OPTIONAL_USER_COLUMNS = [
  { col: "date_of_birth", field: "dateOfBirth" },
  { col: "street_address", field: "streetAddress" },
  { col: "zip_code", field: "zipCode" },
  { col: "region_code", field: "regionCode" },
  { col: "region_name", field: "regionName" },
  { col: "province_code", field: "provinceCode" },
  { col: "province_name", field: "provinceName" },
  { col: "city_code", field: "cityCode" },
  { col: "city_name", field: "cityName" },
  { col: "barangay_code", field: "barangayCode" },
  { col: "barangay_name", field: "barangayName" },
  { col: "full_address", field: "fullAddress" },
  { col: "id_image_path", field: "idImagePath" },
] as const;

let cachedUserColumns: Set<string> | null = null;

type UserRow = {
  id: number;
  cardUid: string;
  fullName: string;
  contactNumber: string;
  type: string;
  balance: string | number;
  status: string;
  createdAt: Date | string;
  expirationDate: Date | string | null;
  email: string | null;
  dateOfBirth?: string | null;
  streetAddress?: string | null;
  zipCode?: string | null;
  regionCode?: string | null;
  regionName?: string | null;
  provinceCode?: string | null;
  provinceName?: string | null;
  cityCode?: string | null;
  cityName?: string | null;
  barangayCode?: string | null;
  barangayName?: string | null;
  fullAddress?: string | null;
  idImagePath?: string | null;
};

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

// ── Who's making this request? ──────────────────────────────────────────────
function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function getActorFromRequest(authorization?: string): string {
  const token = getBearerToken(authorization);
  if (!token) return "unknown";
  const adminUser = verifyAdminToken(token);
  return adminUser?.username ?? "unknown";
}

// ── Detect which optional columns actually exist on `users` right now ──────
// Cached after the first call (per server process), same pattern as the
// original `usersHasTypeColumn` flag, just generalized to a whole Set.
async function getUsersColumns(): Promise<Set<string>> {
  if (cachedUserColumns !== null) return cachedUserColumns;

  const namesToCheck = ["type", ...OPTIONAL_USER_COLUMNS.map((c) => c.col)];
  const result = await db.execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = any(${namesToCheck})
  `);
  cachedUserColumns = new Set(
    extractRows<{ column_name: string }>(result).map((r) => r.column_name),
  );
  return cachedUserColumns;
}

async function detectUsersColumns(): Promise<{ hasType: boolean; columns: Set<string> }> {
  const columns = await getUsersColumns();
  return { hasType: columns.has("type"), columns };
}

// Builds the `, u.col as "field"` (or `, null as "field"`) fragments for
// every optional column, so every SELECT stays correct whether or not
// add_registration_fields.sql has been run yet.
function buildOptionalSelectFragment(columns: Set<string>) {
  const parts = OPTIONAL_USER_COLUMNS.map(({ col, field }) =>
    columns.has(col) ? sql.raw(`, u.${col} as "${field}"`) : sql.raw(`, null as "${field}"`),
  );
  return sql.join(parts, sql``);
}

function formatUser(u: UserRow) {
  const email =
    u.email && u.email.trim() !== "" && u.email.toLowerCase() !== "none"
      ? u.email.trim()
      : null;
  return {
    id: Number(u.id),
    cardUid: u.cardUid,
    fullName: u.fullName,
    contactNumber: u.contactNumber,
    type: u.type || "Regular",
    balance: Number(u.balance),
    status: u.status,
    createdAt: new Date(u.createdAt),
    expirationDate: u.expirationDate ? new Date(u.expirationDate) : null,
    email,
    dateOfBirth: u.dateOfBirth ?? null,
    streetAddress: u.streetAddress ?? null,
    zipCode: u.zipCode ?? null,
    regionCode: u.regionCode ?? null,
    regionName: u.regionName ?? null,
    provinceCode: u.provinceCode ?? null,
    provinceName: u.provinceName ?? null,
    cityCode: u.cityCode ?? null,
    cityName: u.cityName ?? null,
    barangayCode: u.barangayCode ?? null,
    barangayName: u.barangayName ?? null,
    fullAddress: u.fullAddress ?? null,
    idImagePath: u.idImagePath ?? null,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  if (err.code === "23505") return true;
  const cause = err.cause as Record<string, unknown> | undefined;
  if (cause?.code === "23505") return true;
  const message = String(err.message ?? "").toLowerCase();
  if (message.includes("duplicate key") || message.includes("unique constraint")) return true;
  const causeMessage = String(cause?.message ?? "").toLowerCase();
  if (causeMessage.includes("duplicate key") || causeMessage.includes("unique constraint"))
    return true;
  return false;
}

const EMAIL_JOIN = sql`
  left join auth_users a
    on lower(trim(a.linked_card_uid)) = lower(trim(u.card_uid))
    and a.linked_card_uid is not null
    and trim(a.linked_card_uid) <> ''
    and lower(trim(a.linked_card_uid)) <> 'none'
`;

// ── GET /users/recent ──────────────────────────────────────────────────────────
router.get("/users/recent", async (_req, res): Promise<void> => {
  try {
    const { hasType, columns } = await detectUsersColumns();
    const result = await db.execute(sql`
      select
        u.id,
        u.card_uid       as "cardUid",
        u.full_name      as "fullName",
        u.contact_number as "contactNumber",
        ${hasType ? sql`u.type` : sql`'Regular'::text as type`},
        u.balance,
        u.status,
        u.created_at     as "createdAt",
        u.expiration_date as "expirationDate"
        ${buildOptionalSelectFragment(columns)},
        a.email          as "email"
      from users u
      ${EMAIL_JOIN}
      order by u.created_at desc
      limit 5
    `);
    const users = extractRows<UserRow>(result).map(formatUser);
    res.json(ListRecentUsersResponse.parse(users));
  } catch (error) {
    console.error("List recent users error:", error);
    res.status(500).json({ error: "Failed to fetch recent users" });
  }
});

// ── GET /users ─────────────────────────────────────────────────────────────────
router.get("/users", async (req, res): Promise<void> => {
  try {
    const { hasType, columns } = await detectUsersColumns();
    const params = ListUsersQueryParams.safeParse(req.query);
    const search = (params.success ? params.data.search : undefined)?.trim();
    const hasSearch = !!search;
    const like = `%${search ?? ""}%`;

    const result = await db.execute(sql`
      select
        u.id,
        u.card_uid       as "cardUid",
        u.full_name      as "fullName",
        u.contact_number as "contactNumber",
        ${hasType ? sql`u.type` : sql`'Regular'::text as type`},
        u.balance,
        u.status,
        u.created_at     as "createdAt",
        u.expiration_date as "expirationDate"
        ${buildOptionalSelectFragment(columns)},
        a.email          as "email"
      from users u
      ${EMAIL_JOIN}
      ${hasSearch
        ? sql`where u.full_name ilike ${like}
           or u.card_uid ilike ${like}
           or u.contact_number ilike ${like}
           or a.email ilike ${like}`
        : sql``}
      order by u.created_at desc
    `);

    const users = extractRows<UserRow>(result).map(formatUser);
    res.json(ListUsersResponse.parse(users));
  } catch (error) {
    console.error("List users error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ── POST /users ────────────────────────────────────────────────────────────────
router.post("/users", async (req, res): Promise<void> => {
  console.log("[POST /users] raw body:", req.body);

  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    console.error("[POST /users] zod error:", parsed.error.message);
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { cardUid, fullName, contactNumber, initialBalance, type } = parsed.data;
  // Cast to `any` for the new optional fields until CreateUserBody in
  // @workspace/api-zod declares them — see the note at the top of this file.
  const body = parsed.data as typeof parsed.data & Record<string, unknown>;

  try {
    const { hasType, columns } = await detectUsersColumns();
    const normalizedType = type || "Regular";

    const existing = await db.execute(sql`
      select id from users where card_uid = ${cardUid.trim()} limit 1
    `);
    if (extractRows(existing).length > 0) {
      res.status(409).json({ error: "Card UID already exists" });
      return;
    }

    // Base columns that always exist, plus `type` and any of the new
    // optional columns that are actually present in the table right now.
    const insertColumns: string[] = ["card_uid", "full_name", "contact_number", "balance", "status"];
    const insertValues: unknown[] = [cardUid.trim(), fullName.trim(), contactNumber.trim(), String(initialBalance), "Active"];

    if (hasType) {
      insertColumns.push("type");
      insertValues.push(normalizedType);
    }

    for (const { col, field } of OPTIONAL_USER_COLUMNS) {
      if (!columns.has(col)) continue;
      const value = body[field];
      insertColumns.push(col);
      insertValues.push(value === undefined || value === "" ? null : value);
    }

    const columnsSql = sql.join(insertColumns.map((c) => sql.raw(c)), sql`, `);
    const valuesSql = sql.join(insertValues.map((v) => sql`${v}`), sql`, `);

    const insertResult = await db.execute(sql`
      insert into users (${columnsSql})
      values (${valuesSql})
      returning
        id,
        card_uid          as "cardUid",
        full_name         as "fullName",
        contact_number    as "contactNumber",
        ${hasType ? sql`type` : sql`'Regular'::text as type`},
        balance,
        status,
        created_at        as "createdAt",
        expiration_date   as "expirationDate"
        ${buildOptionalSelectFragment(columns)}
    `);

    const inserted = extractRows<UserRow>(insertResult)[0];
    inserted.email = null;

    await logAudit({
      user: getActorFromRequest(req.headers.authorization),
      action: "CREATE",
      entity: "User",
      details: `created user: ${inserted.fullName} (card ${inserted.cardUid})`,
    });

    res.status(201).json(GetUserResponse.parse(formatUser(inserted)));
  } catch (error) {
    console.error("[POST /users] catch error:", error);
    if (isDuplicateKeyError(error)) {
      res.status(409).json({ error: "Card UID already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to register card in database" });
  }
});

// ── GET /users/:id ─────────────────────────────────────────────────────────────
router.get("/users/:id", async (req, res): Promise<void> => {
  try {
    const params = GetUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const { hasType, columns } = await detectUsersColumns();
    const result = await db.execute(sql`
      select
        u.id,
        u.card_uid       as "cardUid",
        u.full_name      as "fullName",
        u.contact_number as "contactNumber",
        ${hasType ? sql`u.type` : sql`'Regular'::text as type`},
        u.balance,
        u.status,
        u.created_at     as "createdAt",
        u.expiration_date as "expirationDate"
        ${buildOptionalSelectFragment(columns)},
        a.email          as "email"
      from users u
      ${EMAIL_JOIN}
      where u.id = ${params.data.id}
      limit 1
    `);
    const user = extractRows<UserRow>(result)[0];

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(GetUserResponse.parse(formatUser(user)));
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ── PATCH /users/:id ───────────────────────────────────────────────────────────
router.patch("/users/:id", async (req, res): Promise<void> => {
  try {
    const { hasType, columns } = await detectUsersColumns();
    const params = UpdateUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Cast to `any` for the new optional fields until UpdateUserBody in
    // @workspace/api-zod declares them — see the note at the top of this file.
    const body = parsed.data as typeof parsed.data & Record<string, unknown>;

    const updates: Array<{ col: string; val: string | number | null }> = [];
    if (parsed.data.fullName !== undefined)
      updates.push({ col: "full_name", val: parsed.data.fullName });
    if (parsed.data.contactNumber !== undefined)
      updates.push({ col: "contact_number", val: parsed.data.contactNumber });
    if (parsed.data.balance !== undefined)
      updates.push({ col: "balance", val: String(parsed.data.balance) });
    if (parsed.data.status !== undefined)
      updates.push({ col: "status", val: parsed.data.status });
    if (hasType && parsed.data.type !== undefined)
      updates.push({ col: "type", val: parsed.data.type });

    // Same pattern for the new personal/address/ID fields — only applies
    // updates for columns that exist AND were actually sent in the body.
    for (const { col, field } of OPTIONAL_USER_COLUMNS) {
      if (!columns.has(col)) continue;
      const value = body[field];
      if (value === undefined) continue;
      updates.push({ col, val: value === "" ? null : (value as string | number | null) });
    }

    if (updates.length === 0) {
      res.status(400).json({ error: "No updatable fields provided" });
      return;
    }

    const setClauses = sql.join(
      updates.map(({ col, val }) => sql`${sql.raw(col)} = ${val}`),
      sql`, `,
    );

    const result = await db.execute(sql`
      update users
      set ${setClauses}
      where id = ${params.data.id}
      returning
        id,
        card_uid         as "cardUid",
        full_name        as "fullName",
        contact_number   as "contactNumber",
        ${hasType ? sql`type` : sql`'Regular'::text as type`},
        balance,
        status,
        created_at       as "createdAt",
        expiration_date  as "expirationDate"
        ${buildOptionalSelectFragment(columns)}
    `);
    const userRow = extractRows<UserRow>(result)[0];

    if (!userRow) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // ➕ Auto-unlink: if this update just blocked or deactivated the card,
    // strip it from whatever auth_users account currently has it linked
    // so it becomes immediately available to relink to a different card.
    // This must run BEFORE the email lookup below so the response
    // reflects the unlink right away instead of showing stale data.
    const statusChangedTo = parsed.data.status?.trim();
    const shouldAutoUnlink =
      statusChangedTo === "Blocked" || statusChangedTo === "Inactive";

    if (shouldAutoUnlink) {
      const actorUsername = getActorFromRequest(req.headers.authorization);
      await unlinkCardFromAnyAccount(
        userRow.cardUid,
        { username: actorUsername },
        `card status changed to "${statusChangedTo}"`
      );
    }

    const emailResult = await db.execute(sql`
      select email
      from auth_users
      where lower(trim(linked_card_uid)) = lower(trim(${userRow.cardUid}))
        and linked_card_uid is not null
        and trim(linked_card_uid) <> ''
        and lower(trim(linked_card_uid)) <> 'none'
      limit 1
    `);
    const emailRow = extractRows<{ email: string | null }>(emailResult)[0];
    userRow.email = emailRow?.email ?? null; // correctly null now if we just auto-unlinked above

    await logAudit({
      user: getActorFromRequest(req.headers.authorization),
      action: "UPDATE",
      entity: "User",
      details: `updated user: ${userRow.fullName} (card ${userRow.cardUid}) — fields changed: ${updates.map((u) => u.col).join(", ")}`,
    });

    res.json(UpdateUserResponse.parse(formatUser(userRow)));
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// ── DELETE /users/:id ──────────────────────────────────────────────────────────
router.delete("/users/:id", async (req, res): Promise<void> => {
  try {
    const params = DeleteUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    let deletedUserInfo: { fullName: string; cardUid: string } | null = null;

    const deleted = await db.transaction(async (tx) => {
      const [existingUser] = await tx
        .select({ id: usersTable.id, cardUid: usersTable.cardUid, fullName: usersTable.fullName })
        .from(usersTable)
        .where(eq(usersTable.id, params.data.id))
        .limit(1);

      if (!existingUser) return false;

      deletedUserInfo = { fullName: existingUser.fullName, cardUid: existingUser.cardUid };

      // Remove any card balance transfers referencing this user as source or target
      await tx.execute(sql`
        delete from card_balance_transfers
        where source_card_id = ${existingUser.id}
           or target_card_id = ${existingUser.id}
      `);

      await tx
        .delete(transactionsTable)
        .where(eq(transactionsTable.cardUid, existingUser.cardUid));

      await tx.delete(usersTable).where(eq(usersTable.id, params.data.id));

      return true;
    });

    if (!deleted) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await logAudit({
      user: getActorFromRequest(req.headers.authorization),
      action: "DELETE",
      entity: "User",
      details: `deleted user: ${deletedUserInfo?.fullName} (card ${deletedUserInfo?.cardUid})`,
    });

    res.sendStatus(204);
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;