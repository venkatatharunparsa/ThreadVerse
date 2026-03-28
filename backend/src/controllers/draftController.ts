import type { Request, Response } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/errors.js";
import { Draft } from "../models/Draft.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";

const optionalTrimmedString = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z.string().optional()
);

const optionalUrlString = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z.string().url().optional()
);

const saveDraftPostSchema = z.object({
  communityId: optionalTrimmedString,
  postType: z.enum(["text", "link", "image", "poll"]).optional(),
  title: optionalTrimmedString,
  body: optionalTrimmedString,
  linkUrl: optionalUrlString,
  imageUrl: optionalUrlString,
  tags: z.array(z.string()).optional(),
  isSpoiler: z.boolean().optional(),
  isNsfw: z.boolean().optional(),
  isOc: z.boolean().optional(),
  pollOptions: z.array(z.string()).optional(),
});

const saveDraftCommentSchema = z.object({
  postId: z.string(),
  parentCommentId: z.string().optional(),
  content: z.string(),
});

export const saveDraftPost = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = saveDraftPostSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn("[drafts] saveDraftPost validation failed", {
        issues: parsed.error.issues,
        payload: req.body,
      });
      const firstIssue = parsed.error.issues[0];
      const path = firstIssue?.path?.join(".") || "payload";
      throw badRequest(`Invalid draft field: ${path}`);
    }

    const body = parsed.data;
    const userId = req.user!.id;
    const { id } = req.params;
    const normalizedCommunityId = body.communityId && Types.ObjectId.isValid(body.communityId)
      ? body.communityId
      : undefined;

    const poll = body.postType === "poll" && body.pollOptions
      ? {
          options: body.pollOptions.map((text, idx) => ({
            id: `opt_${idx + 1}`,
            text,
          })),
        }
      : undefined;

    let draft;
    if (id && id !== "new") {
      // Update existing draft
      draft = await Draft.findOne({ _id: id, userId, type: "post" });
      if (!draft) throw notFound("Draft not found");

      Object.assign(draft, {
        communityId: normalizedCommunityId,
        postType: body.postType,
        title: body.title,
        body: body.body,
        linkUrl: body.linkUrl,
        imageUrl: body.imageUrl,
        tags: body.tags,
        isSpoiler: body.isSpoiler,
        isNsfw: body.isNsfw,
        isOc: body.isOc,
        poll,
        lastSavedAt: new Date(),
      });

      await draft.save();
    } else {
      // Create new draft
      draft = await Draft.create({
        userId,
        type: "post",
        communityId: normalizedCommunityId,
        postType: body.postType,
        title: body.title,
        body: body.body,
        linkUrl: body.linkUrl,
        imageUrl: body.imageUrl,
        tags: body.tags ?? [],
        isSpoiler: body.isSpoiler ?? false,
        isNsfw: body.isNsfw ?? false,
        isOc: body.isOc ?? false,
        poll,
        lastSavedAt: new Date(),
      });
    }

    res.json({ draft });
  }
);

export const saveDraftComment = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const body = saveDraftCommentSchema.parse(req.body);
    const userId = req.user!.id;
    const { id } = req.params;

    let draft;
    if (id && id !== "new") {
      // Update existing draft
      draft = await Draft.findOne({ _id: id, userId, type: "comment" });
      if (!draft) throw notFound("Draft not found");

      draft.postId = body.postId as any;
      draft.parentCommentId = body.parentCommentId as any;
      draft.content = body.content;
      draft.lastSavedAt = new Date();

      await draft.save();
    } else {
      // Create new draft
      draft = await Draft.create({
        userId,
        type: "comment",
        postId: body.postId,
        parentCommentId: body.parentCommentId,
        content: body.content,
        lastSavedAt: new Date(),
      });
    }

    res.json({ draft });
  }
);

export const listUserDrafts = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { type } = req.query;

    const filter: any = { userId };
    if (type && ["post", "comment"].includes(type as string)) {
      filter.type = type;
    }

    const drafts = await Draft.find(filter)
      .populate("communityId", "name")
      .populate("postId", "title")
      .sort({ lastSavedAt: -1 })
      .limit(50)
      .lean();

    res.json({ drafts });
  }
);

export const getDraft = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const draft = await Draft.findOne({ _id: id, userId })
      .populate("communityId", "name")
      .populate("postId", "title")
      .lean();

    if (!draft) throw notFound("Draft not found");

    res.json({ draft });
  }
);

export const deleteDraft = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const draft = await Draft.findOne({ _id: id, userId });
    if (!draft) throw notFound("Draft not found");

    await draft.deleteOne();

    res.json({ success: true });
  }
);

export const deleteOldDrafts = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const daysOld = Number(req.query.daysOld) || 30;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Draft.deleteMany({
      userId,
      lastSavedAt: { $lt: cutoffDate },
    });

    res.json({ 
      success: true, 
      deletedCount: result.deletedCount 
    });
  }
);
