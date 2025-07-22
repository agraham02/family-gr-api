// Entry point for the Express server
import dotenv from "dotenv";
import app from "./config/app";
import { createServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { emitRoomEvent, setSocketServer } from "./webhooks/roomWebhooks";
import {
    closeRoom,
    getRoom,
    handleUserDisconnect,
    kickUser,
    promoteLeader,
    registerSocketUser,
    setReadyState,
    startGame,
    toggleReadyState,
} from "./services/RoomService";

dotenv.config();

const PORT = process.env.PORT || 4000;

function handleSocketError(socket: Socket, err: any) {
    console.error(err);
    socket.emit("error", {
        error: err.message || "Internal Server Error",
    });
}

function startServer() {
    const httpServer = createServer(app);

    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: "*",
        },
    });

    setSocketServer(io);

    io.on("connection", (socket) => {
        // Client should join a room by roomId after connecting
        console.log(`New client connected: ${socket.id}`);

        socket.on("join_room", ({ roomId, userId }) => {
            try {
                if (!roomId || !userId) {
                    throw new Error(
                        `join_room missing roomId or userId for socket ${socket.id}`
                    );
                }
                registerSocketUser(socket.id, roomId, userId);
                socket.join(roomId);
                const room = getRoom(roomId);
                if (!room) {
                    throw new Error(
                        `Room with ID ${roomId} not found for socket ${socket.id}`
                    );
                }
                emitRoomEvent(room, "sync");
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("toggle_ready", ({ roomId, userId }) => {
            try {
                toggleReadyState(roomId, userId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });
        socket.on("promote_leader", ({ roomId, userId, newLeaderId }) => {
            try {
                console.log(roomId, userId, newLeaderId);
                promoteLeader(roomId, userId, newLeaderId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });
        socket.on("kick_user", ({ roomId, userId, targetUserId }) => {
            try {
                kickUser(roomId, userId, targetUserId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });
        socket.on("start_game", ({ roomId, userId }) => {
            try {
                startGame(roomId, userId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });
        socket.on("close_room", ({ roomId, userId }) => {
            try {
                closeRoom(roomId, userId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("disconnect", () => {
            try {
                console.log(`Client disconnected: ${socket.id}`);
                handleUserDisconnect(socket.id);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });
    });

    httpServer.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`Server and Socket.io running on port ${PORT}`);
    });
}

startServer();
