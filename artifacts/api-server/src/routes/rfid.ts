import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, transactionsTable, fareRoutesTable } from "@workspace/db";

const router: IRouter = Router();

const DISCOUNTED_USER_TYPES = new Set(["STUDENT", "PWD", "SENIOR", "SENIOR CITIZEN"]);
const STUDENT_PWD_SENIOR_DISCOUNT = 0.20;

function getFareBreakdown(baseFareValue: unknown, userType: unknown) {
  const regularFare = Math.round((Number(baseFareValue) + Number.EPSILON) * 100) / 100;
  const normalizedType = String(userType ?? "").trim().toUpperCase();
  const discountRate = DISCOUNTED_USER_TYPES.has(normalizedType) ? STUDENT_PWD_SENIOR_DISCOUNT : 0;
  const discountAmount = Math.round((regularFare * discountRate + Number.EPSILON) * 100) / 100;
  const chargedFare = Math.max(0, Math.round((regularFare - discountAmount + Number.EPSILON) * 100) / 100);
  return { regularFare, discountRate, discountAmount, chargedFare };
}

router.post("/scan-rfid", async (req, res): Promise<void> => {
  const { cardUid } = req.body;

  if (!cardUid) {
    res.status(400).json({ error: "cardUid is required", code: "MISSING_CARD_UID" });
    return;
  }

  const [activeRoute] = await db
    .select()
    .from(fareRoutesTable)
    .where(eq(fareRoutesTable.isActive, true))
    .limit(1);

  if (!activeRoute) {
    res.status(503).json({ error: "No active route configured", code: "NO_ACTIVE_ROUTE" });
    return;
  }

  const regularFare = Number(activeRoute.fareAmount);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.cardUid, String(cardUid)));

  if (!user) {
    res.status(404).json({ error: "Card not registered", code: "CARD_NOT_FOUND" });
    return;
  }

  if (user.status !== "Active") {
    res.status(403).json({ error: "Card is not active", code: "CARD_INACTIVE" });
    return;
  }

  const fareBreakdown = getFareBreakdown(regularFare, user.type);
  const fareAmount = fareBreakdown.chargedFare;
  const cardBalance = Number(user.balance);
  const gcashBalance = Number(user.gcashLoadedTotal);
  const totalBalance = cardBalance + gcashBalance;

  if (totalBalance < fareAmount) {
    res.status(403).json({
      error: "Insufficient balance",
      code: "INSUFFICIENT_BALANCE",
      totalBalance,
      cardBalance,
      gcashBalance,
      required: fareAmount,
      shortage: fareAmount - totalBalance,
    });
    return;
  }

  let newCardBalance: number;
  let newGcashBalance: number;

  if (cardBalance >= fareAmount) {
    newCardBalance = cardBalance - fareAmount;
    newGcashBalance = gcashBalance;
  } else {
    const remainder = fareAmount - cardBalance;
    newCardBalance = 0;
    newGcashBalance = gcashBalance - remainder;
  }

  const [updatedUser] = await db
    .update(usersTable)
    .set({
      balance: String(newCardBalance),
      gcashLoadedTotal: String(newGcashBalance),
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  const [transaction] = await db
    .insert(transactionsTable)
    .values({
      cardUid: user.cardUid,
      type: "Fare",
      amount: String(fareAmount),
      status: "Success",
    })
    .returning();

  res.status(200).json({
    success: true,
    message: `Fare of ₱${fareAmount.toFixed(2)} deducted successfully${fareBreakdown.discountRate ? ` (20% discount applied; regular fare ₱${fareBreakdown.regularFare.toFixed(2)})` : ""}`,
    user: {
      id: updatedUser.id,
      cardUid: updatedUser.cardUid,
      fullName: updatedUser.fullName,
      previousTotalBalance: totalBalance,
      newTotalBalance: newCardBalance + newGcashBalance,
      newCardBalance,
      newGcashBalance,
    },
    route: {
      id: activeRoute.id,
      origin: activeRoute.origin,
      destination: activeRoute.destination,
      fareAmount,
      regularFare: fareBreakdown.regularFare,
      discountPercent: fareBreakdown.discountRate * 100,
      discountAmount: fareBreakdown.discountAmount,
    },
    transaction: {
      id: transaction.id,
      type: transaction.type,
      amount: Number(transaction.amount),
      status: transaction.status,
      timestamp: transaction.timestamp,
    },
  });
});

router.post("/tap", async (req, res): Promise<void> => {
  const { cardUid, routeId } = req.body;

  if (!cardUid || !routeId) {
    res.status(400).json({ error: "cardUid and routeId are required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.cardUid, String(cardUid)));

  if (!user) {
    res.status(404).json({ error: "Card not registered", code: "CARD_NOT_FOUND" });
    return;
  }

  if (user.status !== "Active") {
    res.status(403).json({ error: "Card is not active", code: "CARD_INACTIVE" });
    return;
  }

  const [route] = await db
    .select()
    .from(fareRoutesTable)
    .where(eq(fareRoutesTable.id, Number(routeId)));

  if (!route || !route.isActive) {
    res.status(404).json({ error: "Route not found or inactive", code: "ROUTE_INACTIVE" });
    return;
  }

  const fareBreakdown = getFareBreakdown(route.fareAmount, user.type);
  const fareAmount = fareBreakdown.chargedFare;
  const cardBalance = Number(user.balance);
  const gcashBalance = Number(user.gcashLoadedTotal);
  const totalBalance = cardBalance + gcashBalance;

  if (totalBalance < fareAmount) {
    res.status(403).json({
      error: "Insufficient balance",
      code: "INSUFFICIENT_BALANCE",
      totalBalance,
      required: fareAmount,
    });
    return;
  }

  let newCardBalance: number;
  let newGcashBalance: number;
  if (cardBalance >= fareAmount) {
    newCardBalance = cardBalance - fareAmount;
    newGcashBalance = gcashBalance;
  } else {
    newCardBalance = 0;
    newGcashBalance = gcashBalance - (fareAmount - cardBalance);
  }

  const [updatedUser] = await db
    .update(usersTable)
    .set({ balance: String(newCardBalance), gcashLoadedTotal: String(newGcashBalance) })
    .where(eq(usersTable.id, user.id))
    .returning();

  const [transaction] = await db
    .insert(transactionsTable)
    .values({ cardUid: user.cardUid, type: "Fare", amount: String(fareAmount), status: "Success" })
    .returning();

  res.json({
    success: true,
    user: {
      id: updatedUser.id,
      cardUid: updatedUser.cardUid,
      fullName: updatedUser.fullName,
      newTotalBalance: newCardBalance + newGcashBalance,
    },
    route: {
      id: route.id,
      origin: route.origin,
      destination: route.destination,
      fareAmount,
      regularFare: fareBreakdown.regularFare,
      discountPercent: fareBreakdown.discountRate * 100,
      discountAmount: fareBreakdown.discountAmount,
    },
    transaction: { id: transaction.id, type: transaction.type, amount: Number(transaction.amount), status: transaction.status, timestamp: transaction.timestamp },
  });
});

router.get("/active-routes", async (_req, res): Promise<void> => {
  const routes = await db
    .select()
    .from(fareRoutesTable)
    .where(eq(fareRoutesTable.isActive, true));

  res.json(
    routes.map((r) => ({
      id: r.id,
      origin: r.origin,
      destination: r.destination,
      fareAmount: Number(r.fareAmount),
    })),
  );
});

export default router;

