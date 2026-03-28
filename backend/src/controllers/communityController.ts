import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/errors.js";
import { Community } from "../models/Community.js";
import { Membership } from "../models/Membership.js";
import { JoinRequest } from "../models/JoinRequest.js";
import { Notification } from "../models/Notification.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";

const createCommunitySchema = z.object({
  name: z.string().min(3).max(21).regex(/^[a-zA-Z0-9_]+$/),
  description: z.string().min(1),
  isPrivate: z.boolean().default(false),
  isNsfw: z.boolean().default(false),
  allowedPostTypes: z
    .array(z.enum(["text", "link", "image", "poll"]))
    .default(["text", "link", "image", "poll"]),
  iconUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
});

export const listCommunities = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user?.id;
  
  let communities;
  
  // If user is authenticated, get their memberships and sort accordingly
  if (userId) {
    const userMemberships = await Membership.find({ userId }).select('communityId');
    const joinedCommunityIds = userMemberships.map(m => m.communityId.toString());
    
    const allCommunities = await Community.find().sort({ memberCount: -1 }).limit(50).lean();
    
    // Sort: joined communities first, then by member count
    communities = allCommunities.sort((a, b) => {
      const aJoined = joinedCommunityIds.includes(a._id.toString());
      const bJoined = joinedCommunityIds.includes(b._id.toString());
      
      if (aJoined && !bJoined) return -1;
      if (!aJoined && bJoined) return 1;
      return Number(b.memberCount ?? 0) - Number(a.memberCount ?? 0);
    });
  } else {
    communities = await Community.find().sort({ memberCount: -1 }).limit(50);
  }
  
  res.json({ communities });
});

export const createCommunity = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const body = createCommunitySchema.parse(req.body);
    const userId = req.user!.id;

    const existing = await Community.findOne({ name: body.name });
    if (existing) throw badRequest("Community name already exists");

    const community = await Community.create({
      name: body.name,
      description: body.description,
      isPrivate: body.isPrivate,
      isNsfw: body.isNsfw,
      allowedPostTypes: body.allowedPostTypes,
      createdBy: userId,
      moderators: [userId],
      memberCount: 1,
      iconUrl: body.iconUrl || undefined,
      bannerUrl: body.bannerUrl || undefined,
    });

    await Membership.create({
      userId,
      communityId: community._id,
      role: "owner",
    });

    res.status(201).json({ community });
  }
);

export const getCommunity = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const community = await Community.findOne({ name });
  if (!community) throw notFound("Community not found");
  res.json({ community });
});

export const joinCommunity = asyncHandler(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { name } = req.params;
    const community = await Community.findOne({ name });
    if (!community) throw notFound("Community not found");

    const existing = await Membership.findOne({
      userId: req.user!.id,
      communityId: community._id,
    });

    if (existing) {
      throw badRequest("You are already a member of this community");
    }

    // Check if community is private
    if (community.isPrivate) {
      // Check if there's already a pending or rejected request
      const existingRequest = await JoinRequest.findOne({
        userId: req.user!.id,
        communityId: community._id,
      });

      if (existingRequest) {
        if (existingRequest.status === "pending") {
          res.json({
            joined: false,
            status: "pending",
            message: "You already have a pending join request for this community.",
          });
          return;
        } else if (existingRequest.status === "rejected") {
          existingRequest.status = "pending";
          await existingRequest.save();
        } else if (existingRequest.status === "approved") {
          // Safety: if request shows approved but membership missing, fall through to membership creation
          await existingRequest.deleteOne();
        }
      } else {
        // Create join request
        await JoinRequest.create({
          userId: req.user!.id,
          communityId: community._id,
          status: "pending",
        });
      }

      // Notify community creator and moderators about the new request
      const recipients = [community.createdBy, ...(community.moderators || [])]
        .filter(Boolean)
        .map((id) => id!.toString());
      const uniqueRecipientIds = Array.from(new Set(recipients));

      if (uniqueRecipientIds.length) {
        await Notification.insertMany(
          uniqueRecipientIds.map((userId) => ({
            userId,
            type: "join_request",
            title: "New join request",
            message: `Someone wants to join r/${community.name}`,
            relatedUserId: req.user!.id,
            relatedCommunityId: community._id,
          }))
        );
      }

      res.json({
        joined: false,
        status: "pending",
        message: "Join request sent. Waiting for approval.",
      });
      return;
    }

    // Public community - join immediately
    await Membership.create({
      userId: req.user!.id,
      communityId: community._id,
      role: "member",
    });
    await Community.findByIdAndUpdate(community._id, { $inc: { memberCount: 1 } });

    res.json({ joined: true, status: "member", message: "Successfully joined community" });
  }
);

export const leaveCommunity = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { name } = req.params;
    const community = await Community.findOne({ name });
    if (!community) throw notFound("Community not found");

    const removed = await Membership.findOneAndDelete({
      userId: req.user!.id,
      communityId: community._id,
    });

    if (removed) {
      await Community.findByIdAndUpdate(community._id, { $inc: { memberCount: -1 } });
    }

    res.json({ joined: false });
  }
);

