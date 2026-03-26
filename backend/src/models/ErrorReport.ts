import { Schema, model, Types } from "mongoose";

const errorReportSchema = new Schema(
  {
    authorId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String },
    language: { type: String, required: true },
    runtime: { type: String },
    code: { type: String, required: true },
    errorOutput: { type: String, required: true },
    tags: [{ type: String }],
    status: { type: String, enum: ["open", "resolved"], default: "open" },
    acceptedAnswerId: { type: Types.ObjectId, ref: "ErrorAnswer" },
    voteScore: { type: Number, default: 0 },
    upvoteCount: { type: Number, default: 0 },
    downvoteCount: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const ErrorReport = model("ErrorReport", errorReportSchema);
