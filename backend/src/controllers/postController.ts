import type { Request, Response } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError, badRequest, notFound } from "../utils/errors.js";
import { Post } from "../models/Post.js";
import { Community } from "../models/Community.js";
import { Membership } from "../models/Membership.js";
import { User } from "../models/User.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { Vote } from "../models/Vote.js";
import { updateUserKarma, updateCommunityReputation, incrementCommunityContentCount } from "../utils/karma.js";
import { calculateAndUpdateTrustLevel } from "../utils/trustLevel.js";
import { generatePostDraftWithGroq } from "../utils/groq.js";

const createPostSchema = z.object({
  community: z.string().min(3).optional(),
  title: z.string().min(1).max(300),
  type: z.enum(["text", "link", "image", "poll"]),
  body: z.string().nullable().optional(),
  linkUrl: z.string().url().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  tags: z.array(z.string()).optional(),
  isSpoiler: z.boolean().optional(),
  isNsfw: z.boolean().optional(),
  isOc: z.boolean().optional(),
  pollOptions: z.array(z.string().min(1)).max(4).nullable().optional(),
});

const listPostsSchema = z.object({
  sort: z.enum(["hot", "new", "top", "controversial"]).default("hot"),
  community: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

const autoFillSchema = z.object({
  prompt: z.string().min(3).max(500),
  tone: z.enum(["casual", "professional", "funny", "serious", "excited"]).optional(),
  length: z.enum(["short", "medium", "long"]).optional(),
});

const autoFillResponseSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(5000),
  tags: z.array(z.string().min(1).max(24)).max(6).optional().default([]),
  isSpoiler: z.boolean().optional(),
  isNsfw: z.boolean().optional(),
});

const detectSpoiler = (title: string, body?: string | null): boolean => {
  const keywords = [
    "coming", "dead", "released", "leaked", "spoiler", "ending", 
    "leak", "death", "dies", "outcome", "twist", "reveal"
  ];
  const content = `${title} ${body ?? ""}`.toLowerCase();
  return keywords.some(keyword => content.includes(keyword));
};

const detectNsfw = (title: string, body?: string | null): boolean => {
  const keywords = [
    "nsfw", "18+", "adult", "gore", "violence", "blood", 
    "nude", "naked", "sex", "porn", "explicit"
  ];
  const content = `${title} ${body ?? ""}`.toLowerCase();
  return keywords.some(keyword => content.includes(keyword));
};

const buildLocalAutoFillDraft = (prompt: string, tone: string, length: string) => {
  const cleanPrompt = prompt.trim().replace(/\s+/g, " ");
  const title = (cleanPrompt.length > 70
    ? `${cleanPrompt.slice(0, 67).trim()}...`
    : cleanPrompt || "Post idea").slice(0, 300);

  const lengthHints: Record<string, string> = {
    short: "Keep it concise in 1-2 short paragraphs.",
    medium: "Use 2-3 short paragraphs with one clear key point.",
    long: "Use multiple short paragraphs and include brief bullet points where useful.",
  };

  const body = [
    `I want to share something about: ${cleanPrompt}.`,
    `Tone requested: ${tone}. ${lengthHints[length] ?? lengthHints.medium}`,
    "What do you think? I would love to hear your opinions and suggestions.",
  ].join("\n\n").slice(0, 5000);

  const tags = Array.from(
    new Set(
      cleanPrompt
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 3)
    )
  ).slice(0, 6);

  return {
    title,
    body,
    tags,
    isSpoiler: detectSpoiler(title, body),
    isNsfw: detectNsfw(title, body),
  };
};

