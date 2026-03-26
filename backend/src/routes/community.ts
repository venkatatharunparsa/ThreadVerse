import { Router } from "express";
import {
  createCommunity,
  getCommunity,
  joinCommunity,
  leaveCommunity,
  listCommunities,
  getJoinRequests,
  handleJoinRequest,
  getMembers,
  getUserCommunities,
  checkMembership,
  updateMemberRole,
} from "../controllers/communityController.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", optionalAuth, listCommunities);
router.post("/", requireAuth, createCommunity);
router.get("/my-communities", requireAuth, getUserCommunities);
router.get("/:name", getCommunity);
router.get("/:name/members", getMembers);
router.get("/:name/membership", requireAuth, checkMembership);
router.post("/:name/join", requireAuth, joinCommunity);
router.delete("/:name/join", requireAuth, leaveCommunity);
router.get("/:name/join-requests", requireAuth, getJoinRequests);
router.post("/:name/join-requests/:requestId", requireAuth, handleJoinRequest);
router.post(":name/members/:memberId/role", requireAuth, updateMemberRole);

export default router;
