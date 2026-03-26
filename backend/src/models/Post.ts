import { Schema, model, Types } from "mongoose";

const pollOptionSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    votes: { type: Number, default: 0 },
  },
  { _id: false }
);

const postSchema = new Schema(
  {
    communityId: { type: Types.ObjectId, ref: "Community", index: true },
    authorId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["text", "link", "image", "poll"], required: true },
    title: { type: String, required: true },
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
    voteScore: { type: Number, default: 0 },
    upvoteCount: { type: Number, default: 0 },
    downvoteCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Post = model("Post", postSchema);
