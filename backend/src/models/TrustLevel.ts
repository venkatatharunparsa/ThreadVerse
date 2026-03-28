import { Schema, model, Types } from "mongoose";

const trustLevelSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    level: {
      type: Number,
      enum: [0, 1, 2, 3, 4],
      default: 0,
      description: "L0=Newcomer, L1=Member, L2=Contributor, L3=Trusted, L4=Community Leader"
    },
    levelName: {
      type: String,
      enum: ["Newcomer", "Member", "Contributor", "Trusted", "Community Leader"],
      default: "Newcomer"
    },
    // Inputs to calculate trust
    totalKarma: { type: Number, default: 0 },
    accountAgeDays: { type: Number, default: 0 },
    reportsReceived: { type: Number, default: 0 },
    reportsAccepted: { type: Number, default: 0 },
    communityParticipationScore: { type: Number, default: 0 }, // Based on communities participated in
    
    // Additional metrics
    postKarma: { type: Number, default: 0 },
    commentKarma: { type: Number, default: 0 },
    communitiesParticipatedIn: { type: Number, default: 0 },
    reputationScore: { type: Number, default: 0 },
    
    // Trust score breakdown (0-100)
    trustScore: { type: Number, default: 0 },
    karmaTrustComponent: { type: Number, default: 0 },
    accountAgeTrustComponent: { type: Number, default: 0 },
    reportTrustComponent: { type: Number, default: 0 },
    participationTrustComponent: { type: Number, default: 0 },
    
    // Badges earned
    badges: [
      {
        name: String,
        description: String,
        earnedAt: Date,
      }
    ],

    lastCalculatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

trustLevelSchema.index({ level: 1 });
trustLevelSchema.index({ trustScore: -1 });
trustLevelSchema.index({ createdAt: -1 });

export const TrustLevel = model("TrustLevel", trustLevelSchema);
