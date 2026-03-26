import { Router } from "express";
import { createErrorReport, listErrorReports, getErrorReport, addAnswer, voteAnswer, acceptAnswer } from "../controllers/errorController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// List and create reports
router.get("/errors", listErrorReports);
router.post("/errors", requireAuth, createErrorReport);

// Report detail
router.get("/errors/:id", getErrorReport);

// Answers
router.post("/errors/:id/answers", requireAuth, addAnswer);
router.post("/errors/answers/:answerId/vote", requireAuth, voteAnswer);
router.post("/errors/:id/answers/:answerId/accept", requireAuth, acceptAnswer);

export default router;
