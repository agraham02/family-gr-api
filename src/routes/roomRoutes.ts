import { Router } from "express";
import { createRoom, joinRoom } from "../controllers/RoomController";

const router = Router();

router.post("/rooms", createRoom);
router.post("/rooms/:roomId/join", joinRoom);

export default router;
