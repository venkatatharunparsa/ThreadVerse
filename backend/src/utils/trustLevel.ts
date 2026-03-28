import { User } from "../models/User.js";
import { TrustLevel } from "../models/TrustLevel.js";
import { Report } from "../models/Report.js";
import { CommunityReputation } from "../models/CommunityReputation.js";
import { Types } from "mongoose";

interface TrustCalculationInputs {
  totalKarma: number;
  postKarma: number;
  commentKarma: number;
  accountAgeDays: number;
  reportsReceived: number;
  reportsAccepted: number;
  communitiesParticipatedIn: number;
  totalCommunityKarma: number;
}

export const TRUST_LEVEL_THRESHOLDS = {
  L0: { minScore: 0, maxScore: 20, name: "Newcomer" },
  L1: { minScore: 20, maxScore: 40, name: "Member" },
  L2: { minScore: 40, maxScore: 60, name: "Contributor" },
  L3: { minScore: 60, maxScore: 80, name: "Trusted" },
  L4: { minScore: 80, maxScore: 100, name: "Community Leader" },
};

/**
 * Calculate account age in days from creation date
 */
export function calculateAccountAgeDays(createdAt: Date): number {
  const now = new Date();
  const ageInMs = now.getTime() - new Date(createdAt).getTime();
  return Math.floor(ageInMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate karma trust component (0-25 points)
 * Based on total karma (post + comment)
 */
export function calculateKarmaTrustComponent(totalKarma: number): number {
  // Scale: 0 karma = 0 points, 1000+ karma = 25 points
  const maxKarmaPoints = 1000;
  const maxScore = 25;
  return Math.min((totalKarma / maxKarmaPoints) * maxScore, maxScore);
}

/**
 * Calculate account age trust component (0-15 points)
 * Based on account age in days
 */
export function calculateAccountAgeTrustComponent(accountAgeDays: number): number {
  // Scale: 0 days = 0 points, 180+ days = 15 points
  const maxAgeDays = 180; // ~6 months
  const maxScore = 15;
  return Math.min((accountAgeDays / maxAgeDays) * maxScore, maxScore);
}

/**
 * Calculate report trust component (0-30 points)
 * Based on ratio of reports received vs accepted
 * Higher ratio = more trustworthy
 */
export function calculateReportTrustComponent(
  reportsReceived: number,
  reportsAccepted: number
): number {
  const maxScore = 30;
  
  // If no reports, give full credit
  if (reportsReceived === 0) return maxScore;
  
  // Calculate acceptance ratio (higher is better for user)
  const acceptanceRatio = 1 - (reportsAccepted / reportsReceived);
  
  return Math.max(maxScore * acceptanceRatio, 0);
}

/**
 * Calculate participation trust component (0-30 points)
 * Based on community participation diversity and karma
 */
export function calculateParticipationTrustComponent(
  communitiesParticipatedIn: number,
  totalCommunityKarma: number
): number {
  const maxScore = 30;
  
  // Community diversity score (0-15): 5+ communities = full score
  const maxCommunities = 5;
  const communityScore = Math.min(
    (communitiesParticipatedIn / maxCommunities) * 15,
    15
  );
  
  // Community karma score (0-15): 500+ community karma = full score
  const maxCommunityKarma = 500;
  const karmaScore = Math.min(
    (totalCommunityKarma / maxCommunityKarma) * 15,
    15
  );
  
  return communityScore + karmaScore;
}

/**
 * Calculate overall trust score (0-100)
 */
export function calculateTrustScore(
  karmaTrustComponent: number,
  accountAgeTrustComponent: number,
  reportTrustComponent: number,
  participationTrustComponent: number
): number {
  const totalScore =
    karmaTrustComponent +
    accountAgeTrustComponent +
    reportTrustComponent +
    participationTrustComponent;
  
  return Math.round(Math.min(totalScore, 100));
}

/**
 * Determine trust level based on trust score
 */
export function determineTrustLevel(trustScore: number): {
  level: number;
  levelName: string;
} {
  if (trustScore >= TRUST_LEVEL_THRESHOLDS.L4.minScore) {
    return { level: 4, levelName: "Community Leader" };
  } else if (trustScore >= TRUST_LEVEL_THRESHOLDS.L3.minScore) {
    return { level: 3, levelName: "Trusted" };
  } else if (trustScore >= TRUST_LEVEL_THRESHOLDS.L2.minScore) {
    return { level: 2, levelName: "Contributor" };
  } else if (trustScore >= TRUST_LEVEL_THRESHOLDS.L1.minScore) {
    return { level: 1, levelName: "Member" };
  } else {
    return { level: 0, levelName: "Newcomer" };
  }
}

/**
 * Fetch user inputs needed for trust calculation
 */
export async function getTrustCalculationInputs(
  userId: string | Types.ObjectId
): Promise<TrustCalculationInputs> {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");
  const userKarma = user.karma as { post?: number; comment?: number } | undefined;

  // Get account age
  const accountAgeDays = calculateAccountAgeDays(user.createdAt);

  // Get reports metrics
  const reportsReceived = await Report.countDocuments({
    targetId: userId,
    targetType: "user",
  });

  const reportsAccepted = await Report.countDocuments({
    targetId: userId,
    targetType: "user",
    status: "resolved",
  });

  // Get community participation
  const communityReps = await CommunityReputation.find({ userId });
  const communitiesParticipatedIn = communityReps.length;
  const totalCommunityKarma = communityReps.reduce(
    (sum, rep) => sum + rep.totalKarma,
    0
  );

  return {
    totalKarma: (userKarma?.post || 0) + (userKarma?.comment || 0),
    postKarma: userKarma?.post || 0,
    commentKarma: userKarma?.comment || 0,
    accountAgeDays,
    reportsReceived,
    reportsAccepted,
    communitiesParticipatedIn,
    totalCommunityKarma,
  };
}

/**
 * Calculate and update user's trust level
 */
export async function calculateAndUpdateTrustLevel(
  userId: string | Types.ObjectId
) {
  try {
    const inputs = await getTrustCalculationInputs(userId);

    // Calculate trust components
    const karmaTrustComponent = calculateKarmaTrustComponent(inputs.totalKarma);
    const accountAgeTrustComponent = calculateAccountAgeTrustComponent(
      inputs.accountAgeDays
    );
    const reportTrustComponent = calculateReportTrustComponent(
      inputs.reportsReceived,
      inputs.reportsAccepted
    );
    const participationTrustComponent = calculateParticipationTrustComponent(
      inputs.communitiesParticipatedIn,
      inputs.totalCommunityKarma
    );

    // Calculate overall trust score
    const trustScore = calculateTrustScore(
      karmaTrustComponent,
      accountAgeTrustComponent,
      reportTrustComponent,
      participationTrustComponent
    );

    // Determine trust level
    const { level, levelName } = determineTrustLevel(trustScore);

    // Update or create trust level record
    const trustLevelRecord = await TrustLevel.findOneAndUpdate(
      { userId },
      {
        userId,
        level,
        levelName,
        totalKarma: inputs.totalKarma,
        postKarma: inputs.postKarma,
        commentKarma: inputs.commentKarma,
        accountAgeDays: inputs.accountAgeDays,
        reportsReceived: inputs.reportsReceived,
        reportsAccepted: inputs.reportsAccepted,
        communitiesParticipatedIn: inputs.communitiesParticipatedIn,
        reputationScore: inputs.totalCommunityKarma,
        trustScore,
        karmaTrustComponent: Math.round(karmaTrustComponent),
        accountAgeTrustComponent: Math.round(accountAgeTrustComponent),
        reportTrustComponent: Math.round(reportTrustComponent),
        participationTrustComponent: Math.round(participationTrustComponent),
        lastCalculatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    return trustLevelRecord;
  } catch (error) {
    console.error(`Error calculating trust level for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Recalculate trust levels for multiple users (batch operation)
 */
export async function recalculateTrustLevelsForAllUsers() {
  try {
    const users = await User.find();
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
    };

    for (const user of users) {
      try {
        await calculateAndUpdateTrustLevel(user._id);
        results.successful++;
      } catch (error) {
        console.error(`Failed to update trust for user ${user._id}:`, error);
        results.failed++;
      }
      results.processed++;
    }

    return results;
  } catch (error) {
    console.error("Error recalculating trust levels:", error);
    throw error;
  }
}
