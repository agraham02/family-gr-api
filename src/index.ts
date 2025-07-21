// Entry point for the Express server
import dotenv from "dotenv";
import app from "./config/app";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { emitRoomEvent, setSocketServer } from "./webhooks/roomWebhooks";
import { getRoom } from "./services/RoomService";

dotenv.config();

const PORT = process.env.PORT || 4000;

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
        socket.on("join_room", (roomId: string) => {
            socket.join(roomId);
            // Send the current room state to just this socket
            const room = getRoom(roomId);
            if (!room) {
                console.error(
                    `Room with ID ${roomId} not found for socket ${socket.id}`
                );
                return;
            }

            emitRoomEvent(room, "sync");
        });
    });

    httpServer.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`Server and Socket.io running on port ${PORT}`);
    });
}

startServer();
