// src/models/Settings.ts
// Centralized settings interfaces for room-level and game-level settings

// ============================================================================
// Room Settings
// ============================================================================

export interface RoomSettings {
    maxPlayers?: number | null; // Room capacity (null = unlimited)
    pauseTimeoutSeconds?: number; // Seconds before auto-abort on pause (default: 120)
    isPrivate?: boolean; // Prevents join via room code (requires request to join)
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
    maxPlayers: null,
    pauseTimeoutSeconds: 120,
    isPrivate: false,
};

// ============================================================================
// Base Game Settings (all games inherit)
// ============================================================================

export interface BaseGameSettings {
    winTarget: number; // Score/points needed to win
    roundLimit: number | null; // Fixed number of rounds (null = disabled)
    turnTimeLimit: number | null; // Seconds per turn (null = unlimited)
}

// ============================================================================
// Spades Settings
// ============================================================================

export interface SpadesSettings extends BaseGameSettings {
    allowNil: boolean; // Standard nil bids allowed
    blindNilEnabled: boolean; // Blind nil (available when 100+ behind)
    blindBidEnabled: boolean; // Blind bids (available when 100+ behind)
    bagsPenalty: number; // Points deducted per 10 bags
    jokersEnabled: boolean; // Include Big/Little Joker in deck
    deuceOfSpadesHigh: boolean; // 2♠ ranks above A♠
}

export const DEFAULT_SPADES_SETTINGS: SpadesSettings = {
    winTarget: 500,
    roundLimit: null,
    turnTimeLimit: null,
    allowNil: false,
    blindNilEnabled: false,
    blindBidEnabled: true,
    bagsPenalty: -100,
    jokersEnabled: false,
    deuceOfSpadesHigh: false,
};

// ============================================================================
// Dominoes Settings
// ============================================================================

export type DominoesGameMode = "individual" | "team";

export interface DominoesSettings extends BaseGameSettings {
    gameMode: DominoesGameMode; // Play mode (individual or team)
    drawFromBoneyard: boolean; // Allow drawing vs passing
}

export const DEFAULT_DOMINOES_SETTINGS: DominoesSettings = {
    winTarget: 100,
    roundLimit: null,
    turnTimeLimit: null,
    gameMode: "individual",
    drawFromBoneyard: false,
};

// ============================================================================
// LRC Settings (placeholder for future)
// ============================================================================

export interface LRCSettings extends BaseGameSettings {
    startingChips: number; // Chips per player
    chipValue: number; // Dollar value per chip
}

export const DEFAULT_LRC_SETTINGS: LRCSettings = {
    winTarget: 1, // Last player with chips wins
    roundLimit: null,
    turnTimeLimit: null,
    startingChips: 3,
    chipValue: 0.25,
};

// ============================================================================
// Union Type
// ============================================================================

export type GameSettings = SpadesSettings | DominoesSettings | LRCSettings;

// For partial updates (all properties optional)
export type PartialGameSettings = Partial<SpadesSettings> &
    Partial<DominoesSettings> &
    Partial<LRCSettings>;

// ============================================================================
// Setting Definition (for dynamic UI generation)
// ============================================================================

export type SettingType = "boolean" | "number" | "select" | "nullableNumber";

export type SettingCategory = "general" | "scoring" | "rules" | "advanced";

export interface SelectOption {
    value: string;
    label: string;
}

export interface SettingDependency {
    key: string;
    value: unknown;
}

export interface SettingDefinition {
    key: string; // Property name in settings object
    label: string; // Display label
    description: string; // Tooltip/help text
    type: SettingType; // Control type
    default: unknown; // Default value
    category: SettingCategory; // Grouping
    // Number type constraints
    min?: number;
    max?: number;
    step?: number;
    // Select type options
    options?: SelectOption[];
    // Conditional visibility
    dependsOn?: SettingDependency;
    // Display formatting
    suffix?: string; // e.g., "points", "seconds"
}

// ============================================================================
// Spades Settings Definitions
// ============================================================================

