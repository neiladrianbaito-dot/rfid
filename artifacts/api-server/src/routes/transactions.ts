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

/* =========================================================
   GET /transactions
   ========================================================= */

router.get("/transactions", async (req, res) => {
  try {
    const parsed = ListTransactionsQueryParams.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid query parameters",
        errors: parsed.error.flatten(),
      });
    }

    const { search, type, status } = parsed.data;

    const conditions = [];

    // Exact type filter when supplied
    if (type) {
      conditions.push(eq(transactionsTable.type, type));
    }

    // Exact status filter when supplied
    if (status) {
      conditions.push(eq(transactionsTable.status, status));
    }

    const rows = await db
      .select({
        // IMPORTANT:
        // Keep ID as number because the generated API type expects number.
        id: transactionsTable.id,

        timestamp: transactionsTable.timestamp,
        cardUid: transactionsTable.cardUid,

        fullName: sql<string>`
          COALESCE(${usersTable.fullName}, 'Unknown')
        `.as("full_name"),

        type: transactionsTable.type,
        amount: transactionsTable.amount,
        status: transactionsTable.status,

        // Route / payment information
        payment_method: transactionsTable.payment_method,
        route_id: transactionsTable.routeId,

        // =====================================================
        // TOP-UP FINANCIAL BREAKDOWN
        // =====================================================
        fee_amount: transactionsTable.fee_amount,
        vat_amount: transactionsTable.vat_amount,
        net_amount: transactionsTable.net_amount,
      })
      .from(transactionsTable)
      .leftJoin(
        usersTable,
        eq(transactionsTable.cardUid, usersTable.cardUid),
      )
      .where(
        conditions.length > 0
          ? and(...conditions)
          : undefined,
      )
      .orderBy(desc(transactionsTable.timestamp));

    /*
     * Convert numeric/decimal values to JavaScript numbers.
     *
     * Drizzle/PostgreSQL numeric columns may be returned as strings.
     * The frontend expects numbers.
     */
    let result = rows.map((row) => ({
      id: row.id,

      timestamp: row.timestamp,

      cardUid: row.cardUid,

      fullName: row.fullName,

      type: row.type,

      amount: Number(row.amount),

      status: row.status,

      payment_method: row.payment_method ?? null,

      route_id:
        row.route_id === null || row.route_id === undefined
          ? null
          : Number(row.route_id),

      fee_amount:
        row.fee_amount === null || row.fee_amount === undefined
          ? null
          : Number(row.fee_amount),

      vat_amount:
        row.vat_amount === null || row.vat_amount === undefined
          ? null
          : Number(row.vat_amount),

      net_amount:
        row.net_amount === null || row.net_amount === undefined
          ? null
          : Number(row.net_amount),
    }));

    /*
     * Search is performed here so card UID and full name
     * can both be searched.
     */
    if (search) {
      const searchValue = search.toLowerCase().trim();

      result = result.filter((row) => {
        const cardUid = row.cardUid?.toLowerCase() ?? "";
        const fullName = row.fullName?.toLowerCase() ?? "";

        return (
          cardUid.includes(searchValue) ||
          fullName.includes(searchValue)
        );
      });
    }

    /*
     * Validate final response against API schema.
     */
    const response = ListTransactionsResponse.parse(result);

    return res.json(response);
  } catch (error) {
    console.error("GET /transactions error:", error);

    return res.status(500).json({
      message: "Failed to fetch transactions",
    });
  }
});

/* =========================================================
   POST /transactions
   ========================================================= */

