import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import transactionsRouter from "./transactions";
import fareRoutesRouter from "./fareRoutes";
import dashboardRouter from "./dashboard";
import rfidRouter from "./rfid";
import webhookRouter from "./webhook";
import paymongoDashboardRouter from "./paymongoDashboard";
import passwordResetRouter from "./password-reset.router";
import { requireAuth } from "../middleware/require-auth";
import activeRouteRouter from "./activeRoute"; // ← add import
import publicRoutesRouter from "./publicRoutes"; // ← dagdag

const router: IRouter = Router();

// 1. Public Routes (No Login Required)
router.use(healthRouter);
router.use(authRouter);
router.use(activeRouteRouter);  // ← add dito, bago ang requireAuth
router.use(passwordResetRouter);
router.use(rfidRouter);
router.use(publicRoutesRouter);
router.use(paymongoDashboardRouter);

// 2. Webhook Route (MUST be Public for PayMongo to reach it)
router.use("/webhook", webhookRouter);

// 3. Protected Routes (Login Required)
router.use(requireAuth);
router.use(usersRouter);
router.use(transactionsRouter);
router.use(fareRoutesRouter);
router.use(dashboardRouter);

export default router;