import { SpadesState, Trick, SpadesSettings } from "../index";
import { Bid } from "../types";

interface TeamScoreBreakdown {
    previousScore: number;
    tricksWon: number;
    bid: number;
    basePoints: number; // bid * 10 (or negative if failed)
    bags: number; // overtricks this round
    bagPoints: number; // +1 per bag
    bagPenalty: number; // -100 if accumulated 10+ bags
    nilBonus: number; // +100 per successful nil
    nilPenalty: number; // -100 per failed nil
    roundScore: number; // total points gained/lost this round
    newScore: number; // final score after round
}

interface ScoreResult {
    teamScores: Record<number, number>;
    bags: Record<number, number>;
    roundDetails: {
        tricksWon: Record<number, number>;
        bids: Record<number, number>;
        nilSuccess: Record<number, boolean>;
    };
    scoreBreakdown: Record<number, TeamScoreBreakdown>;
}

/**
 * Calculates scores for a completed Spades round.
 * @param state The SpadesState at end of round
 * @returns ScoreResult with team scores, bags, and detailed breakdown
 */
export function calculateSpadesScores(state: SpadesState): ScoreResult {
    const { teams, completedTricks, bids, settings } = state;

    // Initialize per-team tracking
    const tricksWon: Record<number, number> = {};
    const teamBids: Record<number, number> = {};
    const nilSuccess: Record<number, boolean> = {};
    const scoreBreakdown: Record<number, TeamScoreBreakdown> = {};

    // Map player to team
    const playerTeam: Record<string, number> = {};
    Object.entries(teams).forEach(([teamId, team]) => {
        const numId = Number(teamId);
        playerTeam[team.players[0]] = numId;
        playerTeam[team.players[1]] = numId;

        tricksWon[numId] = 0;
        teamBids[numId] = 0;
        nilSuccess[numId] = true; // Assume success until proven otherwise

        // Initialize breakdown
        scoreBreakdown[numId] = {
            previousScore: team.score,
            tricksWon: 0,
            bid: 0,
            basePoints: 0,
            bags: 0,
            bagPoints: 0,
            bagPenalty: 0,
            nilBonus: 0,
            nilPenalty: 0,
            roundScore: 0,
            newScore: team.score,
        };
    });

    // Count tricks won per team
    completedTricks.forEach((trick: Trick) => {
        if (trick.winnerId) {
            const teamId = playerTeam[trick.winnerId];
            tricksWon[teamId]++;
        }
    });

    // Process nil bids first
    Object.entries(bids).forEach(([playerId, bid]: [string, Bid]) => {
        const teamId = playerTeam[playerId];
        if (bid.type === "nil") {
            const playerTricks = completedTricks.filter(
                (trick) => trick.winnerId === playerId
            ).length;

            if (playerTricks === 0) {
                // Successful nil: +100 points
                scoreBreakdown[teamId].nilBonus += 100;
            } else {
                // Failed nil: -100 points
                scoreBreakdown[teamId].nilPenalty += 100;
                nilSuccess[teamId] = false;
            }
        } else {
            // Regular bid - add to team total
            teamBids[teamId] += bid.amount;
        }
    });

    // Update breakdown with bid totals and tricks
    Object.keys(teams).forEach((teamIdStr) => {
        const teamId = Number(teamIdStr);
        scoreBreakdown[teamId].bid = teamBids[teamId];
        scoreBreakdown[teamId].tricksWon = tricksWon[teamId];
    });

    // Score regular bids
    const teamBags: Record<number, number> = {};
    Object.keys(teams).forEach((teamIdStr) => {
        const teamId = Number(teamIdStr);
        const bid = teamBids[teamId];
        const tricks = tricksWon[teamId];
        teamBags[teamId] = 0;

        if (bid > 0) {
            if (tricks >= bid) {
                // Made bid
                scoreBreakdown[teamId].basePoints = bid * 10;
                const bags = tricks - bid;
                scoreBreakdown[teamId].bags = bags;
                scoreBreakdown[teamId].bagPoints = bags; // +1 per bag
                teamBags[teamId] = bags;
            } else {
                // Failed bid
                scoreBreakdown[teamId].basePoints = -(bid * 10);
            }
        }

        // Check for bag penalty (10+ accumulated bags)
        // Note: We need to track accumulated bags across rounds
        // For now, we apply penalty if this round's bags push us over 10
        // This is simplified - ideally we'd track cumulative bags in game state
        if (teamBags[teamId] >= 10) {
            scoreBreakdown[teamId].bagPenalty = Math.abs(settings.bagsPenalty);
            teamBags[teamId] -= 10;
        }
    });

    // Calculate final scores
    const teamScores: Record<number, number> = {};
    Object.keys(teams).forEach((teamIdStr) => {
        const teamId = Number(teamIdStr);
        const breakdown = scoreBreakdown[teamId];

        breakdown.roundScore =
            breakdown.basePoints +
            breakdown.bagPoints +
            breakdown.nilBonus -
            breakdown.nilPenalty -
            breakdown.bagPenalty;

        breakdown.newScore = breakdown.previousScore + breakdown.roundScore;
        teamScores[teamId] = breakdown.newScore;
    });

    return {
        teamScores,
        bags: teamBags,
        roundDetails: {
            tricksWon,
            bids: teamBids,
            nilSuccess,
        },
        scoreBreakdown,
    };
}