export const createPost = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const body = createPostSchema.parse(req.body);
    const userId = req.user!.id;

    let isSpoiler = body.isSpoiler ?? false;
    if (!isSpoiler) {
      isSpoiler = detectSpoiler(body.title, body.body);
    }

    let isNsfw = body.isNsfw ?? false;
    if (!isNsfw) {
      isNsfw = detectNsfw(body.title, body.body);
    }

    let communityId: any = null;
    
    // Community is optional - only validate if provided
    if (body.community) {
      const community = await Community.findOne({ name: body.community });
      if (!community) throw notFound("Community not found");
      if (!community.allowedPostTypes.includes(body.type)) {
        throw badRequest("Post type not allowed in this community");
      }
      
      // Check if user is a member of the community
      const membership = await Membership.findOne({
        userId,
        communityId: community._id,
      });
      
      if (!membership) {
        throw badRequest("You must be a member of this community to post in it");
      }
      
      communityId = community._id;
    }

    const poll = body.type === "poll" && body.pollOptions
      ? {
          options: body.pollOptions.map((text, idx) => ({
            id: `opt_${idx + 1}`,
            text,
            votes: 0,
          })),
        }
      : undefined;

    const post = await Post.create({
      communityId,
      authorId: userId,
      type: body.type,
      title: body.title,
      body: body.body ?? "",
      linkUrl: body.linkUrl ?? null,
      imageUrl: body.imageUrl ?? null,
      tags: body.tags ?? [],
      isSpoiler,
      isNsfw,
      isOc: body.isOc ?? false,
      poll,
    });

    // Track content creation in community reputation
    if (communityId) {
      await incrementCommunityContentCount(userId, communityId, "post");
    }

    // Populate and format response
    await post.populate([
      { path: "authorId", select: "username displayName avatarUrl" },
      { path: "communityId", select: "name" },
    ]);

    const formatted = {
      ...post.toObject(),
      author: (post as any).authorId,
      community: (post as any).communityId,
      authorUsername: (post as any).authorId?.username || "",
      communityName: (post as any).communityId?.name || "",
    };

    res.status(201).json({ post: formatted });
  }
);

export const listPosts = asyncHandler(async (req: Request, res: Response) => {
  const query = listPostsSchema.parse(req.query);
  const filter: any = {};
  if (query.community) {
    const community = await Community.findOne({ name: query.community });
    if (!community) throw notFound("Community not found");
    filter.communityId = community._id;
  }

  let sort: any = { createdAt: -1 };
  if (query.sort === "hot") sort = { voteScore: -1, createdAt: -1 };
  if (query.sort === "top") sort = { voteScore: -1 };
  if (query.sort === "controversial") sort = { commentCount: -1 };

  const posts = await Post.find(filter)
    .populate("authorId", "username displayName avatarUrl")
    .populate("communityId", "name")
    .sort(sort)
    .limit(query.limit)
    .lean();

  const formatted = posts.map((p: any) => ({
    ...p,
    author: p.authorId,
    community: p.communityId,
    authorUsername: p.authorId?.username || "",
    communityName: p.communityId?.name || "",
  }));

  res.json({ posts: formatted });
});

export const getPost = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const post = await Post.findById(id)
    .populate("authorId", "username displayName avatarUrl")
    .populate("communityId", "name")
    .lean();
  if (!post) throw notFound("Post not found");

  const formatted = {
    ...post,
    author: (post as any).authorId,
    community: (post as any).communityId,
    authorUsername: (post as any).authorId?.username || "",
    communityName: (post as any).communityId?.name || "",
  };

  res.json({ post: formatted });
});

export const autoFillPost = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { prompt, tone, length } = autoFillSchema.parse(req.body);
    let aiRaw: unknown;
    try {
      aiRaw = await generatePostDraftWithGroq({ prompt, tone, length });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        console.warn("[groq] using local auto-fill fallback due to 429/quota limit");
        aiRaw = buildLocalAutoFillDraft(prompt, tone ?? "casual", length ?? "medium");
      } else {
        throw error;
      }
    }

    const aiDraft = autoFillResponseSchema.parse(aiRaw);

    const title = aiDraft.title.trim();
    const body = aiDraft.body.trim();
    const tags = (aiDraft.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);

    const detectedSpoiler = detectSpoiler(title, body);
    const detectedNsfw = detectNsfw(title, body);

    res.json({
      draft: {
        type: "text",
        title,
        body,
        tags,
        isSpoiler: aiDraft.isSpoiler ?? detectedSpoiler,
        isNsfw: aiDraft.isNsfw ?? detectedNsfw,
      },
    });
  }
);

