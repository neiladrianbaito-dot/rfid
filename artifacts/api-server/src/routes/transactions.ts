import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, transactionsTable, usersTable } from "@workspace/db";
import {
  ListTransactionsQueryParams,
  ListTransactionsResponse,
  CreateTransactionBody,
  UpdateTransactionParams,
  UpdateTransactionBody,
  UpdateTransactionResponse,
  DeleteTransactionParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// --- GET TRANSACTIONS ---
router.get("/transactions", async (req, res): Promise<void> => {
  const params = ListTransactionsQueryParams.safeParse(req.query);
  const search = params.success ? params.data.search : undefined;
  const typeFilter = params.success ? params.data.type : undefined;
  const statusFilter = params.success ? params.data.status : undefined;

  const conditions: any[] = [];
  if (typeFilter) conditions.push(eq(transactionsTable.type, typeFilter));
  if (statusFilter) conditions.push(eq(transactionsTable.status, statusFilter));

  const rows = await db
    .select({
      id: sql<string>`${transactionsTable.id}::text`.as("id"),
      timestamp: transactionsTable.timestamp,
      cardUid: transactionsTable.cardUid,
      fullName: sql<string>`COALESCE(${usersTable.fullName}, 'Unknown')`.as("full_name"),
      type: transactionsTable.type,
      amount: transactionsTable.amount,          // gross (what was paid)
      feeAmount: transactionsTable.feeAmount,     // NOTE: adjust field name to match your schema
      vatAmount: transactionsTable.vatAmount,     // NOTE: adjust field name to match your schema
      netAmount: transactionsTable.netAmount,     // NOTE: adjust field name to match your schema
      status: transactionsTable.status,
      payment_method: transactionsTable.payment_method,
      route_id: transactionsTable.routeId,
    })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(transactionsTable.cardUid, usersTable.cardUid))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactionsTable.timestamp));

  let result = rows.map((r) => {
    const gross = Number(r.amount);
    const net = r.netAmount !== null && r.netAmount !== undefined
      ? Number(r.netAmount)
      : null;

    return {
      ...r,
      amount:
        // FIX: show net_amount (what actually hit the balance) for Top-up rows.
        // Other types (Fare, Transfer, etc.) don't go through the fee/vat
        // pipeline, so they keep showing the raw amount.
        r.type === "Top-up" && net !== null ? net : gross,
      grossAmount: gross,
      feeAmount: r.feeAmount !== null && r.feeAmount !== undefined ? Number(r.feeAmount) : 0,
      vatAmount: r.vatAmount !== null && r.vatAmount !== undefined ? Number(r.vatAmount) : 0,
      netAmount: net,
    };
  });

  if (search) {
    const s = search.toLowerCase();
    result = result.filter(
      (r) =>
        r.cardUid.toLowerCase().includes(s) ||
        r.fullName.toLowerCase().includes(s),
    );
  }

  // NOTE: ListTransactionsResponse (zod schema in @workspace/api-zod) needs to
  // allow the extra fields (grossAmount, feeAmount, vatAmount, netAmount) or
  // this .parse() call will strip/reject them. Update that schema too.
  res.json(ListTransactionsResponse.parse(result));
});

