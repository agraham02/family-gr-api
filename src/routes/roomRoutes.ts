import { Router } from "express";
import {
    createRoom,
    joinRoom,
    requestJoinRoom,
} from "../controllers/RoomController";

const router = Router();

router.post("/rooms", createRoom);
router.post("/rooms/join", joinRoom);
router.post("/rooms/request-join", requestJoinRoom);

export default router;
