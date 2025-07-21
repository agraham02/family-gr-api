import { Request, Response, NextFunction } from "express";
import * as RoomService from "../../services/RoomService";

export async function createRoom(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { roomName, userName, webhookUrl } = req.body;
        if (!roomName || !userName || !webhookUrl) {
            return res.status(400).json({
                error: "roomName, userName, and webhookUrl are required",
            });
        }
        const { room, user } = RoomService.createRoom(
            roomName,
            userName,
            webhookUrl
        );
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
        const { userName, webhookUrl } = req.body;
        const { roomId } = req.params;
        if (!userName || !webhookUrl) {
            return res
                .status(400)
                .json({ error: "userName and webhookUrl are required" });
        }
        const { room, user } = RoomService.joinRoom(
            roomId,
            userName,
            webhookUrl
        );
        res.status(200).json({ roomId: room.id, userId: user.id });
    } catch (err) {
        next(err);
    }
}
