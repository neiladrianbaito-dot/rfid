import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, fareRoutesTable } from "@workspace/db";

const router: IRouter = Router();

function formatRoute(r: typeof fareRoutesTable.$inferSelect) {
  return {
    ...r,
    fareAmount: Number(r.fareAmount),
  };
}

// Public — no auth required
router.get("/routes/active", async (_req, res): Promise<void> => {
  const routes = await db
    .select()
    .from(fareRoutesTable)
    .where(eq(fareRoutesTable.isActive, true))
    .orderBy(asc(fareRoutesTable.fareAmount));
  res.json(routes.map(formatRoute));
});

export default router;