export const getJoinRequests = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { name } = req.params;
    const community = await Community.findOne({ name });
    if (!community) throw notFound("Community not found");

    // Check if user is moderator or creator
    const isModerator =
      community.createdBy?.toString() === req.user!.id ||
      community.moderators.some((id) => id.toString() === req.user!.id);

    if (!isModerator) {
      throw badRequest("Only moderators can view join requests");
    }

    const requests = await JoinRequest.find({
      communityId: community._id,
      status: "pending",
    })
      .populate("userId", "username displayName avatarUrl")
      .sort({ createdAt: -1 });

    res.json({ requests });
  }
);

export const handleJoinRequest = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { name, requestId } = req.params;
    const { action } = req.body; // 'approve' or 'reject'

    const community = await Community.findOne({ name });
    if (!community) throw notFound("Community not found");

    // Check if user is moderator or creator
    const isModerator =
      community.createdBy?.toString() === req.user!.id ||
      community.moderators.some((id) => id.toString() === req.user!.id);

    if (!isModerator) {
      throw badRequest("Only moderators can handle join requests");
    }

    const request = await JoinRequest.findById(requestId);
    if (!request) throw notFound("Join request not found");
    if (request.communityId.toString() !== community._id.toString()) {
      throw badRequest("Request does not belong to this community");
    }

    if (action === "approve") {
      // Create membership
      await Membership.create({
        userId: request.userId,
        communityId: community._id,
        role: "member",
      });
      await Community.findByIdAndUpdate(community._id, { $inc: { memberCount: 1 } });
      request.status = "approved";
      await request.save();

      // Notify user
      await Notification.create({
        userId: request.userId,
        type: "join_approved",
        title: "Join request approved",
        message: `You have been approved to join r/${community.name}`,
        relatedCommunityId: community._id,
      });
    } else if (action === "reject") {
      request.status = "rejected";
      await request.save();

      // Notify user
      await Notification.create({
        userId: request.userId,
        type: "join_rejected",
        title: "Join request rejected",
        message: `Your request to join r/${community.name} was rejected`,
        relatedCommunityId: community._id,
      });
    } else {
      throw badRequest("Invalid action");
    }

    res.json({ success: true });
  }
);

export const getMembers = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const community = await Community.findOne({ name });
  if (!community) throw notFound("Community not found");

  const memberships = await Membership.find({ communityId: community._id })
    .populate("userId", "username displayName avatarUrl karma createdAt")
    .sort({ createdAt: 1 });

  const members = memberships.map((m: any) => ({
    ...m.userId.toObject(),
    role: m.role,
    joinedAt: m.createdAt,
  }));

  res.json({ members });
});

export const getUserCommunities = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    
    const memberships = await Membership.find({ userId })
      .populate('communityId')
      .sort({ createdAt: -1 });
    
    const communities = memberships
      .filter(m => m.communityId) // Filter out null references
      .map((m: any) => ({
        ...m.communityId.toObject(),
        joinedAt: m.createdAt,
        role: m.role,
      }));
    
    res.json({ communities });
  }
);

export const checkMembership = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { name } = req.params;
    const userId = req.user!.id;
    
    const community = await Community.findOne({ name });
    if (!community) throw notFound("Community not found");
    
    const membership = await Membership.findOne({
      userId,
      communityId: community._id,
    });

    const pendingRequest = await JoinRequest.findOne({
      userId,
      communityId: community._id,
      status: "pending",
    });
    
    res.json({ 
      isMember: !!membership,
      role: membership?.role || null,
      joinedAt: membership?.createdAt || null,
      pendingRequest: !!pendingRequest,
      requestStatus: pendingRequest?.status || null,
    });
  }
);

export const updateMemberRole = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { name, memberId } = req.params;
    const { role } = req.body; // "moderator" | "member"

    const community = await Community.findOne({ name });
    if (!community) throw notFound("Community not found");

    // Only the community owner can manage admin roles
    if (community.createdBy?.toString() !== req.user!.id) {
      throw badRequest("Only the community owner can manage admin roles");
    }

    const membership = await Membership.findOne({
      userId: memberId,
      communityId: community._id,
    });

    if (!membership) {
      throw badRequest("User must be a community member before changing roles");
    }
    if (membership.role === "owner") {
      throw badRequest("Owner role cannot be changed");
    }

    if (role === "moderator") {
      membership.role = "moderator";
    } else if (role === "member") {
      membership.role = "member";
    } else {
      throw badRequest("Invalid role");
    }

    await membership.save();

    // Keep moderators array in sync with membership roles
    const currentModerators = await Membership.find({
      communityId: community._id,
      role: "moderator",
    }).select("userId");
    const moderatorIds = currentModerators.map((m: any) => m.userId);
    await Community.findByIdAndUpdate(community._id, {
      $set: { moderators: moderatorIds },
    });

    await Notification.create({
      userId: memberId,
      type: role === "moderator" ? "promoted_to_admin" : "removed_from_admin",
      title: role === "moderator" ? "You are now an admin" : "Admin access removed",
      message:
        role === "moderator"
          ? `You were promoted to admin in r/${community.name}`
          : `Your admin access was removed in r/${community.name}`,
      relatedCommunityId: community._id,
    });

    res.json({ success: true, role: membership.role });
  }
);
