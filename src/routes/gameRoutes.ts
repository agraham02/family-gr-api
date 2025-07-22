// src/routes/gameRoutes.ts
import express from "express";
import { gameManager } from "../services/GameManager";

const router = express.Router();

router.get("/games", (req, res) => {
    // Get all registered game types
    const games = Array.from(gameManager["modules"].keys()).map((type) => ({
        type,
    }));
    res.json({ games });
});

export default router;
