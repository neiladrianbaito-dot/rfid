import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";
import { verifyUserToken } from "../lib/user-token";

const router: IRouter = Router();

function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

router.get("/paymongo/dashboard", async (req, res): Promise<void> => {
  try {
    const token = getBearerToken(req.headers.authorization);
    const sessionUser = token ? verifyUserToken(token) : null;

    if (!sessionUser) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const rawCardUid = typeof req.query.cardUid === "string" ? req.query.cardUid : "";
    const cardUid = rawCardUid.trim();

    if (!cardUid) {
      res.status(400).json({ error: "cardUid is required" });
      return;
    }

    const userResult = await db.execute(sql`
      select
        u.card_uid       as "cardUid",
        u.full_name      as "fullName",
        u.contact_number as "contactNumber",
        u.type,
        u.status,
        u.balance,
        a.email          as "email"
      from users u
      left join auth_users a on a.linked_card_uid = u.card_uid
      where u.card_uid = ${cardUid}
      limit 1
    `);

    type UserRow = {
      cardUid: string;
      fullName: string;
      contactNumber: string;
      type: string;
      balance: string;
      status: string;
      email: string | null;
    };

    const user = extractRows<UserRow>(userResult)[0];

    if (!user) {
      res.status(404).json({ error: "Card UID not found" });
      return;
    }

    const txRows = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.cardUid, cardUid))
      .orderBy(desc(transactionsTable.timestamp))
      .limit(100);

    res.json({
      user: {
        cardUid:       user.cardUid,
        fullName:      user.fullName,
        contactNumber: user.contactNumber,
        email:         user.email ?? null,
        type:          user.type ?? "Regular",
        balance:       Number(user.balance ?? 0),
        status:        user.status ?? "Inactive",
      },
      transactions: txRows.map((tx) => ({
        id:        tx.id,
        timestamp: tx.timestamp,
        cardUid:   tx.cardUid,
        type:      tx.type,
        amount:    Number(tx.amount ?? 0),
        status:    tx.status,
        route_id:  tx.routeId ?? tx.route_id ?? null, // ✅ idagdag ito
      })),
    });

  } catch (err) {
    console.error("[dashboard] Error:", err);
    res.status(500).json({
      error:  err instanceof Error ? err.message : String(err),
      detail: err instanceof Error ? err.stack  : undefined,
    });
  }
});

export default router;
