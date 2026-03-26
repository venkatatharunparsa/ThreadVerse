import { Schema, model, Types } from "mongoose";

const notificationSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: [
        "join_request",
        "join_approved",
        "join_rejected",
        "promoted_to_admin",
        "removed_from_admin",
        "post_comment",
        "comment_reply",
        "post_upvote",
        "mention",
        "system",
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    relatedUserId: { type: Types.ObjectId, ref: "User" },
    relatedCommunityId: { type: Types.ObjectId, ref: "Community" },
    relatedPostId: { type: Types.ObjectId, ref: "Post" },
    relatedCommentId: { type: Types.ObjectId, ref: "Comment" },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = model("Notification", notificationSchema);
