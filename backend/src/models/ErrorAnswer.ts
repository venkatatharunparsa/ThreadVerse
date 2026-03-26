import { Schema, model, Types } from "mongoose";

const errorAnswerSchema = new Schema(
  {
    reportId: { type: Types.ObjectId, ref: "ErrorReport", required: true, index: true },
    authorId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    content: { type: String, required: true },
    codePatch: { type: String },
    voteScore: { type: Number, default: 0 },
    upvoteCount: { type: Number, default: 0 },
    downvoteCount: { type: Number, default: 0 },
    isAccepted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const ErrorAnswer = model("ErrorAnswer", errorAnswerSchema);
