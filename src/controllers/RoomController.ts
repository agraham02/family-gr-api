import { Request, Response, NextFunction } from "express";
import * as RoomService from "../services/RoomService";
import { getIO, hasIO } from "../utils/socketIO";
import { badRequest } from "../utils/httpErrors";

export async function createRoom(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { roomName, userName } = req.body;
        if (!userName) {
            throw badRequest("userName is required.");
        }

        let tempRoomName;
        if (!roomName) {
            tempRoomName = `Room-${Math.floor(Math.random() * 10000)}`;
        }

        const { room, user } = await RoomService.createRoom(
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
            throw badRequest("userName and roomCode are required.");
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

/**
 * Request to join a private room.
 * Notifies the room leader via socket and returns success.
 */
export async function requestJoinRoom(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { roomCode, requesterId, requesterName } = req.body;

        if (!roomCode || !requesterId || !requesterName) {
            throw badRequest(
                "roomCode, requesterId, and requesterName are required."
            );
        }

        // This will throw if rate-limited or room not found
        const { roomId } = RoomService.requestToJoinRoom(
            roomCode,
            requesterId,
            requesterName
        );

        // Emit join_request to the room so the leader receives it
        if (hasIO()) {
            const io = getIO();
            io.to(roomId).emit("join_request", {
                requesterId,
                requesterName,
                roomCode,
                timestamp: new Date().toISOString(),
            });
        }

        res.status(200).json({
            success: true,
            message: "Join request sent to room leader.",
        });
    } catch (err) {
        next(err);
    }
}

export async function getRoomIdByCode(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { roomCode } = req.params;
        if (!roomCode) {
            throw badRequest("roomCode is required.");
        }

        const roomId = RoomService.getRoomIdByCode(roomCode);
        if (!roomId) {
            res.status(404).json({ error: "Room not found." });
            return;
        }

        res.status(200).json({ roomId });
    } catch (err) {
        next(err);
    }
}
