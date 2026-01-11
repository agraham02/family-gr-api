import { Router } from "express";
import {
    createRoom,
    joinRoom,
    requestJoinRoom,
    getRoomIdByCode,
} from "../controllers/RoomController";

const router = Router();

router.post("/rooms", createRoom);
router.post("/rooms/join", joinRoom);
router.post("/rooms/request-join", requestJoinRoom);
router.get("/rooms/code/:roomCode", getRoomIdByCode);

export default router;
