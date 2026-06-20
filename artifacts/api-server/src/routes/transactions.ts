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
  // FIX: Use ListTransactionsQueryParams (not UpdateTransactionParams)
  const params = ListTransactionsQueryParams.safeParse(req.query);
  const search = params.success ? params.data.search : undefined;
  const typeFilter = params.success ? params.data.type : undefined;
  const statusFilter = params.success ? params.data.status : undefined;

  const conditions: any[] = [];
  if (typeFilter) conditions.push(eq(transactionsTable.type, typeFilter));
  if (statusFilter) conditions.push(eq(transactionsTable.status, statusFilter));

  const rows = await db
    .select({
      id: transactionsTable.id,
      timestamp: transactionsTable.timestamp,
      cardUid: transactionsTable.cardUid,
      fullName: sql<string>`COALESCE(${usersTable.fullName}, 'Unknown')`.as("full_name"),
      type: transactionsTable.type,
      amount: transactionsTable.amount,
      status: transactionsTable.status,
    })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(transactionsTable.cardUid, usersTable.cardUid))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactionsTable.timestamp));

  let result = rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
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
        .returning();

      if (status === "Success") {
        if (type === "Top-up") {
          await tx
            .update(usersTable)
            .set({
              balance: sql`CAST(${usersTable.balance} AS NUMERIC) + CAST(${String(amount)} AS NUMERIC)`,
              gcashLoadedTotal: sql`CAST(${usersTable.gcashLoadedTotal} AS NUMERIC) + CAST(${String(amount)} AS NUMERIC)`,
            })
            .where(eq(usersTable.cardUid, cardUid));
        } else if (type === "Fare") {
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
      amount: Number(txResult.amount),
      status: txResult.status,
    });
  } catch (error) {
    console.error("POST Transaction Error:", error);
    res.status(500).json({ error: "Database update failed" });
  }
});

// --- PATCH TRANSACTION ---
router.patch("/transactions/:id", async (req, res): Promise<void> => {
  // FIX: Convert id to number before parsing since Express params are always strings
  const params = UpdateTransactionParams.safeParse({
    id: Number(req.params.id),
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
        .where(eq(transactionsTable.id, params.data.id));
      if (!oldTx) throw new Error("TX_NOT_FOUND");

      const updateData: Record<string, any> = {};
      if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
      if (parsed.data.amount !== undefined) updateData.amount = String(parsed.data.amount);
      if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

      const [newTx] = await tx
        .update(transactionsTable)
        .set(updateData)
        .where(eq(transactionsTable.id, params.data.id))
        .returning();

      // 1. Reverse OLD effect
      if (oldTx.status === "Success") {
        if (oldTx.type === "Fare") {
          await tx.update(usersTable)
            .set({ balance: sql`CAST(${usersTable.balance} AS NUMERIC) + CAST(${oldTx.amount} AS NUMERIC)` })
            .where(eq(usersTable.cardUid, oldTx.cardUid));
        } else if (oldTx.type === "Top-up") {
          await tx.update(usersTable)
            .set({
              balance: sql`CAST(${usersTable.balance} AS NUMERIC) - CAST(${oldTx.amount} AS NUMERIC)`,
              gcashLoadedTotal: sql`CAST(${usersTable.gcashLoadedTotal} AS NUMERIC) - CAST(${oldTx.amount} AS NUMERIC)`,
            })
            .where(eq(usersTable.cardUid, oldTx.cardUid));
        }
      }

      // 2. Apply NEW effect
      if (newTx.status === "Success") {
        if (newTx.type === "Fare") {
          await tx.update(usersTable)
            .set({ balance: sql`CAST(${usersTable.balance} AS NUMERIC) - CAST(${newTx.amount} AS NUMERIC)` })
            .where(eq(usersTable.cardUid, newTx.cardUid));
        } else if (newTx.type === "Top-up") {
          await tx.update(usersTable)
            .set({
              balance: sql`CAST(${usersTable.balance} AS NUMERIC) + CAST(${newTx.amount} AS NUMERIC)`,
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
  // FIX: Same id coercion fix as PATCH
  const params = DeleteTransactionParams.safeParse({
    id: Number(req.params.id),
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
        .where(eq(transactionsTable.id, params.data.id));
      if (!txToDelete) return false;

      if (txToDelete.status === "Success") {
        if (txToDelete.type === "Fare") {
          await tx.update(usersTable)
            .set({ balance: sql`CAST(${usersTable.balance} AS NUMERIC) + CAST(${txToDelete.amount} AS NUMERIC)` })
            .where(eq(usersTable.cardUid, txToDelete.cardUid));
        } else if (txToDelete.type === "Top-up") {
          await tx.update(usersTable)
            .set({
              balance: sql`CAST(${usersTable.balance} AS NUMERIC) - CAST(${txToDelete.amount} AS NUMERIC)`,
              gcashLoadedTotal: sql`CAST(${usersTable.gcashLoadedTotal} AS NUMERIC) - CAST(${txToDelete.amount} AS NUMERIC)`,
            })
            .where(eq(usersTable.cardUid, txToDelete.cardUid));
        }
      }

      await tx
        .delete(transactionsTable)
        .where(eq(transactionsTable.id, params.data.id));
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