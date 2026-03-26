import { Schema, model, Types } from "mongoose";

const pollOptionSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const draftSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    type: { 
      type: String, 
      enum: ["post", "comment"], 
      required: true 
    },
    
    // Post-specific fields
    communityId: { type: Types.ObjectId, ref: "Community" },
    postType: { type: String, enum: ["text", "link", "image", "poll"] },
    title: { type: String },
    body: { type: String },
    linkUrl: { type: String },
    imageUrl: { type: String },
    tags: [{ type: String }],
    isSpoiler: { type: Boolean, default: false },
    isNsfw: { type: Boolean, default: false },
    isOc: { type: Boolean, default: false },
    poll: {
      options: [pollOptionSchema],
      closesAt: { type: Date },
    },
    
    // Comment-specific fields
    postId: { type: Types.ObjectId, ref: "Post" },
    parentCommentId: { type: Types.ObjectId, ref: "Comment" },
    content: { type: String },
    
    // Auto-save timestamp
    lastSavedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Index for efficient querying
draftSchema.index({ userId: 1, type: 1 });
draftSchema.index({ userId: 1, lastSavedAt: -1 });

export const Draft = model("Draft", draftSchema);
