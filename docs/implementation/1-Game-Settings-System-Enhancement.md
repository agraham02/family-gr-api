# 1. Game Settings System Enhancement

## Overview

This document provides precise implementation details for extending the game settings infrastructure to support all games consistently, with proper real-time sync, UI controls, and enforcement.

---

## Current State Analysis

### Existing Architecture

**API Settings Types** (`src/models/Room.ts`):

```typescript
interface RoomSettings {
    maxPlayers?: number;
    pauseTimeoutSeconds?: number;
}

interface GameSettings {
    winTarget?: number;
    drawFromBoneyard?: boolean; // Dominoes
    allowNil?: boolean; // Spades
    blindNilEnabled?: boolean; // Spades
    bagsPenalty?: number; // Spades
}
```

**Game-Specific Settings** (each game extends `GameSettings`):

- `SpadesSettings` in `src/games/spades/index.ts`
- `DominoesSettings` in `src/games/dominoes/index.ts`

**Settings Flow**:

1. Leader updates settings via `updateGameSettings()` in RoomService
2. Server merges into `room.gameSettings` and emits `game_settings_updated`
3. On `startGame()`, settings passed to `gameManager.createGame(type, room, customSettings)`
4. Game module `init()` merges `customSettings` with `DEFAULT_SETTINGS`

**Client Settings UI** (`src/components/lobby/GameSettingsCard.tsx`):

- Renders game-specific forms based on `gameType`
- Uses local component types `DominoesSettings` and `SpadesSettings`
- Leader-only editing enforced via `disabled` prop

---

## Target Architecture

### 1. Unified Settings Type System

**Goal**: Single source of truth for settings types shared between API and all game modules.

#### File: `src/models/Settings.ts` (NEW)

```
Purpose: Centralized settings interfaces for room-level and game-level settings.
```

