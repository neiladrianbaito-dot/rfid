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

const router: IRouter = Router();

let usersHasTypeColumn: boolean | null = null;

type UserRow = {
  id: number;
  cardUid: string;
  fullName: string;
  contactNumber: string;
  type: string;
  balance: string | number;
  status: string;
  createdAt: Date | string;
  email: string | null;
};

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

async function detectUsersColumns(): Promise<{ hasType: boolean }> {
  if (usersHasTypeColumn !== null) {
    return { hasType: usersHasTypeColumn };
  }
  const result = await db.execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name in ('type')
  `);
  const columns = new Set(
    extractRows<{ column_name: string }>(result).map((r) => r.column_name),
  );
  usersHasTypeColumn = columns.has("type");
  return { hasType: usersHasTypeColumn };
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
    email,
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
    const { hasType } = await detectUsersColumns();
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
    const { hasType } = await detectUsersColumns();
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

  try {
    const { hasType } = await detectUsersColumns();
    const normalizedType = type || "Regular";

    const existing = await db.execute(sql`
      select id from users where card_uid = ${cardUid.trim()} limit 1
    `);
    if (extractRows(existing).length > 0) {
      res.status(409).json({ error: "Card UID already exists" });
      return;
    }

    let insertResult: unknown;

    if (hasType) {
      insertResult = await db.execute(sql`
        insert into users (card_uid, full_name, contact_number, type, balance, status)
        values (${cardUid.trim()}, ${fullName.trim()}, ${contactNumber.trim()}, ${normalizedType}, ${String(initialBalance)}, 'Active')
        returning id, card_uid as "cardUid", full_name as "fullName", contact_number as "contactNumber",
          type, balance, status, created_at as "createdAt"
      `);
    } else {
      insertResult = await db.execute(sql`
        insert into users (card_uid, full_name, contact_number, balance, status)
        values (${cardUid.trim()}, ${fullName.trim()}, ${contactNumber.trim()}, ${String(initialBalance)}, 'Active')
        returning id, card_uid as "cardUid", full_name as "fullName", contact_number as "contactNumber",
          'Regular'::text as type, balance, status, created_at as "createdAt"
      `);
    }

    const inserted = extractRows<UserRow>(insertResult)[0];
    inserted.email = null;
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

    const { hasType } = await detectUsersColumns();
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
    const { hasType } = await detectUsersColumns();
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

    const updates: Array<{ col: string; val: string | number }> = [];
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
        created_at       as "createdAt"
    `);
    const userRow = extractRows<UserRow>(result)[0];

    if (!userRow) {
      res.status(404).json({ error: "User not found" });
      return;
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
    userRow.email = emailRow?.email ?? null;

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

    const deleted = await db.transaction(async (tx) => {
      const [existingUser] = await tx
        .select({ id: usersTable.id, cardUid: usersTable.cardUid })
        .from(usersTable)
        .where(eq(usersTable.id, params.data.id))
        .limit(1);

      if (!existingUser) return false;

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

    res.sendStatus(204);
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
