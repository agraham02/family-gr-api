// src/games/shared/shuffle.ts

/**
 * Fisher-Yates shuffle (unbiased, O(n)).
 * Generic implementation that works with any array type.
 * Keep randomness *only* here so the rest of the engine is replayable.
 */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
