import { Router } from "express";
import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

/**
 * TEST ROUTE (check if webhook is alive)
 */
router.get("/", (req, res) => {
  return res.status(200).send("Webhook is working");
});

/**
 * PAYMONGO WEBHOOK
 */
router.post("/", async (req, res) => {
  try {
    console.log("🔥 WEBHOOK RECEIVED");
    console.log(JSON.stringify(req.body, null, 2));

    // =========================
    // 1. Extract PayMongo data safely
    // =========================
    const event = req.body?.data?.attributes;
    const payment = event?.data?.attributes;

    if (!payment) {
      console.log("❌ No payment data found");
      return res.sendStatus(200);
    }

    // =========================
    // 2. IMPORTANT: DO NOT rely on type = payment.paid
    // PayMongo usually uses event container
    // =========================
    const status = payment?.status;

    console.log("📌 Payment status:", status);

    // Only process successful payments
    if (status !== "paid") {
      return res.sendStatus(200);
    }

    // =========================
    // 3. Extract metadata
    // =========================
    const metadata = payment?.metadata || {};

    const cardUid =
      metadata.card_uid ||
      metadata.cardUid;

    const amountInPesos = payment?.amount
      ? Number(payment.amount) / 100
      : NaN;

    if (!cardUid || isNaN(amountInPesos)) {
      console.log("⚠️ Missing cardUid or amount");
      return res.sendStatus(200);
    }

    console.log(`💳 cardUid: ${cardUid}`);
    console.log(`💰 amount: ${amountInPesos}`);

    // =========================
    // 4. Find user
    // =========================
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.cardUid, cardUid));

    if (!user) {
      console.log(`❌ User not found: ${cardUid}`);
      return res.sendStatus(200);
    }

    // =========================
    // 5. Update balance
    // =========================
    const current = Number(user.gcashLoadedTotal || 0);
    const updated = current + amountInPesos;

    await db
      .update(usersTable)
      .set({
        gcashLoadedTotal: String(updated),
      })
      .where(eq(usersTable.cardUid, cardUid));

    // =========================
    // 6. Save transaction
    // =========================
    await db.insert(transactionsTable).values({
      cardUid,
      type: "Top-up",
      amount: String(amountInPesos),
      status: "Success",
      timestamp: new Date(),
    });

    console.log(`✅ SUCCESS: ₱${amountInPesos} added to ${cardUid}`);
    console.log(`💳 New balance: ₱${updated}`);

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err);
    return res.sendStatus(500);
  }
});

export default router;