# Gold Digger

## 🎮 Play Online
https://mysticalg.github.io/Gold-Digger/

Gold Digger is a retro-style browser mining game with a looping world, upgrade progression, fog-of-war exploration, and surface landmark interactions.

## Quick Start
1. Open the game link above.
2. Pick an archaeological site.
3. Press **Start Dig**.
4. Move with **Arrow Keys** or **WASD**.

## Help / Controls
- **Move:** `← ↑ → ↓` or `W A S D`
- **Bomb:** `Space`
- **Rest at cottage:** `R` (when standing on 🛖)
- **Toggle zoom:** `Z`
- **Toggle sound:** `M`

## Core Gameplay Notes
- The world loops horizontally, so moving past one side wraps to the other.
- Surface landmarks (🛖 cottage and 🛒 shop) are world objects and can drop if their support is mined away.
- Grass spreads only into adjacent empty tiles (including diagonals) when that tile has sand directly underneath.
- Return to the cottage to refill stamina.
- Buy upgrades while standing on the shop tile.

## Local Development
If you want to run locally:

```bash
python3 -m http.server 4173
```

Then open: `http://127.0.0.1:4173`
