// src/routes/gameRoutes.ts
import express from "express";
import { gameManager } from "../services/GameManager";

const router = express.Router();

router.get("/games", (req, res) => {
    // Get all registered game modules and their metadata
    const games = Array.from(gameManager.getAllModules().entries()).map(
        ([type, module]) => {
            // Fallback if metadata is missing
            return module.metadata
                ? module.metadata
                : { type, displayName: type, requiresTeams: false };
        }
    );
    res.json({ games });
});

export default router;