**RoomSettings Interface**:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxPlayers` | `number \| null` | `null` | Room capacity (null = unlimited) |
| `pauseTimeoutSeconds` | `number` | `120` | Seconds before auto-abort on pause |
| `isPrivate` | `boolean` | `false` | Prevents join via room code |

**BaseGameSettings Interface** (all games inherit):
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `winTarget` | `number` | varies | Score/points to win |
| `roundLimit` | `number \| null` | `null` | Fixed number of rounds (null = disabled) |
| `turnTimeLimit` | `number \| null` | `null` | Seconds per turn (null = unlimited) |

**SpadesSettings Interface** (extends BaseGameSettings):
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `winTarget` | `number` | `500` | Points to win |
| `allowNil` | `boolean` | `true` | Standard nil bids allowed |
| `blindNilEnabled` | `boolean` | `false` | Blind nil (100+ behind only) |
| `blindBidEnabled` | `boolean` | `false` | Blind bids (100+ behind only) |
| `bagsPenalty` | `number` | `-100` | Points deducted per 10 bags |
| `jokersEnabled` | `boolean` | `false` | Include Big/Little Joker |
| `deuceOfSpadesHigh` | `boolean` | `false` | 2♠ ranks above A♠ |

**DominoesSettings Interface** (extends BaseGameSettings):
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `winTarget` | `number` | `100` | Points to win |
| `gameMode` | `"individual" \| "team"` | `"individual"` | Play mode |
| `drawFromBoneyard` | `boolean` | `false` | Allow drawing vs passing |

**LRCSettings Interface** (extends BaseGameSettings) - placeholder for future:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `startingChips` | `number` | `3` | Chips per player |
| `chipValue` | `number` | `0.25` | Dollar value per chip |

**GameSettings Union Type**:

```
type GameSettings = SpadesSettings | DominoesSettings | LRCSettings;
```

---

### 2. Settings Metadata System

**Goal**: Each game module exports settings metadata for dynamic UI generation.

#### Interface: `SettingDefinition`

```
Purpose: Describes a single setting for UI rendering.
```

| Property      | Type                                              | Description                      |
| ------------- | ------------------------------------------------- | -------------------------------- |
| `key`         | `string`                                          | Property name in settings object |
| `label`       | `string`                                          | Display label                    |
| `description` | `string`                                          | Tooltip/help text                |
| `type`        | `"boolean" \| "number" \| "select"`               | Control type                     |
| `default`     | `any`                                             | Default value                    |
| `min`         | `number`                                          | For number type: minimum         |
| `max`         | `number`                                          | For number type: maximum         |
| `step`        | `number`                                          | For number type: increment       |
| `options`     | `{value: string, label: string}[]`                | For select type                  |
| `dependsOn`   | `{key: string, value: any}`                       | Conditional visibility           |
| `category`    | `"general" \| "scoring" \| "rules" \| "advanced"` | Grouping                         |

#### GameModule Metadata Extension

Add to `GameModule.metadata`:

```
settingsDefinitions: SettingDefinition[];
defaultSettings: GameSettings;
```

**Spades Settings Definitions**:

1. **winTarget**: number, min=100, max=1000, step=50, category="scoring"
2. **allowNil**: boolean, category="rules"
3. **blindNilEnabled**: boolean, dependsOn={key: "allowNil", value: true}, category="rules"
4. **blindBidEnabled**: boolean, category="rules"
5. **bagsPenalty**: number, min=-200, max=0, step=10, category="scoring"
6. **jokersEnabled**: boolean, category="advanced"
7. **deuceOfSpadesHigh**: boolean, category="advanced"
8. **roundLimit**: number|null, min=1, max=20, category="general"
9. **turnTimeLimit**: number|null, min=10, max=120, step=5, category="general"

**Dominoes Settings Definitions**:

1. **winTarget**: number, min=50, max=500, step=25, category="scoring"
2. **gameMode**: select, options=[{value: "individual", label: "Individual (4 players)"}, {value: "team", label: "Partners (2v2)"}], category="rules"
3. **drawFromBoneyard**: boolean, category="rules"
4. **roundLimit**: number|null, category="general"
5. **turnTimeLimit**: number|null, category="general"

---

### 3. API Changes

#### File: `src/models/Room.ts`

**Changes**:

1. Import settings from `./Settings.ts`
2. Remove inline `RoomSettings` and `GameSettings` interfaces
3. Use imported types

#### File: `src/services/GameManager.ts`

**Changes**:

1. Update `GameModule` interface:
    - Add `metadata.settingsDefinitions: SettingDefinition[]`
    - Add `metadata.defaultSettings: GameSettings`
2. Add method `getSettingsForGame(type: string): {definitions: SettingDefinition[], defaults: GameSettings}`

#### File: `src/services/RoomService.ts`

**Changes to `updateGameSettings()`**:

1. Validate settings against game module's `settingsDefinitions`
2. Coerce types (numbers as numbers, booleans as booleans)
3. Clamp values to min/max ranges
4. Apply defaults for missing properties

**Add validation function**:

```
function validateGameSettings(
    gameType: string,
    settings: Partial<GameSettings>
): GameSettings
```

Logic:

- Get definitions from game module
- For each definition: validate type, apply constraints, use default if missing
- Return fully-typed settings object

#### File: `src/routes/gameRoutes.ts`

**Add endpoint**:

```
GET /games/:type/settings
```

Response:

```json
{
  "definitions": [...],
  "defaults": {...}
}
```

Purpose: Client fetches settings schema for dynamic form generation.

---

### 4. Game Module Updates

#### File: `src/games/spades/index.ts`

**Changes**:

1. Move `SpadesSettings` to `src/models/Settings.ts`
2. Export `SPADES_SETTINGS_DEFINITIONS: SettingDefinition[]`
3. Add to `SPADES_METADATA`:
    - `settingsDefinitions: SPADES_SETTINGS_DEFINITIONS`
    - `defaultSettings: DEFAULT_SETTINGS`

**New Settings to Add**:

- `jokersEnabled`: boolean (default false)
- `deuceOfSpadesHigh`: boolean (default false)
- `blindBidEnabled`: boolean (default false)
- `roundLimit`: number | null (default null)
- `turnTimeLimit`: number | null (default null)

#### File: `src/games/dominoes/index.ts`

**Changes**:

1. Move `DominoesSettings` to `src/models/Settings.ts`
2. Export `DOMINOES_SETTINGS_DEFINITIONS: SettingDefinition[]`
3. Add to `DOMINOES_METADATA`:
    - `settingsDefinitions: DOMINOES_SETTINGS_DEFINITIONS`
    - `defaultSettings: DEFAULT_SETTINGS`

**New Settings to Add**:

- `gameMode`: "individual" | "team" (default "individual")
- `roundLimit`: number | null (default null)
- `turnTimeLimit`: number | null (default null)

---

### 5. Client Changes

#### File: `src/types/lobby/index.ts`

**Changes**:

1. Replace inline settings interfaces with comprehensive types
2. Add `SettingDefinition` interface (mirror from API)
3. Update `GameSettings` to be union of all game settings

#### File: `src/components/lobby/GameSettingsCard.tsx`

**Complete Rewrite Approach**:

1. **Remove** hardcoded form components (`DominoesSettingsForm`, `SpadesSettingsForm`)
2. **Add** dynamic form renderer based on settings definitions

**New Component Structure**:

```
GameSettingsCard
├── useFetchSettingsDefinitions(gameType) // Fetch from /games/:type/settings
├── SettingsForm
│   ├── SettingsCategoryGroup (for each category)
│   │   ├── SettingControl (for each definition)
│   │   │   ├── BooleanSetting (Switch)
│   │   │   ├── NumberSetting (Slider)
│   │   │   └── SelectSetting (Select/RadioGroup)
```

**SettingControl Component**:

Props:

- `definition: SettingDefinition`
- `value: any`
- `onChange: (key: string, value: any) => void`
- `disabled: boolean`
- `allSettings: GameSettings` (for dependsOn checks)

Logic:

1. Check `dependsOn` - if parent condition not met, don't render
2. Based on `type`, render appropriate control
3. For numbers: use Slider with min/max/step
4. For booleans: use Switch
5. For selects: use RadioGroup or Select

**Caching**:

- Cache settings definitions per game type
- Only fetch once per game type selection

#### File: `src/services/lobby.ts` (or new file)

**Add function**:

```typescript
async function fetchGameSettingsSchema(gameType: string): Promise<{
    definitions: SettingDefinition[];
    defaults: GameSettings;
}>;
```

---

### 6. Real-Time Sync

**Current Implementation** (already works):

1. Leader calls `updateGameSettings` socket event
2. Server updates `room.gameSettings`
3. Server emits `game_settings_updated` to room
4. Clients update local state via `useRoomEvents`

**Enhancement Needed**:

The current sync is correct. Ensure client `LobbyData` type includes full `gameSettings` in `roomState` on every event.

**Verification Points**:

- `emitRoomEvent` includes `roomState` with current `gameSettings`
- `useRoomEvents` hook updates context with new settings
- `GameSettingsCard` receives settings from context (not local state)

---

### 7. Settings Enforcement

**Goal**: Ensure all configured settings are respected during gameplay.

#### Turn Time Limit

**API Implementation** (`src/games/shared/turnTimer.ts` - NEW):

```
Purpose: Generic turn timer that games can use.
```

**Interface**:

```typescript
interface TurnTimer {
    startTurn(gameId: string, playerId: string, timeoutSeconds: number): void;
    cancelTurn(gameId: string): void;
    getRemainingTime(gameId: string): number | null;
}
```

**Integration Points**:

- Start timer when turn begins (after action resolves to new player)
- Cancel timer when valid action received
- On timeout: auto-pass or forfeit depending on game

**Spades Timeout Behavior**:

- Bidding phase: Auto-bid lowest legal value (0 if nil allowed, else 1)
- Playing phase: Auto-play first legal card

**Dominoes Timeout Behavior**:

- Auto-pass turn

**Client**:

- Display countdown timer on current player
- Visual/audio warning at 10 seconds remaining

#### Round Limit

**Enforcement Location**: Each game's reducer, after round scoring.

**Logic** (pseudo-code):

```
if (settings.roundLimit !== null && state.round >= settings.roundLimit) {
    // Determine winner by current scores
    // Transition to "finished" phase
}
```

#### Win Target

**Already Implemented**: Both games check `settings.winTarget` in scoring logic.

**Verification**: Ensure new settings flow doesn't break existing checks.

---

### 8. Room-Level Settings

#### Private Room Toggle

**API Changes**:

1. Add `isPrivate: boolean` to `RoomSettings`
2. In `joinRoom()` (RoomService.ts):
    - If `room.settings?.isPrivate === true`
    - Reject join with error: "This room is private. You need an invite to join."

**Client Changes**:

1. Add toggle in room settings UI (separate from game settings)
2. Display lock icon on private rooms

**Invite System** (simplified):

- Private rooms still have a code
- Code can only be shared manually by players in room
- No "find public rooms" feature exists, so private toggle mainly prevents accidental joins if code is leaked

---

## Implementation Order

1. **Phase 1: Type System**
    - Create `src/models/Settings.ts`
    - Update imports in Room.ts, GameManager.ts
    - Add SettingDefinition interface

2. **Phase 2: Settings Metadata**
    - Add settings definitions to Spades module
    - Add settings definitions to Dominoes module
    - Add API endpoint for settings schema

3. **Phase 3: Client Dynamic Form**
    - Create SettingControl components
    - Rewrite GameSettingsCard to use definitions
    - Add settings schema fetching

4. **Phase 4: New Settings**
    - Add all new setting properties
    - Update default values
    - Update validation

5. **Phase 5: Enforcement**
    - Implement turn timer system
    - Add round limit checks
    - Add private room logic

---

## File Change Summary

### API (family-gr-api)

| File                            | Action | Changes                                         |
| ------------------------------- | ------ | ----------------------------------------------- |
| `src/models/Settings.ts`        | CREATE | All settings interfaces, SettingDefinition      |
| `src/models/Room.ts`            | MODIFY | Import from Settings.ts, remove inline types    |
| `src/services/GameManager.ts`   | MODIFY | Add metadata types, getSettingsForGame()        |
| `src/services/RoomService.ts`   | MODIFY | Add validateGameSettings(), update joinRoom()   |
| `src/routes/gameRoutes.ts`      | MODIFY | Add GET /games/:type/settings                   |
| `src/games/spades/index.ts`     | MODIFY | Add SPADES_SETTINGS_DEFINITIONS, new settings   |
| `src/games/dominoes/index.ts`   | MODIFY | Add DOMINOES_SETTINGS_DEFINITIONS, new settings |
| `src/games/shared/turnTimer.ts` | CREATE | Turn timeout logic                              |

### Client (family-gr-client)

| File                                               | Action  | Changes                                    |
| -------------------------------------------------- | ------- | ------------------------------------------ |
| `src/types/lobby/index.ts`                         | MODIFY  | Update GameSettings, add SettingDefinition |
| `src/types/games/spades/index.ts`                  | MODIFY  | Update SpadesSettings                      |
| `src/types/games/dominoes/index.ts`                | MODIFY  | Update DominoesSettings                    |
| `src/components/lobby/GameSettingsCard.tsx`        | REWRITE | Dynamic form based on definitions          |
| `src/components/lobby/settings/SettingControl.tsx` | CREATE  | Individual setting renderer                |
| `src/components/lobby/settings/BooleanSetting.tsx` | CREATE  | Switch component                           |
| `src/components/lobby/settings/NumberSetting.tsx`  | CREATE  | Slider component                           |
| `src/components/lobby/settings/SelectSetting.tsx`  | CREATE  | Select component                           |
| `src/services/gameSettings.ts`                     | CREATE  | fetchGameSettingsSchema()                  |
| `src/hooks/useGameSettingsSchema.ts`               | CREATE  | Hook for fetching/caching schema           |

---

## Validation Rules

### Number Settings

- Must be within `[min, max]` range
- Must be multiple of `step`
- Null allowed only if setting supports it

### Boolean Settings

- Must be `true` or `false`
- Coerce strings "true"/"false" to boolean

### Select Settings

- Value must be one of defined `options[].value`

### Dependency Resolution

- If `dependsOn.key` setting doesn't match `dependsOn.value`, setting is ignored and default is used
- Example: `blindNilEnabled` requires `allowNil === true`

---

## Edge Cases

1. **Game type changed while settings open**
    - Clear current settings
    - Load new game's defaults
    - Fetch new definitions

2. **Invalid settings from malicious client**
    - Server validates all settings before storing
    - Rejects invalid values with error message
    - Never trust client-sent settings

3. **Settings changed during active game**
    - Settings are locked once game starts
    - UI should disable settings when `room.state === "in-game"`

4. **Missing settings on game start**
    - Server applies game's default settings
    - Merge order: defaults → room.gameSettings → customSettings
