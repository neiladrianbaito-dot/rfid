import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
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

    // 🔧 FIX: u.id was never selected here, so the dashboard never knew this
    // user's numeric primary key. Anything downstream that needed to query
    // by the real users.id (like card_balance_transfers, which references
    // source_card_id/target_card_id → users.id) silently failed because
    // user.id was always undefined on the frontend.
    const userResult = await db.execute(sql`
      select
        u.id              as "id",
        u.card_uid        as "cardUid",
        u.full_name       as "fullName",
        u.contact_number  as "contactNumber",
        u.type,
        u.status,
        u.balance,
        u.expiration_date as "expirationDate",
        a.email           as "email"
      from users u
      left join auth_users a on a.linked_card_uid = u.card_uid
      where u.card_uid = ${cardUid}
      limit 1
    `);

    type UserRow = {
      id: number;
      cardUid: string;
      fullName: string;
      contactNumber: string;
      type: string;
      balance: string;
      status: string;
      email: string | null;
      expirationDate: string | null;
    };

    const user = extractRows<UserRow>(userResult)[0];

    if (!user) {
      res.status(404).json({ error: "Card UID not found" });
      return;
    }

    // 🔧 FIX: switched from the Drizzle `.select().from(transactionsTable)`
    // query to explicit raw SQL so fee_amount / vat_amount / net_amount are
    // guaranteed to come back even if the Drizzle schema object for
    // transactionsTable doesn't declare those columns. This is what the
    // user dashboard's Top-up Fee/VAT/Net columns and receipt modal need —
    // without this, the frontend was trying (and failing, due to RLS) to
    // fetch those fields directly from Supabase on its own.
    type TxRow = {
      id: number;
      timestamp: string;
      cardUid: string;
      type: string;
      amount: string;
      status: string;
      routeId: number | null;
      paymentMethod: string | null;
      feeAmount: string | null;
      vatAmount: string | null;
      netAmount: string | null;
    };

    const txResult = await db.execute(sql`
      select
        t.id,
        t.timestamp,
        t.card_uid       as "cardUid",
        t.type,
        t.amount,
        t.status,
        t.route_id       as "routeId",
        t.payment_method as "paymentMethod",
        t.fee_amount     as "feeAmount",
        t.vat_amount     as "vatAmount",
        t.net_amount     as "netAmount"
      from transactions t
      where t.card_uid = ${cardUid}
      order by t.timestamp desc
      limit 100
    `);

    const txRows = extractRows<TxRow>(txResult);

    // 🆕 Fetch card_balance_transfers where this user's card is either the
    // source or the target, joining `users` twice to pull each side's
    // card_uid + full_name — same shape the admin Transactions page uses.
    // This runs through the backend (which already has access), so it
    // doesn't depend on Supabase RLS letting the anon/user client read the
    // table directly.
    type TransferRow = {
      id: number;
      sourceCardId: number;
      targetCardId: number;
      amount: string;
      reason: string | null;
      sourceBalanceBefore: string | null;
      targetBalanceBefore: string | null;
      status: string;
      createdAt: string;
      completedAt: string | null;
      sourceCardUid: string | null;
      sourceFullName: string | null;
      targetCardUid: string | null;
      targetFullName: string | null;
    };

    const transferResult = await db.execute(sql`
      select
        ct.id,
        ct.source_card_id        as "sourceCardId",
        ct.target_card_id        as "targetCardId",
        ct.amount,
        ct.reason,
        ct.source_balance_before as "sourceBalanceBefore",
        ct.target_balance_before as "targetBalanceBefore",
        ct.status,
        ct.created_at            as "createdAt",
        ct.completed_at          as "completedAt",
        su.card_uid              as "sourceCardUid",
        su.full_name             as "sourceFullName",
        tu.card_uid              as "targetCardUid",
        tu.full_name             as "targetFullName"
      from card_balance_transfers ct
      left join users su on su.id = ct.source_card_id
      left join users tu on tu.id = ct.target_card_id
      where ct.source_card_id = ${user.id} or ct.target_card_id = ${user.id}
      order by ct.created_at desc
      limit 100
    `);

    const transferRows = extractRows<TransferRow>(transferResult);

    res.json({
      user: {
        id:             user.id, // 🔧 FIX: now included in the response
        cardUid:        user.cardUid,
        fullName:       user.fullName,
        contactNumber:  user.contactNumber,
        email:          user.email ?? null,
        type:           user.type ?? "Regular",
        balance:        Number(user.balance ?? 0),
        status:         user.status ?? "Inactive",
        expirationDate: user.expirationDate ?? null,
      },
      transactions: txRows.map((tx) => ({
        id:             tx.id,
        timestamp:      tx.timestamp,
        cardUid:        tx.cardUid,
        type:           tx.type,
        amount:         Number(tx.amount ?? 0),
        status:         tx.status,
        route_id:       tx.routeId ?? null,
        payment_method: tx.paymentMethod ?? null,
        // 🆕 Fee / VAT / Net amount — now included so the frontend can
        // render the Top-up breakdown without a separate direct Supabase
        // query (which was silently failing due to RLS).
        fee_amount:     tx.feeAmount != null ? Number(tx.feeAmount) : null,
        vat_amount:     tx.vatAmount != null ? Number(tx.vatAmount) : null,
        net_amount:     tx.netAmount != null ? Number(tx.netAmount) : null,
      })),
      // 🆕 Shaped to match what the frontend's CardTransfer type expects:
      // nested `source` / `target` objects with card_uid + full_name.
      transfers: transferRows.map((t) => ({
        id: t.id,
        source_card_id: t.sourceCardId,
        target_card_id: t.targetCardId,
        amount: Number(t.amount ?? 0),
        reason: t.reason,
        source_balance_before: t.sourceBalanceBefore != null ? Number(t.sourceBalanceBefore) : null,
        target_balance_before: t.targetBalanceBefore != null ? Number(t.targetBalanceBefore) : null,
        status: t.status,
        created_at: t.createdAt,
        completed_at: t.completedAt,
        source: { card_uid: t.sourceCardUid, full_name: t.sourceFullName },
        target: { card_uid: t.targetCardUid, full_name: t.targetFullName },
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