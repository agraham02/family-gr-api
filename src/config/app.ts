// Express app configuration
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import healthRoutes from "../routes/healthRoutes";
import roomRoutes from "../routes/roomRoutes";
import gameRoutes from "../routes/gameRoutes";
import { errorHandler } from "../middleware/errorHandler";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.use(healthRoutes);
app.use(roomRoutes);
app.use(gameRoutes);

app.use(errorHandler);

app.get("/", (req, res) => {
    res.send("Welcome to the Family Game Room API!");
});

export default app;
