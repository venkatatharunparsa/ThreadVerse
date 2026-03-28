import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/errors.js";
import { User } from "../models/User.js";
import { Follow } from "../models/Follow.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { 
  getUserTotalKarma, 
  getUserCommunityReputations, 
  getCommunityReputation,
  recalculateUserKarma,
  recalculateCommunityReputation
} from "../utils/karma.js";

const updateMeSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(200).optional(),
});

function toPublicUser(u: any) {
  return {
    id: u._id,
    username: u.username,
    displayName: u.displayName ?? u.username,
    bio: u.bio ?? "",
    avatarUrl: u.avatarUrl ?? "",
    karma: u.karma ?? { post: 0, comment: 0 },
    followersCount: u.followersCount ?? 0,
    followingCount: u.followingCount ?? 0,
    createdAt: u.createdAt,
  };
}

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const { username } = req.params;
  const user = await User.findOne({ username });
  if (!user) throw notFound("User not found");
  res.json({ user: toPublicUser(user) });
});

export const updateMe = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const body = updateMeSchema.parse(req.body);
    const userId = req.user!.id;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: body },
      { new: true }
    );
    if (!user) throw notFound("User not found");
    res.json({ user: toPublicUser(user) });
  }
);

export const followUser = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { username } = req.params;
    const currentUserId = req.user!.id;

    const targetUser = await User.findOne({ username });
    if (!targetUser) throw notFound("User not found");

    // Prevent following yourself
    if (targetUser._id.toString() === currentUserId) {
      throw badRequest("You cannot follow yourself");
    }

    // Check if already following
    const existingFollow = await Follow.findOne({
      followerId: currentUserId,
      followingId: targetUser._id,
    });

    if (existingFollow) {
      throw badRequest("You are already following this user");
    }

    // Create follow relationship
    await Follow.create({
      followerId: currentUserId,
      followingId: targetUser._id,
    });

    // Update counts
    await User.findByIdAndUpdate(currentUserId, { $inc: { followingCount: 1 } });
    await User.findByIdAndUpdate(targetUser._id, { $inc: { followersCount: 1 } });

    res.json({ following: true, message: "User followed successfully" });
  }
);

export const unfollowUser = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { username } = req.params;
    const currentUserId = req.user!.id;

    const targetUser = await User.findOne({ username });
    if (!targetUser) throw notFound("User not found");

    // Delete follow relationship
    const follow = await Follow.findOneAndDelete({
      followerId: currentUserId,
      followingId: targetUser._id,
    });

    if (follow) {
      // Update counts only if relationship existed
      await User.findByIdAndUpdate(currentUserId, { $inc: { followingCount: -1 } });
      await User.findByIdAndUpdate(targetUser._id, { $inc: { followersCount: -1 } });
    }

    res.json({ following: false, message: "User unfollowed successfully" });
  }
);

export const checkFollowing = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { username } = req.params;
    const currentUserId = req.user!.id;

    const targetUser = await User.findOne({ username });
    if (!targetUser) throw notFound("User not found");

    const isFollowing = await Follow.exists({
      followerId: currentUserId,
      followingId: targetUser._id,
    });

    res.json({ following: !!isFollowing });
  }
);

// Karma and Reputation Endpoints

export const getUserKarma = asyncHandler(async (req: Request, res: Response) => {
  const { username } = req.params;
  
  const user = await User.findOne({ username });
  if (!user) throw notFound("User not found");

  const karma = await getUserTotalKarma(user._id);
  
  res.json({ 
    username: user.username,
    karma: {
      post: karma.postKarma,
      comment: karma.commentKarma,
      total: karma.totalKarma,
    }
  });
});

export const getUserCommunityReps = asyncHandler(async (req: Request, res: Response) => {
  const { username } = req.params;
  
  const user = await User.findOne({ username });
  if (!user) throw notFound("User not found");

  const reputations = await getUserCommunityReputations(user._id);
  
  res.json({ 
    username: user.username,
    communityReputations: reputations,
  });
});

export const getUserCommunityReputation = asyncHandler(async (req: Request, res: Response) => {
  const { username, communityName } = req.params;
  
  const user = await User.findOne({ username });
  if (!user) throw notFound("User not found");

  const { Community } = await import("../models/Community.js");
  const community = await Community.findOne({ name: communityName });
  if (!community) throw notFound("Community not found");

  const reputation = await getCommunityReputation(user._id, community._id);
  
  res.json({ 
    username: user.username,
    communityName: community.name,
    communityDisplayName: community.name,
    reputation,
  });
});

export const recalculateMyKarma = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    
    const karma = await recalculateUserKarma(userId);
    
    res.json({ 
      message: "Karma recalculated successfully",
      karma: {
        post: karma.postKarma,
        comment: karma.commentKarma,
        total: karma.totalKarma,
      }
    });
  }
);

export const recalculateMyCommunityReputation = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { communityName } = req.params;
    const userId = req.user!.id;
    
    const { Community } = await import("../models/Community.js");
    const community = await Community.findOne({ name: communityName });
    if (!community) throw notFound("Community not found");

    const reputation = await recalculateCommunityReputation(userId, community._id);
    
    res.json({ 
      message: "Community reputation recalculated successfully",
      communityName: community.name,
      reputation,
    });
  }
);