router.post("/transactions", async (req, res) => {
  try {
    const parsed = CreateTransactionBody.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid transaction data",
        errors: parsed.error.flatten(),
      });
    }

    const data = parsed.data;

    const result = await db.transaction(async (tx) => {
      /*
       * Insert transaction.
       *
       * payment_method, route_id, fee_amount, vat_amount,
       * and net_amount are included when they are supplied
       * by the request schema.
       */
      const inserted = await tx
        .insert(transactionsTable)
        .values({
          cardUid: data.cardUid,
          type: data.type,
          amount: String(data.amount),
          status: data.status,

          /*
           * These properties are intentionally conditionally
           * assigned so this remains compatible if the current
           * CreateTransactionBody does not yet expose them.
           */
          ...(data as any).payment_method !== undefined
            ? {
                payment_method:
                  (data as any).payment_method ?? null,
              }
            : {},

          ...(data as any).route_id !== undefined
            ? {
                routeId:
                  (data as any).route_id ?? null,
              }
            : {},

          ...(data as any).fee_amount !== undefined
            ? {
                fee_amount:
                  (data as any).fee_amount ?? null,
              }
            : {},

          ...(data as any).vat_amount !== undefined
            ? {
                vat_amount:
                  (data as any).vat_amount ?? null,
              }
            : {},

          ...(data as any).net_amount !== undefined
            ? {
                net_amount:
                  (data as any).net_amount ?? null,
              }
            : {},
        })
        .returning({
          id: transactionsTable.id,
          timestamp: transactionsTable.timestamp,
          cardUid: transactionsTable.cardUid,
          type: transactionsTable.type,
          amount: transactionsTable.amount,
          status: transactionsTable.status,
          payment_method: transactionsTable.payment_method,
          route_id: transactionsTable.routeId,
          fee_amount: transactionsTable.fee_amount,
          vat_amount: transactionsTable.vat_amount,
          net_amount: transactionsTable.net_amount,
        });

      const newTx = inserted[0];

      if (!newTx) {
        throw new Error("TRANSACTION_INSERT_FAILED");
      }

      /*
       * Find user connected to RFID card.
       */
      const userResult = await tx
        .select({
          id: usersTable.id,
          cardUid: usersTable.cardUid,
          fullName: usersTable.fullName,
          balance: usersTable.balance,
          gcashLoadedTotal: usersTable.gcashLoadedTotal,
        })
        .from(usersTable)
        .where(eq(usersTable.cardUid, data.cardUid))
        .limit(1);

      const user = userResult[0];

      /*
       * Update wallet balance.
       *
       * Top-up:
       *   balance += amount
       *   gcash_loaded_total += amount
       *
       * Fare:
       *   balance -= amount
       *
       * Only successful transactions affect balance.
       */
      if (user && data.status === "Success") {
        const amount = String(data.amount);

        if (data.type.toLowerCase() === "top-up") {
          await tx
            .update(usersTable)
            .set({
              balance: sql`
                COALESCE(${usersTable.balance}, 0)
                + ${amount}
              `,
              gcashLoadedTotal: sql`
                COALESCE(${usersTable.gcashLoadedTotal}, 0)
                + ${amount}
              `,
            })
            .where(eq(usersTable.id, user.id));
        }

        if (data.type.toLowerCase() === "fare") {
          await tx
            .update(usersTable)
            .set({
              balance: sql`
                COALESCE(${usersTable.balance}, 0)
                - ${amount}
              `,
            })
            .where(eq(usersTable.id, user.id));
        }
      }

      /*
       * Fetch updated user information.
       */
      const updatedUserResult = await tx
        .select({
          id: usersTable.id,
          cardUid: usersTable.cardUid,
          fullName: usersTable.fullName,
        })
        .from(usersTable)
        .where(eq(usersTable.cardUid, newTx.cardUid))
        .limit(1);

      const updatedUser = updatedUserResult[0];

      return {
        id: newTx.id,
        timestamp: newTx.timestamp,
        cardUid: newTx.cardUid,
        fullName: updatedUser?.fullName ?? "Unknown",
        type: newTx.type,
        amount: Number(newTx.amount),
        status: newTx.status,

        payment_method:
          newTx.payment_method ?? null,

        route_id:
          newTx.route_id === null ||
          newTx.route_id === undefined
            ? null
            : Number(newTx.route_id),

        fee_amount:
          newTx.fee_amount === null ||
          newTx.fee_amount === undefined
            ? null
            : Number(newTx.fee_amount),

        vat_amount:
          newTx.vat_amount === null ||
          newTx.vat_amount === undefined
            ? null
            : Number(newTx.vat_amount),

        net_amount:
          newTx.net_amount === null ||
          newTx.net_amount === undefined
            ? null
            : Number(newTx.net_amount),
      };
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error("POST /transactions error:", error);

    return res.status(500).json({
      message: "Failed to create transaction",
    });
  }
});

/* =========================================================
   PATCH /transactions/:id
   ========================================================= */

