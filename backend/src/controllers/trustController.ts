import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  calculateAndUpdateTrustLevel,
  recalculateTrustLevelsForAllUsers,
  getTrustCalculationInputs,
  TRUST_LEVEL_THRESHOLDS,
} from "../utils/trustLevel.js";
import { TrustLevel } from "../models/TrustLevel.js";
import { User } from "../models/User.js";
import { Types } from "mongoose";

/**
 * Get trust level for a specific user
 */
export const getTrustLevel = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;

    // Validate ObjectId
    if (!Types.ObjectId.isValid(userId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    let trustLevel = await TrustLevel.findOne({ userId }).populate("userId", "username displayName avatarUrl");

    // If trust level doesn't exist, calculate and create it
    if (!trustLevel) {
      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      
      // Calculate and create trust level
      trustLevel = await calculateAndUpdateTrustLevel(userId);
    }

    const doc = trustLevel.toObject ? trustLevel.toObject() : trustLevel;
    const userIdObj = doc.userId as any;
    const formattedData = {
      ...doc,
      userId: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj._id : userIdObj,
      username: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj.username : null,
      displayName: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj.displayName : null,
    };

    res.json({
      success: true,
      data: formattedData,
    });
  }
);

/**
 * Get trust level for current authenticated user
 */
export const getMyTrustLevel = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;

    let trustLevel = await TrustLevel.findOne({ userId }).populate("userId", "username displayName avatarUrl");

    // If trust level doesn't exist, calculate and create it
    if (!trustLevel) {
      trustLevel = await calculateAndUpdateTrustLevel(userId);
    }

    const doc = trustLevel.toObject ? trustLevel.toObject() : trustLevel;
    const userIdObj = doc.userId as any;
    const formattedData = {
      ...doc,
      userId: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj._id : userIdObj,
      username: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj.username : null,
      displayName: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj.displayName : null,
    };

    res.json({
      success: true,
      data: formattedData,
    });
  }
);

/**
 * Recalculate and update trust level for a user
 */
export const recalculateTrustLevel = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;

    // Validate ObjectId
    if (!Types.ObjectId.isValid(userId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const updatedTrustLevel = await calculateAndUpdateTrustLevel(userId);
    const doc = (updatedTrustLevel.toObject ? updatedTrustLevel.toObject() : updatedTrustLevel) as any;
    
    // Populate user details
    const trustLevelWithUser = await TrustLevel.findOne({ userId }).populate("userId", "username displayName avatarUrl");
    const populatedDoc = trustLevelWithUser?.toObject ? trustLevelWithUser.toObject() : trustLevelWithUser;
    
    const userIdObj2 = populatedDoc?.userId as any;
    const formattedData = {
      ...populatedDoc,
      userId: typeof userIdObj2 === 'object' && userIdObj2 !== null ? userIdObj2._id : populatedDoc?.userId,
      username: typeof userIdObj2 === 'object' && userIdObj2 !== null ? userIdObj2.username : null,
      displayName: typeof userIdObj2 === 'object' && userIdObj2 !== null ? userIdObj2.displayName : null,
    };

    res.json({
      success: true,
      message: "Trust level recalculated successfully",
      data: formattedData,
    });
  }
);

/**
 * Recalculate trust levels for all users (admin only)
 */
export const recalculateAllTrustLevels = asyncHandler(
  async (req: Request, res: Response) => {
    const results = await recalculateTrustLevelsForAllUsers();

    res.json({
      success: true,
      message: "All trust levels recalculated",
      data: results,
    });
  }
);

/**
 * Get trust level breakdown for a user
 */
