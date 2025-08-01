import { Router } from "express";
import { createRoom, joinRoom } from "../controllers/RoomController";

const router = Router();

router.post("/rooms", createRoom);
router.post("/rooms/join", joinRoom);

export default router;