router.patch("/transactions/:id", async (req, res) => {
  try {
    const parsedParams =
      UpdateTransactionParams.safeParse(req.params);

    if (!parsedParams.success) {
      return res.status(400).json({
        message: "Invalid transaction ID",
        errors: parsedParams.error.flatten(),
      });
    }

    const parsedBody =
      UpdateTransactionBody.safeParse(req.body);

    if (!parsedBody.success) {
      return res.status(400).json({
        message: "Invalid transaction update",
        errors: parsedBody.error.flatten(),
      });
    }

    const params = parsedParams.data;
    const data = parsedBody.data;

    if (
      data.type === undefined &&
      data.amount === undefined &&
      data.status === undefined
    ) {
      return res.status(400).json({
        message:
          "At least one of type, amount, or status is required",
      });
    }

    if (
      data.amount !== undefined &&
      !Number.isFinite(Number(data.amount))
    ) {
      return res.status(400).json({
        message: "Amount must be a valid number",
      });
    }

    const transactionId = Number(params.id);

    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      return res.status(400).json({
        message: "Transaction ID must be a valid positive integer",
      });
    }

    const result = await db.transaction(async (tx) => {
      /*
       * Get old transaction.
       */
      const oldResult = await tx
        .select({
          id: transactionsTable.id,
          timestamp: transactionsTable.timestamp,
          cardUid: transactionsTable.cardUid,
          type: transactionsTable.type,
          amount: transactionsTable.amount,
          status: transactionsTable.status,
          payment_method: transactionsTable.payment_method,
          route_id: transactionsTable.routeId,
          fee_amount: transactionsTable.fee_amount,
          vat_amount: transactionsTable.vat_amount,
          net_amount: transactionsTable.net_amount,
        })
        .from(transactionsTable)
        .where(eq(transactionsTable.id, transactionId))
        .limit(1);

      const oldTx = oldResult[0];

      if (!oldTx) {
        throw new Error("TX_NOT_FOUND");
      }

      /*
       * Build update.
       */
      const updateData: any = {};

      if (data.type !== undefined) {
        updateData.type = data.type;
      }

      if (data.amount !== undefined) {
        updateData.amount = String(data.amount);
      }

      if (data.status !== undefined) {
        updateData.status = data.status;
      }

      /*
       * Update transaction.
       */
      const updatedResult = await tx
        .update(transactionsTable)
        .set(updateData)
        .where(eq(transactionsTable.id, transactionId))
        .returning({
          id: transactionsTable.id,
          timestamp: transactionsTable.timestamp,
          cardUid: transactionsTable.cardUid,
          type: transactionsTable.type,
          amount: transactionsTable.amount,
          status: transactionsTable.status,
          payment_method: transactionsTable.payment_method,
          route_id: transactionsTable.routeId,
          fee_amount: transactionsTable.fee_amount,
          vat_amount: transactionsTable.vat_amount,
          net_amount: transactionsTable.net_amount,
        });

      const newTx = updatedResult[0];

      if (!newTx) {
        throw new Error("TRANSACTION_UPDATE_FAILED");
      }

      /*
       * Find card owner.
       */
      const userResult = await tx
        .select({
          id: usersTable.id,
          cardUid: usersTable.cardUid,
          fullName: usersTable.fullName,
        })
        .from(usersTable)
        .where(eq(usersTable.cardUid, oldTx.cardUid))
        .limit(1);

      const user = userResult[0];

      if (user) {
        /*
         * ================================================
         * REVERSE OLD SUCCESSFUL TRANSACTION
         * ================================================
         */
        if (oldTx.status === "Success") {
          const oldAmount = String(oldTx.amount);

          if (oldTx.type.toLowerCase() === "fare") {
            await tx
              .update(usersTable)
              .set({
                balance: sql`
                  COALESCE(${usersTable.balance}, 0)
                  + ${oldAmount}
                `,
              })
              .where(eq(usersTable.id, user.id));
          }

          if (oldTx.type.toLowerCase() === "top-up") {
            await tx
              .update(usersTable)
              .set({
                balance: sql`
                  COALESCE(${usersTable.balance}, 0)
                  - ${oldAmount}
                `,
                gcashLoadedTotal: sql`
                  COALESCE(${usersTable.gcashLoadedTotal}, 0)
                  - ${oldAmount}
                `,
              })
              .where(eq(usersTable.id, user.id));
          }
        }

        /*
         * ================================================
         * APPLY NEW SUCCESSFUL TRANSACTION
         * ================================================
         */
        if (newTx.status === "Success") {
          const newAmount = String(newTx.amount);

          if (newTx.type.toLowerCase() === "fare") {
            await tx
              .update(usersTable)
              .set({
                balance: sql`
                  COALESCE(${usersTable.balance}, 0)
                  - ${newAmount}
                `,
              })
              .where(eq(usersTable.id, user.id));
          }

          if (newTx.type.toLowerCase() === "top-up") {
            await tx
              .update(usersTable)
              .set({
                balance: sql`
                  COALESCE(${usersTable.balance}, 0)
                  + ${newAmount}
                `,
                gcashLoadedTotal: sql`
                  COALESCE(${usersTable.gcashLoadedTotal}, 0)
                  + ${newAmount}
                `,
              })
              .where(eq(usersTable.id, user.id));
          }
        }
      }

      return {
        id: newTx.id,
        timestamp: newTx.timestamp,
        cardUid: newTx.cardUid,
        fullName: user?.fullName ?? "Unknown",
        type: newTx.type,
        amount: Number(newTx.amount),
        status: newTx.status,

        payment_method:
          newTx.payment_method ?? null,

        route_id:
          newTx.route_id === null ||
          newTx.route_id === undefined
            ? null
            : Number(newTx.route_id),

        fee_amount:
          newTx.fee_amount === null ||
          newTx.fee_amount === undefined
            ? null
            : Number(newTx.fee_amount),

        vat_amount:
          newTx.vat_amount === null ||
          newTx.vat_amount === undefined
            ? null
            : Number(newTx.vat_amount),

        net_amount:
          newTx.net_amount === null ||
          newTx.net_amount === undefined
            ? null
            : Number(newTx.net_amount),
      };
    });

    const response = UpdateTransactionResponse.parse(result);

    return res.json(response);
  } catch (error: any) {
    if (error?.message === "TX_NOT_FOUND") {
      return res.status(404).json({
        message: "Transaction not found",
      });
    }

    console.error("PATCH /transactions/:id error:", error);

    return res.status(500).json({
      message: "Failed to update transaction",
    });
  }
});

