import { Router, type IRouter } from "express";
import { eq, ne } from "drizzle-orm";
import { db, fareRoutesTable } from "@workspace/db";
import {
  ListRoutesResponse,
  CreateRouteBody,
  UpdateRouteParams,
  UpdateRouteBody,
  UpdateRouteResponse,
  DeleteRouteParams,
  ToggleRouteParams,
  ToggleRouteResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function formatRoute(r: typeof fareRoutesTable.$inferSelect) {
  return {
    ...r,
    fareAmount: Number(r.fareAmount),
  };
}

router.get("/routes", async (_req, res): Promise<void> => {
  const routes = await db.select().from(fareRoutesTable);
  res.json(ListRoutesResponse.parse(routes.map(formatRoute)));
});

router.post("/routes", async (req, res): Promise<void> => {
  const parsed = CreateRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [route] = await db
    .insert(fareRoutesTable)
    .values({
      origin: parsed.data.origin,
      destination: parsed.data.destination,
      fareAmount: String(parsed.data.fareAmount),
      isActive: true,
    })
    .returning();

  res.status(201).json(formatRoute(route));
});

// Public endpoint — no auth required
router.get("/routes/active", async (_req, res): Promise<void> => {
  const routes = await db.select().from(fareRoutesTable)
    .where(eq(fareRoutesTable.isActive, true));
  res.json(routes.map(formatRoute));
});

router.patch("/routes/:id", async (req, res): Promise<void> => {
  const params = UpdateRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, any> = {};
  if (parsed.data.origin !== undefined) updateData.origin = parsed.data.origin;
  if (parsed.data.destination !== undefined) updateData.destination = parsed.data.destination;
  if (parsed.data.fareAmount !== undefined) updateData.fareAmount = String(parsed.data.fareAmount);
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

  const [route] = await db
    .update(fareRoutesTable)
    .set(updateData)
    .where(eq(fareRoutesTable.id, params.data.id))
    .returning();

  if (!route) {
    res.status(404).json({ error: "Route not found" });
    return;
  }

  res.json(UpdateRouteResponse.parse(formatRoute(route)));
});

router.delete("/routes/:id", async (req, res): Promise<void> => {
  const params = DeleteRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [route] = await db
    .delete(fareRoutesTable)
    .where(eq(fareRoutesTable.id, params.data.id))
    .returning();

  if (!route) {
    res.status(404).json({ error: "Route not found" });
    return;
  }

  res.sendStatus(204);
});

router.patch("/routes/:id/toggle", async (req, res): Promise<void> => {
  const params = ToggleRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(fareRoutesTable)
    .where(eq(fareRoutesTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Route not found" });
    return;
  }

  const willBeActive = !existing.isActive;

  if (willBeActive) {
    await db
      .update(fareRoutesTable)
      .set({ isActive: false })
      .where(ne(fareRoutesTable.id, params.data.id));
  }

  const [route] = await db
    .update(fareRoutesTable)
    .set({ isActive: willBeActive })
    .where(eq(fareRoutesTable.id, params.data.id))
    .returning();

  res.json(ToggleRouteResponse.parse(formatRoute(route)));
});

export default router;
