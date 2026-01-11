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

/**
 * GET /games/:type/settings
 * Returns the settings schema (definitions) and default values for a game type.
 * Used by clients to dynamically generate settings forms.
 */
router.get("/games/:type/settings", (req, res) => {
    const { type } = req.params;

    const settingsData = gameManager.getSettingsForGame(type);

    if (!settingsData) {
        return res.status(404).json({
            error: `Game type '${type}' not found`,
        });
    }

    res.json(settingsData);
});

export default router;
