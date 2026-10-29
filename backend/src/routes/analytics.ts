import { Router } from "express";
import { mongoClient, pgPool } from "../config/databases.js";
import { env } from "../config/env.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("Admin"));

router.get("/keywords", async (_request, response, next) => {
  try {
    const versions = await pgPool.query(
      `SELECT v.version_id
       FROM documents d JOIN document_versions v ON v.version_id = d.current_version_id
       WHERE d.document_status = 'active' AND v.version_status = 'approved'
         AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)`
    );
    if (!versions.rowCount) {
      response.json({ topKeywords: [], categories: [], longestDocuments: [] });
      return;
    }
    await mongoClient.connect();
    const [result] = await mongoClient.db(env.mongoDb).collection("document_contents").aggregate([
      { $match: { versionId: { $in: versions.rows.map(row => row.version_id) } } },
      { $facet: {
        topKeywords: [
          { $unwind: "$extracted.keywords" },
          { $group: { _id: { category: "$category", keyword: "$extracted.keywords" }, count: { $sum: 1 } } },
          { $sort: { count: -1, "_id.category": 1, "_id.keyword": 1 } },
          { $limit: 12 }
        ],
        categories: [
          { $group: { _id: "$category", policyCount: { $sum: 1 }, pages: { $sum: { $ifNull: ["$pageCount", 0] } }, words: { $sum: { $ifNull: ["$extracted.wordCount", 0] } } } },
          { $sort: { policyCount: -1, _id: 1 } }
        ],
        longestDocuments: [
          { $project: { title: 1, fileName: 1, category: 1, pageCount: 1, wordCount: "$extracted.wordCount" } },
          { $sort: { wordCount: -1, pageCount: -1, fileName: 1 } },
          { $limit: 5 }
        ]
      } }
    ]).toArray();
    response.json(result ?? { topKeywords: [], categories: [], longestDocuments: [] });
  } catch (error) { next(error); }
});

export { router as analyticsRouter };