export const getTrustLevelBreakdown = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;

    // Validate ObjectId
    if (!Types.ObjectId.isValid(userId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    let trustLevel = await TrustLevel.findOne({ userId }).populate("userId", "username displayName avatarUrl");

    // If trust level doesn't exist, calculate and create it
    if (!trustLevel) {
      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      
      trustLevel = await calculateAndUpdateTrustLevel(userId);
    }

    const inputs = await getTrustCalculationInputs(userId);

    res.json({
      success: true,
      data: {
        level: trustLevel.level,
        levelName: trustLevel.levelName,
        trustScore: trustLevel.trustScore,
        components: {
          karma: {
            score: trustLevel.karmaTrustComponent,
            maxScore: 25,
            input: inputs.totalKarma,
            description: `${inputs.postKarma} post + ${inputs.commentKarma} comment karma`,
          },
          accountAge: {
            score: trustLevel.accountAgeTrustComponent,
            maxScore: 15,
            input: inputs.accountAgeDays,
            description: `${inputs.accountAgeDays} days old account`,
          },
          reputation: {
            score: trustLevel.reportTrustComponent,
            maxScore: 30,
            input: {
              reportsReceived: inputs.reportsReceived,
              reportsAccepted: inputs.reportsAccepted,
            },
            description: `${inputs.reportsAccepted}/${inputs.reportsReceived} reports accepted`,
          },
          participation: {
            score: trustLevel.participationTrustComponent,
            maxScore: 30,
            input: {
              communitiesParticipatedIn: inputs.communitiesParticipatedIn,
              totalCommunityKarma: inputs.totalCommunityKarma,
            },
            description: `Participated in ${inputs.communitiesParticipatedIn} communities with ${inputs.totalCommunityKarma} karma`,
          },
        },
        thresholds: TRUST_LEVEL_THRESHOLDS,
      },
    });
  }
);

/**
 * Get leaderboard of top trusted users
 */
export const getTrustLeaderboard = asyncHandler(
  async (req: Request, res: Response) => {
    const { limit = 50 } = req.query;

    const leaderboard = await TrustLevel.find()
      .sort({ trustScore: -1 })
      .limit(Number(limit))
      .populate("userId", "username displayName avatarUrl");

    const formattedLeaderboard = leaderboard.map(item => {
      const doc = item.toObject ? item.toObject() : item;
      const userIdObj = doc.userId as any;
      return {
        ...doc,
        userId: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj._id : userIdObj,
        username: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj.username : null,
        displayName: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj.displayName : null,
      };
    });

    res.json({
      success: true,
      data: formattedLeaderboard,
    });
  }
);

/**
 * Get users by trust level
 */
export const getUsersByTrustLevel = asyncHandler(
  async (req: Request, res: Response) => {
    const { level } = req.params;
    const { limit = 50, skip = 0 } = req.query;

    // Validate level
    const levelNum = Number(level);
    if (![0, 1, 2, 3, 4].includes(levelNum)) {
      res.status(400).json({ error: "Invalid trust level" });
      return;
    }

    const users = await TrustLevel.find({ level: levelNum })
      .sort({ trustScore: -1 })
      .limit(Number(limit))
      .skip(Number(skip))
      .populate("userId", "username displayName avatarUrl");

    const formattedUsers = users.map(item => {
      const doc = item.toObject ? item.toObject() : item;
      const userIdObj = doc.userId as any;
      return {
        ...doc,
        userId: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj._id : userIdObj,
        username: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj.username : null,
        displayName: typeof userIdObj === 'object' && userIdObj !== null ? userIdObj.displayName : null,
      };
    });

    const total = await TrustLevel.countDocuments({ level: levelNum });

    res.json({
      success: true,
      data: formattedUsers,
      pagination: {
        total,
        limit: Number(limit),
        skip: Number(skip),
      },
    });
  }
);

/**
 * Get trust statistics
 */
export const getTrustStatistics = asyncHandler(
  async (req: Request, res: Response) => {
    const stats = await TrustLevel.aggregate([
      {
        $group: {
          _id: "$level",
          count: { $sum: 1 },
          avgTrustScore: { $avg: "$trustScore" },
          maxTrustScore: { $max: "$trustScore" },
          minTrustScore: { $min: "$trustScore" },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    const totalUsers = await TrustLevel.countDocuments();

    res.json({
      success: true,
      data: {
        totalUsers,
        byLevel: stats,
        levelNames: {
          0: "Newcomer",
          1: "Member",
          2: "Contributor",
          3: "Trusted",
          4: "Community Leader",
        },
      },
    });
  }
);
