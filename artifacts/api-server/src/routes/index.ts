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
import activeRouteRouter from "./activeRoute";
import publicRoutesRouter from "./publicRoutes";
import auditRouter from "./audit";
import adminPermissionsRouter from "./admin-permissions";
import { blockWritesForViewOnly } from "../middleware/permission-middleware";

const router: IRouter = Router();

// 0. VIEW-ONLY GUARD — must be mounted BEFORE any router that defines
//    /admin/* paths (authRouter has /admin/staff, /admin/users/unlink-card).
//    GET/HEAD/OPTIONS pass through untouched so view_only staff can still
//    read everything; POST/PATCH/PUT/DELETE get a 403 with code VIEW_ONLY.
router.use("/admin", blockWritesForViewOnly);

// 1. Public Routes (No Login Required)
router.use(healthRouter);
router.use(authRouter);
router.use(activeRouteRouter); // ← bago ang requireAuth
router.use(passwordResetRouter);
router.use(rfidRouter);
router.use(publicRoutesRouter);
router.use(paymongoDashboardRouter);

// 2. Webhook Route (MUST be Public for PayMongo to reach it)
router.use("/webhook", webhookRouter);

// 3. Protected Routes (Login Required)
router.use(requireAuth);
router.use(blockWritesForViewOnly); // ← IDAGDAG ITO — sakop ang lahat ng POST/PATCH/PUT/DELETE
                                     //    sa users/transactions/fareRoutes/dashboard/audit,
                                     //    kahit ano pang path prefix ang gamitin nila
router.use(usersRouter);
router.use(transactionsRouter);
router.use(fareRoutesRouter);
router.use(dashboardRouter);
router.use(auditRouter);
router.use(adminPermissionsRouter);

export default router;