export const votePost = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const value = Number(req.body.value);
    if (![1, -1].includes(value)) throw badRequest("Invalid vote value");

    const post = await Post.findById(id);
    if (!post) throw notFound("Post not found");

    // Prevent voting on own post
    if (post.authorId.toString() === req.user!.id) {
      throw badRequest("You cannot vote on your own post");
    }

    const existing = await Vote.findOne({
      userId: req.user!.id,
      targetType: "post",
      targetId: id,
    });

    let delta = value;
    if (existing) {
      if (existing.value === value) {
        // remove vote
        delta = -value;
        await existing.deleteOne();
        if (value === 1) post.upvoteCount -= 1;
        if (value === -1) post.downvoteCount -= 1;
      } else {
        // flip vote
        delta = value * 2; // -1 -> +1 or +1 -> -1
        if (value === 1) {
          post.upvoteCount += 1;
          post.downvoteCount -= 1;
        } else {
          post.upvoteCount -= 1;
          post.downvoteCount += 1;
        }
        existing.value = value as 1 | -1;
        await existing.save();
      }
    } else {
      await Vote.create({
        userId: req.user!.id,
        targetType: "post",
        targetId: id,
        value,
      });
      if (value === 1) post.upvoteCount += 1;
      if (value === -1) post.downvoteCount += 1;
    }

    post.voteScore += delta;
    await post.save();

    // Update author's karma and trust level
    const authorId = post.authorId.toString();
    await updateUserKarma(authorId, delta, "post");
    if (post.communityId) {
      await updateCommunityReputation(
        authorId,
        post.communityId as Types.ObjectId,
        delta,
        "post"
      );
    }
    
    // Recalculate trust level after karma update
    try {
      await calculateAndUpdateTrustLevel(authorId);
    } catch (error) {
      console.error("Error updating trust level:", error);
    }

    res.json({ voteScore: post.voteScore, upvotes: post.upvoteCount, downvotes: post.downvoteCount });
  }
);

const updatePostSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  body: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  isSpoiler: z.boolean().optional(),
  isNsfw: z.boolean().optional(),
  isOc: z.boolean().optional(),
});

export const updatePost = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const body = updatePostSchema.parse(req.body);

    const post = await Post.findById(id);
    if (!post) throw notFound("Post not found");

    // Only author can update
    if (post.authorId.toString() !== req.user!.id) {
      throw badRequest("You can only update your own posts");
    }

    // Update allowed fields
    if (body.title !== undefined) post.title = body.title;
    if (body.body !== undefined) post.body = body.body ?? "";
    if (body.tags !== undefined) post.tags = body.tags;
    if (body.isSpoiler !== undefined) post.isSpoiler = body.isSpoiler;
    if (body.isNsfw !== undefined) post.isNsfw = body.isNsfw;
    if (body.isOc !== undefined) post.isOc = body.isOc;

    // Re-check auto-spoiler if title or body updated and not explicitly set to false
    if ((body.title !== undefined || body.body !== undefined) && body.isSpoiler === undefined) {
      if (!post.isSpoiler) {
        post.isSpoiler = detectSpoiler(post.title, post.body);
      }
    }

    // Re-check auto-nsfw if title or body updated and not explicitly set to false
    if ((body.title !== undefined || body.body !== undefined) && body.isNsfw === undefined) {
      if (!post.isNsfw) {
        post.isNsfw = detectNsfw(post.title, post.body);
      }
    }

    await post.save();

    // Populate and format response
    await post.populate([
      { path: "authorId", select: "username displayName avatarUrl" },
      { path: "communityId", select: "name" },
    ]);

    const formatted = {
      ...post.toObject(),
      author: (post as any).authorId,
      community: (post as any).communityId,
      authorUsername: (post as any).authorId?.username || "",
      communityName: (post as any).communityId?.name || "",
    };

    res.json({ post: formatted });
  }
);

export const deletePost = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const post = await Post.findById(id);
    if (!post) throw notFound("Post not found");

    // Only author can delete
    if (post.authorId.toString() !== req.user!.id) {
      throw badRequest("You can only delete your own posts");
    }

    await post.deleteOne();
    
    // Clean up associated votes
    await Vote.deleteMany({ targetType: "post", targetId: id });

    res.json({ success: true });
  }
);

export const listUserPosts = asyncHandler(
  async (req: Request, res: Response) => {
    const { username } = req.params;
    const query = listPostsSchema.parse(req.query);

    const user = await User.findOne({ username });
    if (!user) throw notFound("User not found");

    let sort: any = { createdAt: -1 };
    if (query.sort === "hot") sort = { voteScore: -1, createdAt: -1 };
    if (query.sort === "top") sort = { voteScore: -1 };
    if (query.sort === "controversial") sort = { commentCount: -1 };

    const posts = await Post.find({ authorId: user._id })
      .populate("authorId", "username displayName avatarUrl")
      .populate("communityId", "name")
      .sort(sort)
      .limit(query.limit)
      .lean();

    const formatted = posts.map((p: any) => ({
      ...p,
      author: p.authorId,
      community: p.communityId,
      authorUsername: p.authorId?.username || "",
      communityName: p.communityId?.name || "",
    }));

    res.json({ posts: formatted });
  }
);
