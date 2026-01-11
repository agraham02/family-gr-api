# Family Game Room - TODO

This document outlines the features and improvements to be implemented for the Family Game Room application.

---

## 1. New Game: Left Right Center (LRC)

Add the classic dice game **Left Right Center** to the game room with a betting/chip system.

### Core Gameplay

- Implement the standard LRC dice game where players roll dice and pass chips left, right, or to the center based on the results
- The last player with chips remaining wins the pot

### Chip & Betting System

- Each player starts with a configurable number of chips (if the real game allows configuration; otherwise default to 3)
- Party leader can set the **monetary value per chip** via a slider in the lobby game settings
- Track earnings and winnings throughout the game
- At the end of the game, display a summary showing each player's net earnings/losses based on the chip value
- Players can choose to settle up in real money if they wish (no enforcement—just for fun tracking)

---

## 2. Game Settings System (done)

Improve and enforce the game settings infrastructure across all games.

### Party Leader Controls

- Ensure the party leader can view and modify **all available game settings** for the selected game in the lobby
- Settings UI should be intuitive and clearly indicate which options are available

### Real-Time Sync

- Ensure all players in the lobby can see game settings changes in real-time as the party leader modifies them
- Visual feedback should indicate when settings have been updated (no toast popup)

### Settings Enforcement

- Ensure all configured game settings are properly applied when the game starts
- Game logic must respect the settings throughout the entire game session

### Settings to Implement Per Game

#### Room Settings (Apply to All Games)

- **Private room toggle** – Prevent players from joining via room code (invite-only)

#### General Game Settings (Apply to All Games)

- **Score limit** – First team/player to reach X points wins (e.g., "First to 500")
- **Round limit** – Play a fixed number of rounds (e.g., "Play 5 rounds")
- **Turn time limit** – Maximum seconds allowed per turn (e.g., 30 seconds)

#### Spades-Specific Settings

- **Enable Jokers** – Toggle to include Big Joker and Little Joker in the deck
- **Deuce of Spades High** – Toggle to make the 2 of Spades the highest-ranking spade (above Ace of Spades)
- **Blind Nil allowed** – Toggle to allow/disallow Blind Nil bids (make sure feature is fully implemented and enforeced)
- **Nil allowed** – Toggle to allow/disallow Nil (zero) bids (make sure feature is fully implemented and enforeced)

#### Dominoes-Specific Settings

- **Game mode** – Toggle between team play (2v2) and individual play
- **Target score** – Points needed to win the game

#### Left Right Center-Specific Settings

- **Starting chips per player** – Number of chips each player begins with (if configurable)
- **Chip value** – Monetary value assigned to each chip (slider control)

---

## 3. Spades Improvements (done)

Ensure Spades is fully functional with proper logic, UI, and UX for all gameplay phases.

### Bidding

- **Blind Nil** – Implement the ability to bid Nil (zero tricks) before seeing your cards (both logic and UI). This is a comeback mechanic—only available when the team is down 100+ points. Award 200 points if successful, deduct 200 if they take any trick.
- **Nil (Zero) Bid** – Implement standard Nil bidding where a player bids zero tricks (both logic and UI). Award 100 points if successful, deduct 100 if they take any trick.
- **Blind Bids** – Implement the ability to bid any number of tricks (minimum 4) before seeing your cards without looking (both logic and UI). Only available when the team is down 100+ points. A blind bid scores **double** the normal contract points if successful, and double points if failed. Example: bid 6 tricks blind = 120 points if made, -120 if failed (vs normal bid 6 = 60 points if made, -60 if failed).
- Clear UI indication of who has bid Nil, Blind Nil, or Blind, including which restriction applies (e.g., "Blind Bid available—team is down 100+ points")
- Ensure that we give players the option to blindly bid before showing they cards if that option is available

### Trick Play

- Ensure proper trick logic is implemented and working correctly
- Clear visual feedback showing which cards have been played in the current trick
- Animate card plays appropriately
- Highlight the winning card of each trick

### End of Trick

- Display the trick result clearly before moving to the next trick
- Brief pause or confirmation before clearing the trick

### End of Round (Hand)

- Display end-of-round statistics before proceeding to the next round:
    - Tricks won by each team
    - Bid vs. actual tricks comparison
    - Points earned/lost this round
    - Bags accumulated
    - Running total scores
- Require player acknowledgment or timed transition before starting the next round

### End of Game

- Display comprehensive end-of-game statistics and summary:
    - Final scores
    - Game MVP or notable stats
    - Round-by-round breakdown
    - Bags accumulated throughout the game
- Players must be able to review the summary before being returned to the lobby

### Jokers Deck Variant

- Add option to play with **two Jokers** (Big Joker and Little Joker)
- When jokers are enabled:
    - **Big Joker** is the highest trump (beats everything)
    - **Little Joker** is the second-highest trump (below Big Joker, above Ace of Spades)
    - Remove the **2 of Clubs** and **2 of Diamonds** from the deck to maintain 52 cards
    - The **2 of Spades** and **2 of Hearts** remain in the deck
- Configurable via game settings toggle in the lobby

### Deuce of Spades High Variant

