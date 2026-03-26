import express from "express";
import {
  getTrustLevel,
  getMyTrustLevel,
  recalculateTrustLevel,
  recalculateAllTrustLevels,
  getTrustLevelBreakdown,
  getTrustLeaderboard,
  getUsersByTrustLevel,
  getTrustStatistics,
} from "../controllers/trustController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Protected routes (must be before /:userId because they're more specific)
router.get("/", requireAuth, getMyTrustLevel);
router.post("/recalculate/:userId", requireAuth, recalculateTrustLevel);
router.post("/admin/recalculate-all", requireAuth, recalculateAllTrustLevels);

// Public routes (more specific ones first)
router.get("/leaderboard", getTrustLeaderboard);
router.get("/statistics", getTrustStatistics);
router.get("/level/:level", getUsersByTrustLevel);
router.get("/:userId/breakdown", getTrustLevelBreakdown);
router.get("/:userId", getTrustLevel);

export default router;