// --- POST TRANSACTION ---
router.post("/transactions", async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { cardUid, type, amount, status } = parsed.data;

  try {
    const txResult = await db.transaction(async (tx) => {
      const [newTx] = await tx
        .insert(transactionsTable)
        .values({
          cardUid,
          type,
          amount: String(amount),
          status,
        })
        // The BEFORE INSERT trigger (compute_topup_fees) fills in
        // fee_amount / vat_amount / net_amount before this row lands,
        // so we can read them straight back here.
        .returning({
          id: sql<string>`${transactionsTable.id}::text`,
          timestamp: transactionsTable.timestamp,
          cardUid: transactionsTable.cardUid,
          type: transactionsTable.type,
          amount: transactionsTable.amount,
          feeAmount: transactionsTable.feeAmount,
          vatAmount: transactionsTable.vatAmount,
          netAmount: transactionsTable.netAmount,
          status: transactionsTable.status,
          payment_method: transactionsTable.payment_method,
        });

      // FIX: removed the manual `balance = balance + amount` update here.
      // The AFTER INSERT trigger (trg_handle_topup_balance_update) already
      // credits `net_amount` to the user's balance. Doing it again here
      // was double-crediting the account on every successful top-up.
      //
      // gcashLoadedTotal is a separate lifetime-total metric (gross amount
      // paid), not the wallet balance, so it's fine — actually necessary —
      // to keep updating it manually here.
      if (status === "Success") {
        if (type === "Top-up") {
          await tx
            .update(usersTable)
            .set({
              gcashLoadedTotal: sql`CAST(${usersTable.gcashLoadedTotal} AS NUMERIC) + CAST(${String(amount)} AS NUMERIC)`,
            })
            .where(eq(usersTable.cardUid, cardUid));
        } else if (type === "Fare") {
          // Fare has no fee/vat pipeline — balance is debited by the raw amount.
          await tx
            .update(usersTable)
            .set({
              balance: sql`CAST(${usersTable.balance} AS NUMERIC) - CAST(${String(amount)} AS NUMERIC)`,
            })
            .where(eq(usersTable.cardUid, cardUid));
        }
      }
      return newTx;
    });

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.cardUid, cardUid));

    res.status(201).json({
      id: txResult.id,
      timestamp: txResult.timestamp,
      cardUid: txResult.cardUid,
      fullName: user?.fullName || "Unknown",
      type: txResult.type,
      amount:
        txResult.type === "Top-up" && txResult.netAmount != null
          ? Number(txResult.netAmount)
          : Number(txResult.amount),
      grossAmount: Number(txResult.amount),
      feeAmount: txResult.feeAmount != null ? Number(txResult.feeAmount) : 0,
      vatAmount: txResult.vatAmount != null ? Number(txResult.vatAmount) : 0,
      netAmount: txResult.netAmount != null ? Number(txResult.netAmount) : null,
      status: txResult.status,
    });
  } catch (error) {
    console.error("POST Transaction Error:", error);
    res.status(500).json({ error: "Database update failed" });
  }
});

