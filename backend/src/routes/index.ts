import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import communityRouter from "./community.js";
import postsRouter from "./posts.js";
import commentsRouter from "./comments.js";
import usersRouter from "./users.js";
import notificationsRouter from "./notifications.js";
import uploadRouter from "./upload.js";
import draftsRouter from "./drafts.js";
import analyticsRouter from "./analytics.js";
import trustRouter from "./trust.js";
import errorsRouter from "./errors.js";

const router = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/communities", communityRouter);
router.use("/posts", postsRouter);
router.use("/comments", commentsRouter);
router.use("/users", usersRouter);
router.use("/notifications", notificationsRouter);
router.use("/upload", uploadRouter);
router.use("/drafts", draftsRouter);
router.use("/analytics", analyticsRouter);
router.use("/trust", trustRouter);
router.use(errorsRouter);

export default router;
