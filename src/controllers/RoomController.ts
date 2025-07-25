import { Request, Response, NextFunction } from "express";
import * as RoomService from "../services/RoomService";

export async function createRoom(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { roomName, userName } = req.body;
        if (!userName) {
            const err = new Error("userName is required");
            (err as any).status = 400;
            throw err;
        }

        let tempRoomName;
        if (!roomName) {
            tempRoomName = `Room-${Math.floor(Math.random() * 10000)}`;
        }

        const { room, user } = RoomService.createRoom(
            roomName || tempRoomName,
            userName
        );
        res.status(201).json({
            roomId: room.id,
            userId: user.id,
            roomCode: room.code,
        });
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
        const { userName, roomCode, userId } = req.body;
        if (!userName || !roomCode) {
            const err = new Error("userName and roomCode are required");
            (err as any).status = 400;
            throw err;
        }

        const { room, user } = RoomService.joinRoom(roomCode, userName, userId);
        res.status(200).json({
            roomId: room.id,
            userId: user.id,
            roomCode: room.code,
        });
    } catch (err) {
        next(err);
    }
}
