import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, fareRoutesTable } from "@workspace/db";

const router: IRouter = Router();

function formatRoute(r: typeof fareRoutesTable.$inferSelect) {
  return {
    ...r,
    fareAmount: Number(r.fareAmount),
  };
}

// Public — all routes (for transaction modal matching)
router.get("/routes/all", async (_req, res): Promise<void> => {
  const routes = await db
    .select()
    .from(fareRoutesTable)
    .orderBy(asc(fareRoutesTable.fareAmount));
  res.json(routes.map(formatRoute));
});

export default router;
