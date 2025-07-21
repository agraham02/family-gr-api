import { Request, Response, NextFunction } from "express";
import * as RoomService from "../services/RoomService";

export async function createRoom(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { roomName, userName } = req.body;
        if (!roomName || !userName) {
            const err = new Error("roomName and userName are required");
            (err as any).status = 400;
            throw err;
        }
        const { room, user } = RoomService.createRoom(roomName, userName);
        res.status(201).json({ roomId: room.id, userId: user.id });
    } catch (err) {
        next(err);
    }
}

export async function joinRoom(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { userName, roomCode } = req.body;
        if (!userName || !roomCode) {
            const err = new Error("userName and roomCode are required");
            (err as any).status = 400;
            throw err;
        }

        const { room, user } = RoomService.joinRoom(roomCode, userName);
        res.status(200).json({ roomId: room.id, userId: user.id });
    } catch (err) {
        next(err);
    }
}
