import { Schema, model, Types } from "mongoose";

const errorVoteSchema = new Schema(
  {
    answerId: { type: Types.ObjectId, ref: "ErrorAnswer", required: true, index: true },
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    direction: { type: String, enum: ["up", "down"], required: true },
  },
  { timestamps: true }
);

// Compound index to prevent duplicate votes from same user on same answer
errorVoteSchema.index({ answerId: 1, userId: 1 }, { unique: true });

export const ErrorVote = model("ErrorVote", errorVoteSchema);
