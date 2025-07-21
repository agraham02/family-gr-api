// Entry point for the Express server
import dotenv from "dotenv";
import app from "./config/app";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { setSocketServer } from "./webhooks/roomWebhooks";

dotenv.config();

const PORT = process.env.PORT || 3000;

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
        socket.on("join_room", (roomId: string) => {
            socket.join(roomId);
        });
    });

    httpServer.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`Server and Socket.io running on port ${PORT}`);
    });
}

startServer();
