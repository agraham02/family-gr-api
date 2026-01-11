// src/games/dominoes/helpers/board.ts

import { Tile, BoardEnd } from "../types";

export interface BoardState {
    tiles: Tile[]; // Tiles placed on board in order
    leftEnd: BoardEnd | null;
    rightEnd: BoardEnd | null;
}

/**
 * Initialize an empty board
 */
export function initializeBoard(): BoardState {
    return {
        tiles: [],
        leftEnd: null,
        rightEnd: null,
    };
}

/**
 * Check if a tile can be placed on the board at the specified side
 */
export function canPlaceTile(
    tile: Tile,
    board: BoardState,
    side: "left" | "right"
): boolean {
    // If board is empty, any tile can be placed
    if (board.tiles.length === 0) {
        return true;
    }

    const end = side === "left" ? board.leftEnd : board.rightEnd;
    if (!end) return false;

    // Tile can be placed if either of its values matches the end value
    return tile.left === end.value || tile.right === end.value;
}

/**
 * Check if a tile from a hand can be played on either end of the board
 */
export function canPlayTile(tile: Tile, board: BoardState): boolean {
    if (board.tiles.length === 0) return true;
    return (
        canPlaceTile(tile, board, "left") ||
        canPlaceTile(tile, board, "right")
    );
}

/**
 * Check if any tile in the hand can be played
 */
export function hasLegalMove(hand: Tile[], board: BoardState): boolean {
    return hand.some((tile) => canPlayTile(tile, board));
}

/**
 * Place a tile on the board at the specified side
 * Returns the updated board state
 */
export function placeTileOnBoard(
    tile: Tile,
    board: BoardState,
    side: "left" | "right"
): BoardState {
    // If board is empty, place the first tile
    if (board.tiles.length === 0) {
        return {
            tiles: [tile],
            leftEnd: { value: tile.left, tileId: tile.id },
            rightEnd: { value: tile.right, tileId: tile.id },
        };
    }

    // Determine which value of the tile should connect to the board
    const end = side === "left" ? board.leftEnd : board.rightEnd;
    if (!end) {
        throw new Error("Invalid board state");
    }

    // Determine the orientation of the tile based on which value matches
    // Note: We flip the tile representation to maintain consistent board layout
    // where the connecting value faces the board and new value faces outward
    let orientedTile = tile;
    let newEndValue: number;

    if (tile.left === end.value) {
        // Tile connects with its left side, so right side becomes the new end
        newEndValue = tile.right;
    } else if (tile.right === end.value) {
        // Tile connects with its right side, so left side becomes the new end
        // Create a flipped representation with the same ID for visual consistency
        orientedTile = { ...tile, left: tile.right, right: tile.left };
        newEndValue = tile.left;
    } else {
        throw new Error("Tile does not match board end");
    }

    // Update board state
    const newTiles =
        side === "left"
            ? [orientedTile, ...board.tiles]
            : [...board.tiles, orientedTile];

    const newEnd: BoardEnd = {
        value: newEndValue,
        tileId: tile.id,
    };

    return {
        tiles: newTiles,
        leftEnd: side === "left" ? newEnd : board.leftEnd,
        rightEnd: side === "right" ? newEnd : board.rightEnd,
    };
}
