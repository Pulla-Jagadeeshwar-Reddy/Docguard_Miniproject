import { Router } from "express";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();
const notificationIdSchema = z.coerce.number().int().positive();

router.use(requireAuth, requirePermission("NOTIFICATION_READ"));

router.get("/", async (request, response, next) => {
  const parsedLimit = z.coerce.number().int().min(1).max(50).safeParse(request.query.limit ?? 10);
  if (!parsedLimit.success) {
    response.status(400).json({ error: "Invalid limit" });
    return;
  }

  try {
    const userId = request.user!.id;
    const [items, unread] = await Promise.all([
      pgPool.query(
        `SELECT n.notification_id AS id, n.document_id AS "documentId",
                d.title AS "documentTitle", n.notification_type AS type,
                n.message, n.is_read AS "isRead", n.created_at AS "createdAt"
         FROM notifications AS n
         LEFT JOIN documents AS d ON d.document_id = n.document_id
         WHERE n.user_id = $1
         ORDER BY n.created_at DESC, n.notification_id DESC
         LIMIT $2`,
        [userId, parsedLimit.data]
      ),
      pgPool.query(
        "SELECT count(*)::integer AS count FROM notifications WHERE user_id = $1 AND is_read = false",
        [userId]
      )
    ]);
    response.json({ notifications: items.rows, unreadCount: unread.rows[0].count });
  } catch (error) { next(error); }
});

router.patch("/read-all", async (request, response, next) => {
  try {
    const result = await pgPool.query(
      `UPDATE notifications SET is_read = true
       WHERE user_id = $1 AND is_read = false`,
      [request.user!.id]
    );
    response.json({ updated: result.rowCount ?? 0 });
  } catch (error) { next(error); }
});

router.patch("/:id/read", async (request, response, next) => {
  const parsedId = notificationIdSchema.safeParse(request.params.id);
  if (!parsedId.success) {
    response.status(400).json({ error: "Invalid notification id" });
    return;
  }
  try {
    const result = await pgPool.query(
      `UPDATE notifications SET is_read = true
       WHERE notification_id = $1 AND user_id = $2
       RETURNING notification_id AS id, is_read AS "isRead"`,
      [parsedId.data, request.user!.id]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Notification not found" });
      return;
    }
    response.json({ notification: result.rows[0] });
  } catch (error) { next(error); }
});

export { router as notificationsRouter };