/* =========================================================
   DELETE /transactions/:id
   ========================================================= */

router.delete("/transactions/:id", async (req, res) => {
  try {
    const parsedParams =
      DeleteTransactionParams.safeParse(req.params);

    if (!parsedParams.success) {
      return res.status(400).json({
        message: "Invalid transaction ID",
        errors: parsedParams.error.flatten(),
      });
    }

    const params = parsedParams.data;

    const transactionId = Number(params.id);

    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      return res.status(400).json({
        message: "Transaction ID must be a valid positive integer",
      });
    }

    await db.transaction(async (tx) => {
      /*
       * Find transaction before deleting.
       */
      const result = await tx
        .select({
          id: transactionsTable.id,
          cardUid: transactionsTable.cardUid,
          type: transactionsTable.type,
          amount: transactionsTable.amount,
          status: transactionsTable.status,
        })
        .from(transactionsTable)
        .where(eq(transactionsTable.id, transactionId))
        .limit(1);

      const transaction = result[0];

      if (!transaction) {
        throw new Error("TX_NOT_FOUND");
      }

      /*
       * Reverse successful transaction before deletion.
       */
      if (transaction.status === "Success") {
        const userResult = await tx
          .select({
            id: usersTable.id,
          })
          .from(usersTable)
          .where(eq(usersTable.cardUid, transaction.cardUid))
          .limit(1);

        const user = userResult[0];

        if (user) {
          const amount = String(transaction.amount);

          if (
            transaction.type.toLowerCase() === "fare"
          ) {
            /*
             * Deleted fare:
             * restore the deducted balance.
             */
            await tx
              .update(usersTable)
              .set({
                balance: sql`
                  COALESCE(${usersTable.balance}, 0)
                  + ${amount}
                `,
              })
              .where(eq(usersTable.id, user.id));
          }

          if (
            transaction.type.toLowerCase() === "top-up"
          ) {
            /*
             * Deleted top-up:
             * remove its balance contribution and
             * remove it from GCash loaded total.
             */
            await tx
              .update(usersTable)
              .set({
                balance: sql`
                  COALESCE(${usersTable.balance}, 0)
                  - ${amount}
                `,
                gcashLoadedTotal: sql`
                  COALESCE(${usersTable.gcashLoadedTotal}, 0)
                  - ${amount}
                `,
              })
              .where(eq(usersTable.id, user.id));
          }
        }
      }

      /*
       * Delete transaction.
       */
      await tx
        .delete(transactionsTable)
        .where(eq(transactionsTable.id, transactionId));
    });

    return res.status(204).send();
  } catch (error: any) {
    if (error?.message === "TX_NOT_FOUND") {
      return res.status(404).json({
        message: "Transaction not found",
      });
    }

    console.error("DELETE /transactions/:id error:", error);

    return res.status(500).json({
      message: "Failed to delete transaction",
    });
  }
});

export default router;