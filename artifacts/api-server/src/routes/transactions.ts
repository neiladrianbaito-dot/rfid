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
      amount: transactionsTable.amount,
      // ✅ dagdag — para makita na ng UI ang breakdown nang hindi
      // na kailangan ng hiwalay na query
      feeAmount: transactionsTable.feeAmount,
      vatAmount: transactionsTable.vatAmount,
      netAmount: transactionsTable.netAmount,
      status: transactionsTable.status,
      payment_method: transactionsTable.payment_method,
      route_id: transactionsTable.routeId,
    })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(transactionsTable.cardUid, usersTable.cardUid))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactionsTable.timestamp));

  let result = rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    feeAmount: r.feeAmount !== null ? Number(r.feeAmount) : null,
    vatAmount: r.vatAmount !== null ? Number(r.vatAmount) : null,
    netAmount: r.netAmount !== null ? Number(r.netAmount) : null,
  }));

  if (search) {
    const s = search.toLowerCase();
    result = result.filter(
      (r) =>
        r.cardUid.toLowerCase().includes(s) ||
        r.fullName.toLowerCase().includes(s),
    );
  }

  res.json(ListTransactionsResponse.parse(result));
});

// --- POST TRANSACTION ---
// ✅ FIXED: this route now ONLY inserts the row. It used to also
// manually add/subtract `amount` (the GROSS amount) from
// usersTable.balance right here — that ran on top of the DB's
// own trg_handle_topup_balance_update AFTER INSERT trigger,
// which credits net_amount. Result: every top-up was credited
// TWICE (once gross by Express, once net by the trigger), which
// is why balances looked inflated/wrong compared to what the
// history table showed.
//
// The DB triggers (compute_topup_fees + handle_topup_balance_update)
// are now the ONLY place balance math happens. Express just reads
// back the row (with fees) that the DB computed.
router.post("/transactions", async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { cardUid, type, amount, status } = parsed.data;

  try {
    const [newTx] = await db
      .insert(transactionsTable)
      .values({
        cardUid,
        type,
        amount: String(amount),
        status,
      })
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

    // No manual balance update here anymore — trg_compute_topup_fees
    // (BEFORE INSERT) and trg_handle_topup_balance_update (AFTER
    // INSERT) already handled fee computation and crediting inside
    // the same INSERT statement, atomically.

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.cardUid, cardUid));

    res.status(201).json({
      id: newTx.id,
      timestamp: newTx.timestamp,
      cardUid: newTx.cardUid,
      fullName: user?.fullName || "Unknown",
      type: newTx.type,
      amount: Number(newTx.amount),
      feeAmount: newTx.feeAmount !== null ? Number(newTx.feeAmount) : null,
      vatAmount: newTx.vatAmount !== null ? Number(newTx.vatAmount) : null,
      netAmount: newTx.netAmount !== null ? Number(newTx.netAmount) : null,
      status: newTx.status,
    });
  } catch (error) {
    console.error("POST Transaction Error:", error);
    res.status(500).json({ error: "Database update failed" });
  }
});

// --- PATCH TRANSACTION ---
// ✅ FIXED: no more manual "reverse OLD effect / apply NEW effect"
// balance math here. That logic used gross `amount` too, so an
// edited top-up would double-count against the trigger-based
// system the same way POST did. Balance reversal + reapplication
// on UPDATE is now handled entirely by
// trg_handle_transaction_update_reversal (see fix_transactions_triggers.sql)
// using net_amount, which the BEFORE UPDATE fee trigger recomputes
// in the same statement.
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
    const updateData: Record<string, any> = {};
    if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
    if (parsed.data.amount !== undefined) updateData.amount = String(parsed.data.amount);
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

    const [updated] = await db
      .update(transactionsTable)
      .set(updateData)
      .where(eq(transactionsTable.id, sql`${params.data.id}::bigint`))
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
      });

    if (!updated) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.cardUid, updated.cardUid));

    res.json(
      UpdateTransactionResponse.parse({
        id: updated.id,
        timestamp: updated.timestamp,
        cardUid: updated.cardUid,
        fullName: user?.fullName || "Unknown",
        type: updated.type,
        amount: Number(updated.amount),
        status: updated.status,
      }),
    );
  } catch (error) {
    console.error("PATCH Transaction Error:", error);
    res.status(500).json({ error: "Update failed" });
  }
});

// --- DELETE TRANSACTION ---
// ✅ FIXED: no more manual balance reversal here — that used gross
// `amount` too, duplicating trg_handle_transaction_delete_reversal
// (which correctly reverses net_amount for top-ups). Express now
// just deletes; the DB handles reversal atomically via the trigger.
router.delete("/transactions/:id", async (req, res): Promise<void> => {
  const params = DeleteTransactionParams.safeParse({
    id: req.params.id,
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const [deleted] = await db
      .delete(transactionsTable)
      .where(eq(transactionsTable.id, sql`${params.data.id}::bigint`))
      .returning({ id: transactionsTable.id });

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