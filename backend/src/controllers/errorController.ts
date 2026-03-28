import { Request, Response } from "express";
import { Types } from "mongoose";
import { ErrorReport } from "../models/ErrorReport.js";
import { ErrorAnswer } from "../models/ErrorAnswer.js";
import { ErrorVote } from "../models/ErrorVote.js";

export async function createErrorReport(req: Request, res: Response) {
  try {
    const { title, language, runtime, code, errorOutput, tags } = req.body;
    const authorId = (req as any).user?.id || req.body.authorId; // fallback for tests

    if (!authorId) return res.status(401).json({ message: "Unauthorized" });
    if (!language || !code || !errorOutput) {
      return res.status(400).json({ message: "language, code and errorOutput are required" });
    }

    const report = await ErrorReport.create({
      authorId: new Types.ObjectId(authorId),
      title,
      language,
      runtime,
      code,
      errorOutput,
      tags,
    });
    res.status(201).json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create error report" });
  }
}

export async function listErrorReports(req: Request, res: Response) {
  try {
    const { q, language, sort = "new" } = req.query as any;
    const filter: any = {};
    if (q) filter.$text = { $search: q };
    if (language) filter.language = language;

    const sortBy: any = sort === "top" ? { voteScore: -1, createdAt: -1 } : { createdAt: -1 };
    const reports = await ErrorReport.find(filter).sort(sortBy).limit(50).lean();
    res.json(reports);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch error reports" });
  }
}

export async function getErrorReport(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const report = await ErrorReport.findById(id).lean();
    if (!report) return res.status(404).json({ message: "Not found" });

    const answers = await ErrorAnswer.find({ reportId: id }).sort({ voteScore: -1, createdAt: 1 }).lean();
    res.json({ report, answers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch error report" });
  }
}

export async function addAnswer(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { content, codePatch } = req.body;
    const authorId = (req as any).user?.id || req.body.authorId;
    if (!authorId) return res.status(401).json({ message: "Unauthorized" });

    const answer = await ErrorAnswer.create({
      reportId: new Types.ObjectId(id),
      authorId: new Types.ObjectId(authorId),
      content,
      codePatch,
    });

    res.status(201).json(answer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add answer" });
  }
}

export async function voteAnswer(req: Request, res: Response) {
  try {
    const { answerId } = req.params;
    const { direction } = req.body; // 'up' | 'down'
    const userId = (req as any).user?.id;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!["up", "down"].includes(direction)) {
      return res.status(400).json({ message: "Invalid direction: use 'up' or 'down'" });
    }

    const answer = await ErrorAnswer.findById(answerId);
    if (!answer) return res.status(404).json({ message: "Answer not found" });

    // Check if user already voted
    const existingVote = await ErrorVote.findOne({
      answerId: new Types.ObjectId(answerId),
      userId: new Types.ObjectId(userId),
    });

    if (existingVote) {
      // Remove old vote and update counts
      const oldDirection = existingVote.direction;
      if (oldDirection === "up") {
        answer.upvoteCount = Math.max(0, answer.upvoteCount - 1);
        answer.voteScore -= 1;
      } else {
        answer.downvoteCount = Math.max(0, answer.downvoteCount - 1);
        answer.voteScore += 1;
      }

      // If new direction is same, delete the vote (toggle off)
      if (oldDirection === direction) {
        await ErrorVote.deleteOne({ _id: existingVote._id });
      } else {
        // Replace with new direction
        existingVote.direction = direction;
        await existingVote.save();
        if (direction === "up") {
          answer.upvoteCount += 1;
          answer.voteScore += 1;
        } else {
          answer.downvoteCount += 1;
          answer.voteScore -= 1;
        }
      }
    } else {
      // First vote from this user - use updateOne to avoid race conditions
      try {
        await ErrorVote.updateOne(
          {
            answerId: new Types.ObjectId(answerId),
            userId: new Types.ObjectId(userId),
          },
          {
            $set: {
              answerId: new Types.ObjectId(answerId),
              userId: new Types.ObjectId(userId),
              direction,
            },
          },
          { upsert: true }
        );
      } catch (err: any) {
        // If duplicate key error, fetch and update existing vote instead
        if (err.code === 11000) {
          const existingVote2 = await ErrorVote.findOne({
            answerId: new Types.ObjectId(answerId),
            userId: new Types.ObjectId(userId),
          });
          if (existingVote2 && existingVote2.direction !== direction) {
            // Update counts for direction change
            if (existingVote2.direction === "up") {
              answer.upvoteCount = Math.max(0, answer.upvoteCount - 1);
              answer.voteScore -= 1;
            } else {
              answer.downvoteCount = Math.max(0, answer.downvoteCount - 1);
              answer.voteScore += 1;
            }
            existingVote2.direction = direction;
            await existingVote2.save();
            if (direction === "up") {
              answer.upvoteCount += 1;
              answer.voteScore += 1;
            } else {
              answer.downvoteCount += 1;
              answer.voteScore -= 1;
            }
          }
        } else {
          throw err;
        }
      }

      if (direction === "up") {
        answer.upvoteCount += 1;
        answer.voteScore += 1;
      } else {
        answer.downvoteCount += 1;
        answer.voteScore -= 1;
      }
    }

    await answer.save();
    res.json(answer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to vote" });
  }
}

export async function acceptAnswer(req: Request, res: Response) {
  try {
    const { id, answerId } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const report = await ErrorReport.findById(id);
    const answer = await ErrorAnswer.findById(answerId);
    if (!report || !answer) return res.status(404).json({ message: "Not found" });

    // Only report author can accept an answer
    if (report.authorId.toString() !== userId) {
      return res.status(403).json({ message: "Only the report author can accept answers" });
    }

    (report as any).acceptedAnswerId = answer._id;
    report.status = "resolved";
    answer.isAccepted = true;

    await Promise.all([report.save(), answer.save()]);
    res.json({ report, answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to accept answer" });
  }
}
