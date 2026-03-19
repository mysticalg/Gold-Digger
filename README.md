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
- **Rest at cottage:** automatic while standing on 🛖 (or press `R`)
- **Toggle zoom:** `Z`
- **Toggle sound:** `M`
- **Use/collect water:** `Q` or Water button

## Core Gameplay Notes
- The world loops horizontally, so moving past one side wraps to the other.
- Surface landmarks (🛖 cottage, 🛒 shop, and unlockable 🪣 well) are world objects and can drop if their support is mined away.
- Grass spreads only into adjacent empty tiles (including diagonals) when that tile has sand directly underneath.
- Return to the cottage to refill stamina (auto-rest starts immediately there).
- Low stamina warnings appear at 3 points remaining, and your stamina cap increases as you level up.
- Deep layers contain large veins/deposits of gold, diamonds, rubies, emeralds, sapphires, gemstones, and other rich materials.
- Deep lava leaks can spread when opened; use water from the well to cool lava into granite.
- You can hire an NPC digger in the shop to auto-mine and collect loot for you.
- Buy upgrades while standing on the shop tile.

## Local Development
If you want to run locally:

```bash
python3 -m http.server 4173
```

Then open: `http://127.0.0.1:4173`

## Support

If you'd like to support this project, you can buy me a coffee:
[buymeacoffee.com/dhooksterm](https://buymeacoffee.com/dhooksterm)