- Add option for **"Deuce of Spades High"** rule
- When enabled, the **2 of Spades** ranks as the highest spade (above Ace of Spades)
- If jokers are also enabled, the hierarchy is: Big Joker > Little Joker > 2 of Spades > Ace of Spades > King... etc.
- Configurable via game settings toggle in the lobby

---

## 4. Dominoes Improvements

Improve the Dominoes game to be fully playable with polished UI/UX.

### Game Variant

- Implement **Partner Dominoes** (Caribbean/Jamaican style) as the primary variant
- Support both **team play (2v2)** and **individual play (4 players)**
- Strictly 4 players required

### Core Gameplay

- Use a standard **double-six domino set** (28 tiles)
- Tiles are shuffled at the start of each round
- Each player draws/chooses (shown in real time with websockets, and avoid race conditions) their tiles from the shuffled set
- Player with the **double-six** goes first in the first round
- Winner of the previous round goes first in subsequent rounds
- Players play valid tiles matching the open ends of the board
- If a player has no valid move, they **pass their turn**
- Round ends when a player plays all their tiles or the game is blocked

### UI/UX Improvements

- **Tile sizing** – Ensure tiles are appropriately sized and readable on all screen sizes
- **Board layout** – Improve the visual layout of played tiles on the board (linked list/graph implementation?)
- **Tile placement** – Improve the interaction for selecting where to place a tile (which end of the board)
- **Animations** – Add smooth animations for drawing tiles, playing tiles, and passing turns
- **Player hand display** – Clear, organized display of tiles in each player's hand
- **Turn indicator** – Clear visual indication of whose turn it is

### End of Round

- Display end-of-round statistics before proceeding:
    - Points scored this round
    - How the round ended (player went out vs. blocked)
    - Pip counts of remaining tiles (for blocked games)
    - Running total scores
- Require player acknowledgment or timed transition before starting the next round

### End of Game

- Display comprehensive end-of-game statistics and summary:
    - Final scores
    - Round-by-round breakdown
    - Winning team/player
- Players must be able to review the summary before being returned to the lobby

---

## 5. Lobby & Game Session Management

Improve the flow between lobby and game states, handling player movement and interruptions gracefully.

### Fluid Lobby ↔ Game Transitions

- Model after online games with lobbies (Uno, Fortnite, Super Smash Bros, etc.)
- Players join a **room**, which contains a **lobby** and can instantiate a **game**
- Players should be able to move fluidly between lobby and game
- Players in a game should be able to **return to the lobby** at any time
- Players should be able to **join a lobby** at any time (unless kicked or room limit reached)
- Players should be able to **join a room/lobby even if a game is in progress**
- Lobby UI should indicate:
    - Whether a game is currently in progress
    - Which players are currently in the active game

### Game Interruption Handling

- When a player leaves mid-game, the game should **pause for all remaining players**
- Display a clear UI indicating the game is paused and who is missing
- Existing timeout logic for handling prolonged absences is already implemented

### Player Leave & Rejoin Scenarios

#### Handling Various Leave Methods

- Smoothly handle all forms of player departure:
    - Browser refresh
    - Navigating back to the lobby
    - Leaving the game/lobby/room intentionally
    - Closing the browser/tab
    - Network disconnection

#### Rejoining via Lobby URL (`/lobby/[code]`)

- If a player enters the lobby URL or backs out of a game:
    - They land in the lobby
    - They must **manually choose to rejoin** the active game if one is in progress
    - They do not automatically re-enter the game

#### Rejoining via Game URL (`/game/[code]`)

- If a player enters the game URL directly:
    - If local session data is saved, they are **automatically placed back** into their previous game position
    - The game resumes for them seamlessly

#### Missing Local Data

- If no local data is saved (e.g., player name is missing):
    - Display the **player name modal** prompting them to enter their name
    - Then proceed with appropriate lobby/game placement

### Ready System

- Players must **ready up** to start a new game from the lobby
- Players do **not** need to ready up to rejoin an active game in progress

---

## 6. Spectator Mode

Implement the ability for players to spectate active games.

### Joining as a Spectator

- Players in the lobby should be able to **spectate an active game** if one is in progress
- Clear UI option to "Watch Game" or similar

### Spectator View

- Spectators can only see **public information**:
    - Played cards/tiles on the board
    - Current scores
    - Whose turn it is
    - Game state (bidding, playing, round end, etc.)
- Spectators **cannot** see other players' hands or private information

### Spectator Restrictions

- Spectators are **silent observers** – no chat with active players
- Spectators cannot interact with the game in any way

### Transitioning from Spectator to Player

- If a spot opens up (player leaves and doesn't return), spectators can choose to **join as a player**
- This requires **explicit action** from the spectator – it is not automatic
- Once transitioned, standard player rules apply (may need to wait for appropriate game state to join)

### Spectator Limits

- Spectator count is limited by the overall **room capacity**
- Total players + spectators cannot exceed the room limit

---

## Notes

- This document covers **what** needs to be done, not **how** to implement it
- Implementation details, technical specifications, and API designs will be documented separately
- Features should be implemented and tested incrementally
