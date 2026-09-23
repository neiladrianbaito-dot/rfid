import { Router, type IRouter } from "express";
import { requireAdmin } from "../middleware/permission-middleware";
import { requirePermission } from "../middleware/permission-middleware"; // after merging the addition
import { logAudit } from "../lib/audit-logger";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────
// WHY THESE EXIST
//
// Excel export (xlsx-js-style) and PDF export (window.print()) both build
// the file entirely in the BROWSER — there is no Express route that
// actually produces the file, so requirePermission() has nowhere to sit.
// Same for disbursement: the real trigger is a Supabase Edge Function
// (create-disbursement), not this Express app.
//
// These three routes are lightweight "may I?" checkpoints. The frontend
// calls one of them FIRST; if it returns 200, the button proceeds with the
// client-side generation / edge function call. If it returns 403, nothing
// happens client-side. This gives you a real backend permission check even
// though the actual work happens outside Express.
// ─────────────────────────────────────────────────────────────────────────

router.post(
  "/admin/reports/authorize/excel",
  requireAdmin,
  requirePermission("reports.download.excel"),
  (req, res) => {
    logAudit({
      user: req.adminUser!.username,
      action: "READ",
      entity: "Report",
      details: `${req.adminUser!.username} authorized to export transaction logs as Excel`,
    });
    res.json({ success: true });
  }
);

router.post(
  "/admin/reports/authorize/pdf",
  requireAdmin,
  requirePermission("reports.download.pdf"),
  (req, res) => {
    logAudit({
      user: req.adminUser!.username,
      action: "READ",
      entity: "Report",
      details: `${req.adminUser!.username} authorized to print/save revenue report as PDF`,
    });
    res.json({ success: true });
  }
);

router.post(
  "/admin/disbursement/authorize",
  requireAdmin,
  requirePermission("disbursement.trigger"),
  (req, res) => {
    // No audit log here — the actual disbursement attempt is already
    // logged (success or failure) by DisbursementPage.tsx / your Edge
    // Function once it goes through. Logging here too would double it up.
    res.json({ success: true });
  }
);

export default router;