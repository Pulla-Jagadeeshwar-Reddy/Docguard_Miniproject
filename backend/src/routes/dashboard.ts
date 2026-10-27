import { Router } from "express";
import { pgPool } from "../config/databases.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requirePermission("DASHBOARD_READ"));

router.get("/", async (request, response, next) => {
  try {
    const user = request.user!;
    const [statuses, expiring, activity] = await Promise.all([
      pgPool.query(
        `SELECT document_status AS status, document_count AS count
         FROM v_document_status_summary ORDER BY document_status`
      ),
      pgPool.query(
        `SELECT e.document_id AS id, e.title, e.category_name AS category,
                e.version_number AS "versionNumber", e.expiry_date AS "expiryDate",
                e.days_remaining AS "daysRemaining"
         FROM v_expiring_soon AS e
         WHERE $2::boolean OR e.document_id IN (
           SELECT document_id FROM fn_accessible_document_ids($1)
         )
         ORDER BY e.expiry_date, e.title
         LIMIT 8`,
        [user.id, user.role === "Admin"]
      ),
      user.role === "Admin"
        ? pgPool.query(
          `SELECT activity_date AS date, action, event_count AS count,
                  break_glass_count AS "breakGlassCount"
           FROM v_access_activity
           WHERE activity_date >= CURRENT_DATE - 13
           ORDER BY activity_date, action`
        )
        : pgPool.query(
          `SELECT accessed_at::date AS date, action,
                  count(*)::integer AS count,
                  count(*) FILTER (WHERE is_break_glass)::integer AS "breakGlassCount"
           FROM access_logs
           WHERE user_id = $1 AND accessed_at >= CURRENT_DATE - 13
           GROUP BY accessed_at::date, action
           ORDER BY accessed_at::date, action`,
          [user.id]
        )
    ]);
    response.json({
      documentStatuses: statuses.rows,
      expiringSoon: expiring.rows,
      accessActivity: activity.rows
    });
  } catch (error) { next(error); }
});

export { router as dashboardRouter };
