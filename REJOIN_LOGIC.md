# Rejoin Logic Documentation

## Overview

This document describes the rejoin functionality that allows players to reconnect to an ongoing game after a disconnection without disrupting other players.

## How It Works

### User Disconnection

When a user disconnects during an active game:

1. **User is marked as disconnected** - The user's `isConnected` flag is set to `false`, but they remain in the room
2. **GameManager is notified** - The game-specific disconnect handler is called (if implemented)
3. **Minimum player check** - The system checks if enough players remain connected to continue
4. **Game pause (if needed)** - If minimum players are not met, the game is paused and a `game_paused` event is emitted
5. **User disconnection event** - A `user_disconnected` event is emitted to notify other players

### User Reconnection

When a disconnected user rejoins:

1. **Join with same userId** - User calls the join endpoint with their original userId
2. **Socket registration** - When the socket joins the room, the system detects the rejoin scenario
3. **User reconnection** - The user's `isConnected` flag is set back to `true`
4. **GameManager is notified** - The game-specific reconnect handler is called (if implemented)
5. **Game resume check** - If enough players are now connected and the game was paused, it resumes
6. **User reconnection event** - A `user_reconnected` event is emitted to notify other players

### Game Pause Behavior

The game is paused when:
- A player disconnects AND
- The number of connected players falls below the minimum required for that game

When paused:
- Players cannot take game actions (will receive an error: "Game is paused. Waiting for players to rejoin.")
- The room state includes `isPaused: true`
- A `game_paused` event is emitted with reason "waiting_for_players"

The game resumes when:
- A disconnected player reconnects AND
- The number of connected players meets or exceeds the minimum required
- A `game_resumed` event is emitted

## Events

### New Socket Events

#### `user_disconnected`
Emitted when a player disconnects during an active game.
```typescript
{
  event: "user_disconnected",
  roomState: Room,
  userName?: string,
  userId: string,
  timestamp: string
}
```

#### `user_reconnected`
Emitted when a player rejoins an active game.
```typescript
{
  event: "user_reconnected",
  roomState: Room,
  userName?: string,
  userId: string,
  timestamp: string
}
```

#### `game_paused`
Emitted when the game is paused due to insufficient connected players.
```typescript
{
  event: "game_paused",
  roomState: Room,
  userName?: string,
  reason: "waiting_for_players",
  timestamp: string
}
```

#### `game_resumed`
Emitted when the game resumes after a paused state.
```typescript
{
  event: "game_resumed",
  roomState: Room,
  userName?: string,
  timestamp: string
}
```

## Game-Specific Implementation

### GameModule Interface

Game modules can implement optional methods to handle disconnection/reconnection:

```typescript
interface GameModule {
  // ... existing methods ...
  
  // Optional: Check if enough players are connected to continue
  checkMinimumPlayers?(state: GameState): boolean;
  
  // Optional: Handle player reconnection
  handlePlayerReconnect?(state: GameState, userId: string): GameState;
  
  // Optional: Handle player disconnection
  handlePlayerDisconnect?(state: GameState, userId: string): GameState;
}
```

### Spades Implementation

For Spades (a 4-player game):
- **Minimum players**: All 4 players must be connected
- **Behavior**: Game pauses when any player disconnects
- **Validation**: Disconnected players cannot place bids or play cards
- **State preservation**: Player hands, bids, and game state are preserved during disconnection

## Client Integration

### Handling Disconnection

Clients should:
1. Store the userId locally (localStorage, cookies, etc.)
2. Listen for `user_disconnected` events to update UI
3. Show appropriate UI when game is paused

### Handling Reconnection

Clients should:
1. Use the stored userId when rejoining a room
2. Call the join endpoint with the same userId
3. Listen for `user_reconnected` and `game_resumed` events
4. Request current game state after reconnection

### Example Flow

```javascript
// On initial join
const userId = generateUserId();
localStorage.setItem('userId', userId);
joinRoom(roomCode, userName, userId);

// On reconnection
const userId = localStorage.getItem('userId');
if (userId) {
  joinRoom(roomCode, userName, userId);
  socket.emit('get_game_state', { roomId, userId });
}

// Listen for rejoin events
socket.on('room_event', (payload) => {
  if (payload.event === 'user_disconnected') {
    showDisconnectedUser(payload.userName);
  } else if (payload.event === 'game_paused') {
    showGamePausedScreen();
  } else if (payload.event === 'game_resumed') {
    hideGamePausedScreen();
  } else if (payload.event === 'user_reconnected') {
    showReconnectedUser(payload.userName);
  }
});
```

## Technical Details

### Connection Status Tracking

- `User.isConnected`: Boolean flag indicating connection status
  - `true` = user is connected
  - `false` = user is disconnected
  - `undefined` = treated as connected (for backward compatibility)
  - When games start, all users are explicitly set to `isConnected: true`
- `Room.isPaused`: Boolean flag indicating if the game is paused due to disconnections

### Lobby vs In-Game Behavior

**Lobby State:**
- Users are completely removed from the room on disconnect
- Cannot rejoin with same userId after disconnect
- Room follows original behavior

**In-Game State:**
- Users are marked as disconnected but remain in the room
- Can rejoin with same userId
- Game state is preserved
- Game may pause based on player count

## Future Enhancements

Potential improvements for the rejoin system:

1. **Bot Players**: Implement AI bots to play for disconnected players when enough players remain
2. **Timeout Logic**: Automatically remove players who remain disconnected for too long
3. **Reconnection UI**: Show countdown timers or status indicators
4. **Game-Specific Strategies**: Allow games to implement custom pause/resume logic
5. **Partial Resume**: Allow games to continue with fewer players if game rules permit
