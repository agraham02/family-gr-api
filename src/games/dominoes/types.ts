// src/games/dominoes/types.ts

export interface Tile {
    left: number; // 0-6 for double-six set
    right: number; // 0-6 for double-six set
    id: string; // unique identifier for the tile
}

export type DominoesPhase =
    | "playing"
    | "round-summary"
    | "finished";

export interface PlaceTileAction {
    type: "PLACE_TILE";
    playerId: string;
    tile: Tile;
    side: "left" | "right"; // which end of the board to place the tile
}

export interface PassAction {
    type: "PASS";
    playerId: string;
}

export interface BoardEnd {
    value: number; // The pip value at this end of the board
    tileId: string; // ID of the tile at this end
}
