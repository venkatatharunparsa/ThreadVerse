import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/errors.js";
import { Comment } from "../models/Comment.js";
import { Post } from "../models/Post.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { Vote } from "../models/Vote.js";
import { updateUserKarma, updateCommunityReputation, incrementCommunityContentCount } from "../utils/karma.js";
import { calculateAndUpdateTrustLevel } from "../utils/trustLevel.js";

const createCommentSchema = z.object({
  content: z.string().min(1).max(10000),
  parentCommentId: z.string().nullable().optional(),
});

export const listComments = asyncHandler(async (req: Request, res: Response) => {
  const { postId } = req.params;
  const comments = await Comment.find({ postId })
    .sort({ voteScore: -1, createdAt: 1 })
    .populate("authorId", "username")
    .lean();

  const formatted = comments.map((comment: any) => ({
    ...comment,
    author:
      comment.authorId && typeof comment.authorId === "object"
        ? {
            id: comment.authorId._id?.toString?.(),
            username: comment.authorId.username,
          }
        : undefined,
  }));

  res.json({ comments: formatted });
});

export const createComment = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const body = createCommentSchema.parse(req.body);
    const { postId } = req.params;

    const post = await Post.findById(postId);
    if (!post) throw notFound("Post not found");

    let depth = 0;
    if (body.parentCommentId) {
      const parent = await Comment.findById(body.parentCommentId);
      if (!parent) throw badRequest("Parent comment not found");
      depth = (parent.depth ?? 0) + 1;

      // Prevent duplicate comments: Check if user already commented on this parent in last 30 seconds
      const recentDuplicate = await Comment.findOne({
        parentCommentId: body.parentCommentId,
        authorId: req.user!.id,
        content: body.content,
        createdAt: { $gte: new Date(Date.now() - 30000) }, // Last 30 seconds
      });

      if (recentDuplicate) {
        throw badRequest("You've already posted this comment. Please wait before commenting again.");
      }
    } else {
      // Check for duplicate top-level comments on the post
      const recentDuplicate = await Comment.findOne({
        postId,
        parentCommentId: null,
        authorId: req.user!.id,
        content: body.content,
        createdAt: { $gte: new Date(Date.now() - 30000) },
      });

      if (recentDuplicate) {
        throw badRequest("You've already posted this comment. Please wait before commenting again.");
      }
    }

    const comment = await Comment.create({
      postId,
      parentCommentId: body.parentCommentId,
      authorId: req.user!.id,
      content: body.content,
      depth,
    });

    const populated = await comment.populate("authorId", "username");

    post.commentCount += 1;
    await post.save();

    // Track content creation in community reputation
    if (post.communityId) {
      await incrementCommunityContentCount(req.user!.id, post.communityId, "comment");
    }

    res.status(201).json({
      comment: {
        ...populated.toObject(),
        author: {
          id: req.user!.id,
          username: (populated as any).authorId?.username,
        },
      },
    });
  }
);

export const voteComment = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const value = Number(req.body.value);
    if (![1, -1].includes(value)) throw badRequest("Invalid vote value");

    const comment = await Comment.findById(id);
    if (!comment) throw notFound("Comment not found");

    // Prevent voting on own comment
    if (comment.authorId.toString() === req.user!.id) {
      throw badRequest("You cannot vote on your own comment");
    }

    const existing = await Vote.findOne({
      userId: req.user!.id,
      targetType: "comment",
      targetId: id,
    });

    let delta = value;
    if (existing) {
      if (existing.value === value) {
        delta = -value;
        await existing.deleteOne();
        if (value === 1) comment.upvoteCount -= 1;
        if (value === -1) comment.downvoteCount -= 1;
      } else {
        delta = value * 2;
        if (value === 1) {
          comment.upvoteCount += 1;
          comment.downvoteCount -= 1;
        } else {
          comment.upvoteCount -= 1;
          comment.downvoteCount += 1;
        }
        existing.value = value as 1 | -1;
        await existing.save();
      }
    } else {
      await Vote.create({
        userId: req.user!.id,
        targetType: "comment",
        targetId: id,
        value,
      });
      if (value === 1) comment.upvoteCount += 1;
      if (value === -1) comment.downvoteCount += 1;
    }

    comment.voteScore += delta;
    await comment.save();

    // Update author's karma and trust level
    const authorId = comment.authorId.toString();
    await updateUserKarma(authorId, delta, "comment");
    
    // Get post to find community for reputation update
    const post = await Post.findById(comment.postId, "communityId");
    if (post?.communityId) {
      await updateCommunityReputation(authorId, post.communityId, delta, "comment");
    }
    
    // Recalculate trust level after karma update
    try {
      await calculateAndUpdateTrustLevel(authorId);
    } catch (error) {
      console.error("Error updating trust level:", error);
    }

    res.json({ voteScore: comment.voteScore, upvotes: comment.upvoteCount, downvotes: comment.downvoteCount });
  }
);