export const SPADES_SETTINGS_DEFINITIONS: SettingDefinition[] = [
    // Scoring category
    {
        key: "winTarget",
        label: "Win Target",
        description: "First team to reach this score wins the game.",
        type: "number",
        default: 500,
        category: "scoring",
        min: 100,
        max: 1000,
        step: 50,
        suffix: "points",
    },
    {
        key: "bagsPenalty",
        label: "Bags Penalty",
        description:
            "Points deducted when a team accumulates 10 overtricks (bags). Set to 0 to disable.",
        type: "number",
        default: -100,
        category: "scoring",
        min: -200,
        max: 0,
        step: 10,
        suffix: "points",
    },
    // Rules category
    {
        key: "allowNil",
        label: "Allow Nil Bids",
        description:
            "Players can bid nil (0 tricks). Making nil earns +100 points, failing costs -100 points.",
        type: "boolean",
        default: false,
        category: "rules",
    },
    {
        key: "blindNilEnabled",
        label: "Allow Blind Nil",
        description:
            "Players can bid blind nil before seeing their cards. Worth +200 if made, -200 if failed. Only available when team is 100+ points behind.",
        type: "boolean",
        default: false,
        category: "rules",
        dependsOn: { key: "allowNil", value: true },
    },
    {
        key: "blindBidEnabled",
        label: "Allow Blind Bids",
        description:
            "Players can make blind bids (min 4 tricks) before seeing their cards. Scores double points. Only available when team is 100+ points behind.",
        type: "boolean",
        default: true,
        category: "rules",
    },
    // Advanced category
    {
        key: "jokersEnabled",
        label: "Enable Jokers",
        description:
            "Include Big Joker and Little Joker as the highest trumps. 2♣ and 2♦ are removed to maintain 52 cards.",
        type: "boolean",
        default: false,
        category: "advanced",
    },
    {
        key: "deuceOfSpadesHigh",
        label: "Deuce of Spades High",
        description:
            "The 2♠ ranks as the highest spade, above the Ace of Spades.",
        type: "boolean",
        default: false,
        category: "advanced",
    },
    // General category
    {
        key: "roundLimit",
        label: "Round Limit",
        description:
            "End the game after a fixed number of rounds. Highest score wins.",
        type: "nullableNumber",
        default: null,
        category: "general",
        min: 1,
        max: 20,
        step: 1,
        suffix: "rounds",
    },
    {
        key: "turnTimeLimit",
        label: "Turn Time Limit",
        description:
            "Maximum seconds allowed per turn. Player auto-plays if time expires.",
        type: "nullableNumber",
        default: null,
        category: "general",
        min: 5,
        max: 120,
        step: 5,
        suffix: "seconds",
    },
];

// ============================================================================
// Dominoes Settings Definitions
// ============================================================================

export const DOMINOES_SETTINGS_DEFINITIONS: SettingDefinition[] = [
    // Scoring category
    {
        key: "winTarget",
        label: "Win Target",
        description: "First player/team to reach this score wins the game.",
        type: "number",
        default: 100,
        category: "scoring",
        min: 50,
        max: 500,
        step: 25,
        suffix: "points",
    },
    // Rules category
    {
        key: "gameMode",
        label: "Game Mode",
        description: "Choose between individual play or partner teams.",
        type: "select",
        default: "individual",
        category: "rules",
        options: [
            { value: "individual", label: "Individual (4 players)" },
            { value: "team", label: "Partners (2v2)" },
        ],
    },
    {
        key: "drawFromBoneyard",
        label: "Draw from Boneyard",
        description:
            "When enabled, players can draw tiles from the boneyard instead of passing. Caribbean block dominoes traditionally has this disabled.",
        type: "boolean",
        default: false,
        category: "rules",
    },
    // General category
    {
        key: "roundLimit",
        label: "Round Limit",
        description:
            "End the game after a fixed number of rounds. Highest score wins.",
        type: "nullableNumber",
        default: null,
        category: "general",
        min: 1,
        max: 20,
        step: 1,
        suffix: "rounds",
    },
    {
        key: "turnTimeLimit",
        label: "Turn Time Limit",
        description:
            "Maximum seconds allowed per turn. Player auto-passes if time expires.",
        type: "nullableNumber",
        default: null,
        category: "general",
        min: 5,
        max: 120,
        step: 5,
        suffix: "seconds",
    },
];

// ============================================================================
// LRC Settings Definitions (placeholder)
// ============================================================================

export const LRC_SETTINGS_DEFINITIONS: SettingDefinition[] = [
    {
        key: "startingChips",
        label: "Starting Chips",
        description: "Number of chips each player begins with.",
        type: "number",
        default: 3,
        category: "rules",
        min: 1,
        max: 10,
        step: 1,
        suffix: "chips",
    },
    {
        key: "chipValue",
        label: "Chip Value",
        description: "Monetary value assigned to each chip for tracking.",
        type: "number",
        default: 0.25,
        category: "rules",
        min: 0,
        max: 10,
        step: 0.25,
        suffix: "$",
    },
];