// --- PATCH TRANSACTION ---
router.patch("/transactions/:id", async (req, res): Promise<void> => {
  const params = UpdateTransactionParams.safeParse({
    id: req.params.id,
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (
    parsed.data.type === undefined &&
    parsed.data.amount === undefined &&
    parsed.data.status === undefined
  ) {
    res.status(400).json({ error: "No updatable fields provided" });
    return;
  }
  if (parsed.data.amount !== undefined && !Number.isFinite(parsed.data.amount)) {
    res.status(400).json({ error: "Amount must be a valid number" });
    return;
  }

  try {
    const patchResult = await db.transaction(async (tx) => {
      const [oldTx] = await tx
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.id, sql`${params.data.id}::bigint`));
      if (!oldTx) throw new Error("TX_NOT_FOUND");

      const updateData: Record<string, any> = {};
      if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
      if (parsed.data.amount !== undefined) updateData.amount = String(parsed.data.amount);
      if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

      // NOTE: if `amount` changes here, fee/vat/net on the OLD row won't
      // auto-recompute (the compute_topup_fees trigger only runs BEFORE
      // INSERT, not BEFORE UPDATE). If edits to top-up amounts need to be
      // supported, add a BEFORE UPDATE trigger too, or recompute manually
      // below. For now this assumes type/status is what typically changes.

      const [newTx] = await tx
        .update(transactionsTable)
        .set(updateData)
        .where(eq(transactionsTable.id, sql`${params.data.id}::bigint`))
        .returning({
          id: sql<string>`${transactionsTable.id}::text`,
          timestamp: transactionsTable.timestamp,
          cardUid: transactionsTable.cardUid,
          type: transactionsTable.type,
          amount: transactionsTable.amount,
          netAmount: transactionsTable.netAmount,
          status: transactionsTable.status,
        });

      // FIX: reverse/reapply using net_amount for Top-up rows, since that's
      // what actually hit the balance (via the insert trigger) — not the
      // gross amount. Fare keeps using amount since it has no fee/vat step.
      const oldEffect = (t: typeof oldTx) =>
        t.type === "Top-up"
          ? (t.netAmount != null ? Number(t.netAmount) : Number(t.amount))
          : Number(t.amount);
      const newEffect = (t: typeof newTx) =>
        t.type === "Top-up"
          ? (t.netAmount != null ? Number(t.netAmount) : Number(t.amount))
          : Number(t.amount);

      // 1. Reverse OLD effect
      if (oldTx.status === "Success") {
        if (oldTx.type === "Fare") {
          await tx.update(usersTable)
            .set({ balance: sql`CAST(${usersTable.balance} AS NUMERIC) + ${oldEffect(oldTx)}` })
            .where(eq(usersTable.cardUid, oldTx.cardUid));
        } else if (oldTx.type === "Top-up") {
          await tx.update(usersTable)
            .set({
              balance: sql`CAST(${usersTable.balance} AS NUMERIC) - ${oldEffect(oldTx)}`,
              gcashLoadedTotal: sql`CAST(${usersTable.gcashLoadedTotal} AS NUMERIC) - CAST(${oldTx.amount} AS NUMERIC)`,
            })
            .where(eq(usersTable.cardUid, oldTx.cardUid));
        }
      }

      // 2. Apply NEW effect
      if (newTx.status === "Success") {
        if (newTx.type === "Fare") {
          await tx.update(usersTable)
            .set({ balance: sql`CAST(${usersTable.balance} AS NUMERIC) - ${newEffect(newTx)}` })
            .where(eq(usersTable.cardUid, newTx.cardUid));
        } else if (newTx.type === "Top-up") {
          await tx.update(usersTable)
            .set({
              balance: sql`CAST(${usersTable.balance} AS NUMERIC) + ${newEffect(newTx)}`,
              gcashLoadedTotal: sql`CAST(${usersTable.gcashLoadedTotal} AS NUMERIC) + CAST(${newTx.amount} AS NUMERIC)`,
            })
            .where(eq(usersTable.cardUid, newTx.cardUid));
        }
      }
      return newTx;
    });

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.cardUid, patchResult.cardUid));

    res.json(
      UpdateTransactionResponse.parse({
        id: patchResult.id,
        timestamp: patchResult.timestamp,
        cardUid: patchResult.cardUid,
        fullName: user?.fullName || "Unknown",
        type: patchResult.type,
        amount: Number(patchResult.amount),
        status: patchResult.status,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "TX_NOT_FOUND") {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    console.error("PATCH Transaction Error:", error);
    res.status(500).json({ error: "Update failed" });
  }
});

// --- DELETE TRANSACTION ---
router.delete("/transactions/:id", async (req, res): Promise<void> => {
  const params = DeleteTransactionParams.safeParse({
    id: req.params.id,
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const deleted = await db.transaction(async (tx) => {
      const [txToDelete] = await tx
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.id, sql`${params.data.id}::bigint`));
      if (!txToDelete) return false;

      // FIX: use net_amount for Top-up reversal, same reasoning as PATCH.
      const effect =
        txToDelete.type === "Top-up"
          ? (txToDelete.netAmount != null ? Number(txToDelete.netAmount) : Number(txToDelete.amount))
          : Number(txToDelete.amount);

      if (txToDelete.status === "Success") {
        if (txToDelete.type === "Fare") {
          await tx.update(usersTable)
            .set({ balance: sql`CAST(${usersTable.balance} AS NUMERIC) + ${effect}` })
            .where(eq(usersTable.cardUid, txToDelete.cardUid));
        } else if (txToDelete.type === "Top-up") {
          await tx.update(usersTable)
            .set({
              balance: sql`CAST(${usersTable.balance} AS NUMERIC) - ${effect}`,
              gcashLoadedTotal: sql`CAST(${usersTable.gcashLoadedTotal} AS NUMERIC) - CAST(${txToDelete.amount} AS NUMERIC)`,
            })
            .where(eq(usersTable.cardUid, txToDelete.cardUid));
        }
      }

      await tx
        .delete(transactionsTable)
        .where(eq(transactionsTable.id, sql`${params.data.id}::bigint`));
      return true;
    });

    if (!deleted) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    res.sendStatus(204);
  } catch (error) {
    console.error("DELETE Transaction Error:", error);
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;