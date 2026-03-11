/**
 * Gold Digger (looping-world edition)
 * - 200x1000 blocks, horizontal wrap-around
 * - Camera-follow rendering (only visible tiles are drawn for speed)
 * - Arcade digging, gravity, upgrades, bombs, and site difficulty
 */
// Level 1 is intentionally compact (50 columns) so wrap-around is easy to understand.
const WORLD_WIDTH = 50;
const WORLD_HEIGHT = 1000;
const TILE_SIZE = 16;
const FOW_SIGHT_RADIUS = 5;
const MAX_STAMINA = 12;
const REST_DURATION_MS = 10000;
const GRASS_SPREAD_INTERVAL_MS = 1000;
const LAVA_FLOW_INTERVAL_MS = 900;
const STAMINA_WARNING_MS = 1800;

// Surface buildings placed next to each other at the top lane.
const SURFACE_SPOTS = {
  cottageX: Math.floor(WORLD_WIDTH / 2) - 1,
  shopX: Math.floor(WORLD_WIDTH / 2),
};

const LANDMARK_IDS = {
  COTTAGE: 'cottage',
  SHOP: 'shop',
  WELL: 'well',
};

const MATERIALS = {
  EMPTY: 0,
  SAND: 1,
  ROCK: 2,
  METAL: 3,
  GRANITE: 4,
  TREASURE: 5,
  GRASS: 6,
  RELIC: 7,
  CRYSTAL: 8,
  LAVA: 9,
  GOLD: 10,
  DIAMOND: 11,
  RUBY: 12,
  EMERALD: 13,
  SAPPHIRE: 14,
  GEMSTONE: 15,
  STRUT: 16,
  TORCH: 17,
};

const SITE_DEFS = [
  { id: 'egypt', name: 'Giza Sands (Easy)', rockBias: 0.05, metalBias: 0.00, graniteBias: 0.00, treasureBias: 0.012, xpBonus: 1.0 },
  { id: 'andes', name: 'Andes Ruins (Medium)', rockBias: 0.08, metalBias: 0.02, graniteBias: 0.01, treasureBias: 0.014, xpBonus: 1.22 },
  { id: 'atlantis', name: 'Sunken Atlantis (Hard)', rockBias: 0.12, metalBias: 0.03, graniteBias: 0.018, treasureBias: 0.016, xpBonus: 1.5 },
  { id: 'himalaya', name: 'Himalayan Vault (Expert)', rockBias: 0.15, metalBias: 0.04, graniteBias: 0.024, treasureBias: 0.018, xpBonus: 1.8 },
];

const MINERAL_DEFS = {
  [MATERIALS.GOLD]: { name: 'Gold vein', baseColor: '#e2b93f', frameA: '#fff1a8', frameB: '#c18f1f', payoutMin: 95, payoutVar: 65, xp: 34 },
  [MATERIALS.DIAMOND]: { name: 'Diamond cluster', baseColor: '#80f5ff', frameA: '#d5fdff', frameB: '#3cc9e8', payoutMin: 170, payoutVar: 90, xp: 52 },
  [MATERIALS.RUBY]: { name: 'Ruby seam', baseColor: '#d9505e', frameA: '#ff9bab', frameB: '#a7243f', payoutMin: 140, payoutVar: 85, xp: 45 },
  [MATERIALS.EMERALD]: { name: 'Emerald vein', baseColor: '#42c983', frameA: '#9fffd1', frameB: '#1f8f56', payoutMin: 135, payoutVar: 80, xp: 44 },
  [MATERIALS.SAPPHIRE]: { name: 'Sapphire vein', baseColor: '#4e79de', frameA: '#a8c1ff', frameB: '#264cae', payoutMin: 145, payoutVar: 82, xp: 46 },
  [MATERIALS.GEMSTONE]: { name: 'Gemstone deposit', baseColor: '#b767e8', frameA: '#efc6ff', frameB: '#7e33b6', payoutMin: 120, payoutVar: 78, xp: 41 },
};

const ANIMATED_MINERALS = new Set(Object.keys(MINERAL_DEFS).map((k) => Number(k)));

const INVENTORY_DEFS = {
  [MATERIALS.SAND]: { name: 'Sand', icon: '🟨', sell: 2, placeable: true },
  [MATERIALS.ROCK]: { name: 'Rock', icon: '🪨', sell: 4, placeable: true },
  [MATERIALS.METAL]: { name: 'Metal', icon: '⛓️', sell: 9, placeable: true },
  [MATERIALS.GRANITE]: { name: 'Granite', icon: '⬛', sell: 8, placeable: true },
  [MATERIALS.TREASURE]: { name: 'Treasure', icon: '💎', sell: 65, placeable: false },
  [MATERIALS.GRASS]: { name: 'Grass', icon: '🌱', sell: 1, placeable: true },
  [MATERIALS.RELIC]: { name: 'Relic', icon: '🏺', sell: 120, placeable: false },
  [MATERIALS.CRYSTAL]: { name: 'Crystal', icon: '🔷', sell: 90, placeable: true },
  [MATERIALS.GOLD]: { name: 'Gold', icon: '🥇', sell: 155, placeable: true },
  [MATERIALS.DIAMOND]: { name: 'Diamond', icon: '💠', sell: 220, placeable: true },
  [MATERIALS.RUBY]: { name: 'Ruby', icon: '♦️', sell: 185, placeable: true },
  [MATERIALS.EMERALD]: { name: 'Emerald', icon: '🟩', sell: 180, placeable: true },
  [MATERIALS.SAPPHIRE]: { name: 'Sapphire', icon: '🔹', sell: 188, placeable: true },
  [MATERIALS.GEMSTONE]: { name: 'Gemstone', icon: '🔮', sell: 170, placeable: true },
  [MATERIALS.STRUT]: { name: 'Strut', icon: '🪵', sell: 15, placeable: true },
  [MATERIALS.TORCH]: { name: 'Torch', icon: '🕯️', sell: 20, placeable: true },
};

function tileKey(x, y) { return `${wrapX(x)},${y}`; }


const state = {
  world: new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT),
  explored: new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT),
  player: { x: Math.floor(WORLD_WIDTH / 2), y: 0 },
  camera: { x: 0, y: 0 },
  money: 0,
  xp: 0,
  level: 1,
  digSpeed: 1,
  digRadius: 1,
  bombs: 0,
  bombPackBonus: 0,
  lootMultiplier: 1,
  canDigRock: false,
  canDigPillars: false,
  cooldownMs: 160,
  lastMoveAt: 0,
  selectedSiteId: SITE_DEFS[0].id,
  gameStarted: false,
  autoDigEnabled: false,
  maxDepth: 0,
  // Start zoomed-in by default so the play area is easier to read on high-DPI displays.
  zoom20x20: true,
  gameOver: false,
  sfxEnabled: true,
  particles: [],
  playerAnim: { bobPhase: 0, facing: 1 },
  // Active timed dig action (3 seconds) with a 5-frame animation.
  digAction: null,
  // Smooth movement tween so each tile-to-tile step scrolls/animates cleanly.
  moveAnim: null,
  stamina: MAX_STAMINA,
  maxStamina: MAX_STAMINA,
  restAction: null,
  // Timestamp throttle for sand-supported grass spreading checks.
  lastGrassSpreadAt: 0,
  // Cottage/shop/well are physical landmark tiles that can drop if the column under them is mined away.
  surfaceLandmarks: {
    [LANDMARK_IDS.COTTAGE]: { x: SURFACE_SPOTS.cottageX, y: 0 },
    [LANDMARK_IDS.SHOP]: { x: SURFACE_SPOTS.shopX, y: 0 },
    [LANDMARK_IDS.WELL]: { x: SURFACE_SPOTS.shopX + 1, y: 0 },
  },
  lastLavaFlowAt: 0,
  lavaSources: new Map(),
  waterUnlocked: false,
  water: 0,
  npc: { owned: false, alive: false, x: 0, y: 0, stamina: 8, maxStamina: 8, nextActionAt: 0, restUntil: 0 },
  // Short-lived in-board warning cue shown when the player tries to dig with zero stamina.
  staminaWarningUntil: 0,
  lastLowStaminaWarnAt: 0,
  inventory: {},
  selectedInventoryMaterial: null,
  buildMode: false,
  cheatMode: false,
  lastMoveDir: { dx: 0, dy: 1 },
  placedTorches: new Set(),
};

const upgrades = [
  {
    id: 'speed',
    name: 'Turbo Spade',
    baseCost: 120,
    requiredLevel: 1,
    desc: 'Dig faster by reducing movement cooldown.',
    apply: () => {
      state.digSpeed += 0.2;
      state.cooldownMs = Math.max(45, Math.round(160 / state.digSpeed));
    },
  },
  {
    id: 'radius',
    name: 'Wide Scoop',
    baseCost: 160,
    requiredLevel: 2,
    desc: 'Side digs also clear one tile below for larger tunnels.',
    apply: () => { state.digRadius = Math.min(2, state.digRadius + 1); },
  },
  {
    id: 'rock',
    name: 'Rock Drill',
    baseCost: 220,
    requiredLevel: 3,
    desc: 'Allows mining standard rock and cooled granite.',
    apply: () => { state.canDigRock = true; },
  },
  {
    id: 'pillars',
    name: 'Support Cutter',
    baseCost: 260,
    requiredLevel: 4,
    desc: 'Allows side-cutting through packed rocky supports.',
    apply: () => { state.canDigPillars = true; },
  },
  {
    id: 'bomb-pack',
    name: 'Bomb Pack',
    baseCost: 190,
    requiredLevel: 2,
    desc: 'Adds 4 bombs for metal/granite demolition.',
    apply: () => { state.bombs += 4; },
  },
  {
    id: 'fuse',
    name: 'Precision Fuse',
    baseCost: 330,
    requiredLevel: 5,
    desc: 'Bomb packs now include +2 extra bombs each purchase.',
    apply: () => {
      state.bombs += 2;
      state.bombPackBonus = (state.bombPackBonus || 0) + 2;
    },
  },
  {
    id: 'treasure-lens',
    name: 'Treasure Lens',
    baseCost: 280,
    requiredLevel: 4,
    desc: 'Increases collectible payout by 20%.',
    apply: () => { state.lootMultiplier = (state.lootMultiplier || 1) + 0.2; },
  },
  {
    id: 'well-unlock',
    name: 'Well Unlock',
    baseCost: 240,
    requiredLevel: 3,
    desc: 'Unlocks the well next to the shop so you can collect water.',
    oneTime: true,
    isOwned: () => state.waterUnlocked,
    apply: () => {
      state.waterUnlocked = true;
      state.water += 2;
    },
  },
  {
    id: 'strut-pack',
    name: 'Strut Bundle',
    baseCost: 90,
    requiredLevel: 2,
    desc: 'Adds 10 support struts for base building and caverns.',
    apply: () => { addInventory(MATERIALS.STRUT, 10); },
  },
  {
    id: 'torch-pack',
    name: 'Torch Crate',
    baseCost: 85,
    requiredLevel: 2,
    desc: 'Adds 8 torches to light dark deep tunnels.',
    apply: () => { addInventory(MATERIALS.TORCH, 8); },
  },
  {
    id: 'npc-digger',
    name: 'NPC Digger',
    baseCost: 360,
    requiredLevel: 4,
    desc: 'Hire (or replace) an auto-digger that mines and sells loot for you.',
    canBuy: () => !state.npc.alive,
    apply: () => {
      state.npc.owned = true;
      state.npc.alive = true;
      state.npc.x = state.player.x;
      state.npc.y = Math.max(0, state.player.y);
      state.npc.stamina = state.npc.maxStamina;
      state.npc.restUntil = 0;
      state.npc.nextActionAt = performance.now() + 350;
    },
  },
];

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
const siteSelect = $('site-select');
const messageBox = $('message');
const shopPanel = $('shop-panel');
let audioCtx;

function indexOf(x, y) {
  return (y * WORLD_WIDTH) + wrapX(x);
}

function inBounds(x, y) {
  return y >= 0 && y < WORLD_HEIGHT;
}

/** Wrap x-coordinates so the map loops seamlessly from edge to edge. */
function wrapX(x) {
  return ((x % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH;
}

/** Shortest horizontal distance on a looping map (used by fog and vision). */
function wrappedDistanceX(a, b) {
  const direct = Math.abs(a - b);
  return Math.min(direct, WORLD_WIDTH - direct);
}

/** Return -1/1 horizontal direction using shortest wrap-around distance. */
function wrappedStepDirection(fromX, toX) {
  const rightDist = (toX - fromX + WORLD_WIDTH) % WORLD_WIDTH;
  const leftDist = (fromX - toX + WORLD_WIDTH) % WORLD_WIDTH;
  return rightDist <= leftDist ? 1 : -1;
}

/** Smallest signed horizontal delta on a wrapping world (for smooth interpolation). */
function shortestWrappedDelta(fromX, toX) {
  const rightDist = (toX - fromX + WORLD_WIDTH) % WORLD_WIDTH;
  const leftDist = (fromX - toX + WORLD_WIDTH) % WORLD_WIDTH;
  return rightDist <= leftDist ? rightDist : -leftDist;
}

function startMoveAnimation(fromX, fromY, toX, toY, durationMs = 180) {
  state.moveAnim = {
    active: true,
    startedAt: performance.now(),
    durationMs,
    fromX: wrapX(fromX),
    fromY,
    deltaX: shortestWrappedDelta(fromX, toX),
    deltaY: toY - fromY,
  };
}

function getAnimatedPlayerPosition(now = performance.now()) {
  const anim = state.moveAnim;
  if (!anim?.active) return { x: state.player.x, y: state.player.y };
  const t = Math.min(1, (now - anim.startedAt) / anim.durationMs);
  const eased = 1 - ((1 - t) ** 2);
  const x = wrapX(anim.fromX + (anim.deltaX * eased));
  const y = anim.fromY + (anim.deltaY * eased);
  if (t >= 1) state.moveAnim = null;
  return { x, y };
}

function getCell(x, y) {
  if (!inBounds(x, y)) return MATERIALS.GRANITE;
  return state.world[indexOf(wrapX(x), y)];
}

function setCell(x, y, value) {
  if (inBounds(x, y)) state.world[indexOf(wrapX(x), y)] = value;
}

/**
 * Tiny synthesized retro SFX system.
 * Uses WebAudio oscillators so no network/audio assets are needed.
 */
function playTone(type = 'triangle', freq = 440, duration = 0.08, volume = 0.03, slideTo = freq) {
  if (!state.sfxEnabled) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

function playSfx(name) {
  if (name === 'dig') playTone('square', 180, 0.05, 0.025, 130);
  if (name === 'dig-loop') {
    playTone('square', 200, 0.05, 0.025, 155);
    setTimeout(() => playTone('triangle', 140, 0.04, 0.02, 120), 45);
  }
  if (name === 'treasure') {
    playTone('triangle', 520, 0.08, 0.04, 780);
    setTimeout(() => playTone('triangle', 780, 0.07, 0.035, 1040), 70);
  }
  if (name === 'bomb') {
    playTone('sawtooth', 260, 0.16, 0.05, 52);
    setTimeout(() => playTone('square', 120, 0.14, 0.03, 48), 30);
  }
  if (name === 'blocked') playTone('square', 120, 0.06, 0.02, 90);
  if (name === 'levelup') playTone('triangle', 410, 0.1, 0.04, 920);
  if (name === 'gameover') {
    playTone('sawtooth', 220, 0.2, 0.04, 95);
    setTimeout(() => playTone('triangle', 160, 0.18, 0.03, 70), 120);
  }
}

/** Mark cells around the player as explored for fog-of-war tracking. */
function markVisibleArea(cx, cy, radius = FOW_SIGHT_RADIUS) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const wx = wrapX(cx + dx);
      const wy = cy + dy;
      if (!inBounds(wx, wy)) continue;
      const dist = Math.hypot(dx, dy);
      if (dist <= radius) state.explored[indexOf(wx, wy)] = 1;
    }
  }
}

/**
 * Fog-of-war behavior:
 * - Unexplored cells outside view radius stay fully hidden.
 * - Explored cells remain revealed with a soft darkness when far away.
 * - Nearby cells are fully visible for clear navigation.
 */
function getFogAlpha(wx, wy) {
  const dx = wrappedDistanceX(wx, state.player.x);
  const dist = Math.hypot(dx, wy - state.player.y);
  const explored = state.explored[indexOf(wx, wy)] === 1;

  let torchBoost = 0;
  for (const key of state.placedTorches) {
    const [tx, ty] = key.split(',').map(Number);
    const td = Math.hypot(wrappedDistanceX(wx, tx), wy - ty);
    if (td <= 4) { torchBoost = Math.max(torchBoost, (4 - td) / 4); }
  }

  const deepDarkness = Math.max(0, (wy - 180) / 700) * 0.45;

  if (dist <= 1) return Math.max(0, deepDarkness - (torchBoost * 0.5));

  if (dist >= FOW_SIGHT_RADIUS) {
    const base = explored ? 0.42 : 1;
    return Math.max(0, Math.min(1, base + deepDarkness - (torchBoost * 0.55)));
  }

  const t = (dist - 1) / (FOW_SIGHT_RADIUS - 1);
  const activeFog = Math.min(1, Math.max(0, t ** 1.35));
  const fog = explored ? activeFog * 0.45 : activeFog;
  return Math.max(0, Math.min(1, fog + deepDarkness - (torchBoost * 0.55)));
}

function coordNoise(x, y, seed) {
  let h = (x * 374761393) ^ (y * 668265263) ^ (seed * 2147483647);
  h = (h ^ (h >> 13)) * 1274126177;
  h ^= h >> 16;
  return (h >>> 0) / 4294967295;
}

function buildWorld(siteDef) {
  const seed = SITE_DEFS.findIndex((s) => s.id === siteDef.id) + 1;
  const world = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);

  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    for (let x = 0; x < WORLD_WIDTH; x += 1) {
      const idx = indexOf(x, y);

      if (y === 0) {
        world[idx] = MATERIALS.EMPTY;
        continue;
      }

      if (y === 1) {
        world[idx] = MATERIALS.GRASS;
        continue;
      }

      const undergroundDepth = (y - 2) / (WORLD_HEIGHT - 2);
      const n = coordNoise(x, y, seed);
      const deepNoise = coordNoise(x + 99991, y + 31337, seed + 17);

      const treasureChance = Math.max(0.004, siteDef.treasureBias - (undergroundDepth * 0.006));
      const relicChance = 0.003 + undergroundDepth * 0.0035;
      const crystalChance = 0.002 + Math.max(0, undergroundDepth - 0.35) * 0.005;
      if (n < treasureChance) {
        world[idx] = MATERIALS.TREASURE;
        continue;
      }
      if (n < treasureChance + relicChance) {
        world[idx] = MATERIALS.RELIC;
        continue;
      }
      if (n < treasureChance + relicChance + crystalChance) {
        world[idx] = MATERIALS.CRYSTAL;
        continue;
      }

      if (undergroundDepth < 0.35) {
        const rockRatio = Math.min(1, siteDef.rockBias + (undergroundDepth / 0.35) * 0.9);
        world[idx] = deepNoise < rockRatio ? MATERIALS.ROCK : MATERIALS.SAND;
        continue;
      }

      if (undergroundDepth < 0.65) {
        world[idx] = MATERIALS.ROCK;
        continue;
      }

      if (undergroundDepth < 0.85) {
        const metalChance = siteDef.metalBias + ((undergroundDepth - 0.65) / 0.2) * 0.24;
        world[idx] = deepNoise < metalChance ? MATERIALS.METAL : MATERIALS.ROCK;
        continue;
      }

      // Deep mineral veins/deposits: broad contiguous pockets formed from layered noise bands.
      const veinNoiseA = coordNoise(x * 2 + 71, y * 2 + 19, seed + 101);
      const veinNoiseB = coordNoise(x + 913, Math.floor(y * 0.7), seed + 203);
      const pocketNoise = coordNoise(x * 3 + 19, y * 3 + 29, seed + 307);
      const deepBand = Math.max(0, (undergroundDepth - 0.68) / 0.32);
      const veinThresholdMin = 0.56 - (deepBand * 0.06);
      const veinThresholdMax = 0.77 + (deepBand * 0.18);
      // Larger deep pockets become more common with depth to create rich excavation zones.
      if (deepBand > 0.01 && veinNoiseA > veinThresholdMin && veinNoiseA < veinThresholdMax && pocketNoise > (0.34 - deepBand * 0.12)) {
        if (veinNoiseB > 0.87) { world[idx] = MATERIALS.DIAMOND; continue; }
        if (veinNoiseB > 0.75) { world[idx] = MATERIALS.SAPPHIRE; continue; }
        if (veinNoiseB > 0.64) { world[idx] = MATERIALS.EMERALD; continue; }
        if (veinNoiseB > 0.55) { world[idx] = MATERIALS.RUBY; continue; }
        if (veinNoiseB > 0.47) { world[idx] = MATERIALS.GEMSTONE; continue; }
        world[idx] = MATERIALS.GOLD;
        continue;
      }

      // Deep isolated lava pockets are initially contained by hard rock.
      const lavaChance = Math.max(0, undergroundDepth - 0.82) * 0.04;
      if (n > 0.62 && n < (0.62 + lavaChance) && deepNoise < 0.35) {
        world[idx] = MATERIALS.LAVA;
        continue;
      }

      const graniteChance = siteDef.graniteBias + ((undergroundDepth - 0.85) / 0.15) * 0.35;
      const metalChance = siteDef.metalBias + 0.18;
      if (deepNoise < graniteChance) world[idx] = MATERIALS.GRANITE;
      else if (deepNoise < graniteChance + metalChance) world[idx] = MATERIALS.METAL;
      else world[idx] = MATERIALS.ROCK;
    }
  }

  return world;
}

function getMaterialColor(type) {
  switch (type) {
    case MATERIALS.SAND: return '#e5c581';
    case MATERIALS.ROCK: return '#7f879f';
    case MATERIALS.METAL: return '#adb7cc';
    case MATERIALS.GRANITE: return '#525565';
    case MATERIALS.TREASURE: return '#f3c741';
    case MATERIALS.GRASS: return '#4aa34a';
    case MATERIALS.RELIC: return '#b57f5f';
    case MATERIALS.CRYSTAL: return '#68def2';
    case MATERIALS.LAVA: return '#ff6a2a';
    case MATERIALS.GOLD: return MINERAL_DEFS[MATERIALS.GOLD].baseColor;
    case MATERIALS.DIAMOND: return MINERAL_DEFS[MATERIALS.DIAMOND].baseColor;
    case MATERIALS.RUBY: return MINERAL_DEFS[MATERIALS.RUBY].baseColor;
    case MATERIALS.EMERALD: return MINERAL_DEFS[MATERIALS.EMERALD].baseColor;
    case MATERIALS.SAPPHIRE: return MINERAL_DEFS[MATERIALS.SAPPHIRE].baseColor;
    case MATERIALS.GEMSTONE: return MINERAL_DEFS[MATERIALS.GEMSTONE].baseColor;
    case MATERIALS.STRUT: return '#8f6a41';
    case MATERIALS.TORCH: return '#d79a3a';
    default: return '#0f1320';
  }
}

function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(360, Math.floor(rect.width * dpr));
  const height = Math.max(280, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

/**
 * Shared surface horizon math so both the sky painter and underground vignette
 * agree on where "above-ground" ends in screen space.
 */
function getSurfaceHorizonScreenY(tileSize, offsetY, boardHeightPx, cameraY = state.camera.y) {
  const boardTop = offsetY;
  const boardBottom = offsetY + boardHeightPx;
  // Lock horizon directly to the grass row so there is no dark gap between sky and ground.
  const grassRowScreenY = offsetY + ((1 - cameraY) * tileSize);
  return Math.max(boardTop, Math.min(boardBottom, grassRowScreenY));
}

function drawSurface(tileSize, _viewportCols, offsetX, offsetY, boardWidthPx, boardHeightPx, cameraY = state.camera.y) {
  // Draw sky/soil inside the board bounds so the terrain and background start at the same point.
  const boardTop = offsetY;
  const boardBottom = offsetY + boardHeightPx;
  const horizon = getSurfaceHorizonScreenY(tileSize, offsetY, boardHeightPx, cameraY);

  const sky = ctx.createLinearGradient(0, boardTop, 0, horizon || (boardTop + 1));
  // Brighter daytime sky palette for a clearer above-ground mood.
  sky.addColorStop(0, '#58b8ff');
  sky.addColorStop(0.55, '#87d4ff');
  sky.addColorStop(1, '#bfe9ff');
  ctx.fillStyle = sky;
  ctx.fillRect(offsetX, boardTop, boardWidthPx, Math.max(0, horizon - boardTop));

  // Fill below the horizon with earth tones so terrain always reads below the grass strip.
  const soil = ctx.createLinearGradient(0, horizon, 0, boardBottom);
  soil.addColorStop(0, '#2a3627');
  soil.addColorStop(1, '#171823');
  ctx.fillStyle = soil;
  ctx.fillRect(offsetX, horizon, boardWidthPx, Math.max(0, boardBottom - horizon));

  // Keep the sun in the visible sky band (never below the computed horizon line).
  const pulse = 0.08 * Math.sin(performance.now() / 620);
  const sunY = Math.max(boardTop + 42, Math.min(horizon - 28, boardTop + Math.floor((horizon - boardTop) * 0.35)));
  const sunX = offsetX + boardWidthPx - 95;

  // Bloom halo uses layered radial gradients for a soft glow without expensive full-screen blur.
  const bloomRadius = 150 + (pulse * 18);
  const bloom = ctx.createRadialGradient(sunX, sunY, 12, sunX, sunY, bloomRadius);
  bloom.addColorStop(0, 'rgba(255, 250, 190, 0.58)');
  bloom.addColorStop(0.35, 'rgba(255, 226, 120, 0.33)');
  bloom.addColorStop(0.75, 'rgba(255, 198, 86, 0.14)');
  bloom.addColorStop(1, 'rgba(255, 180, 66, 0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(offsetX, boardTop, boardWidthPx, Math.max(0, horizon - boardTop));

  // Short sun-ray sweep for extra shine while keeping animation subtle.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(255, 226, 132, ${0.22 + (pulse * 0.22)})`;
  ctx.lineWidth = 2;
  const rays = 10;
  const rayInner = 34;
  const rayOuter = 64 + (pulse * 10);
  for (let i = 0; i < rays; i += 1) {
    const angle = ((Math.PI * 2) / rays) * i + (performance.now() / 2800);
    ctx.beginPath();
    ctx.moveTo(sunX + (Math.cos(angle) * rayInner), sunY + (Math.sin(angle) * rayInner));
    ctx.lineTo(sunX + (Math.cos(angle) * rayOuter), sunY + (Math.sin(angle) * rayOuter));
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = `rgba(255, 225, 91, ${0.38 + pulse})`;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffdf55';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 220, 0.55)';
  ctx.beginPath();
  ctx.arc(sunX - 8, sunY - 8, 9, 0, Math.PI * 2);
  ctx.fill();

  // Surface band is locked to the grass row for cleaner separation of sky and underground.
  const bandHeight = Math.max(4, Math.floor(tileSize * 0.25));
  ctx.fillStyle = '#2f8d40';
  ctx.fillRect(offsetX, Math.max(boardTop, horizon - bandHeight), boardWidthPx, bandHeight);

  // Surface landmarks are rendered as in-grid icon tiles so only one cottage/shop is shown.
}

/** Draw an always-visible icon tile for surface landmarks on the board itself. */
function drawSurfaceIconTile(px, py, tileSize, tileColor, icon) {
  ctx.fillStyle = tileColor;
  ctx.fillRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(px + 2, py + 2, tileSize - 4, Math.max(2, Math.floor(tileSize * 0.18)));
  ctx.font = `${Math.max(11, Math.floor(tileSize * 0.8))}px Trebuchet MS`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fffdf5';
  ctx.fillText(icon, px + (tileSize / 2), py + (tileSize / 2) + 0.5);
  ctx.textBaseline = 'alphabetic';
}

/**
 * Grass spreading rule:
 * - an empty tile can grow grass only if there is SAND directly below it
 * - growth requires at least one neighboring grass tile (8-way, including diagonals)
 */
function canGrassSpreadTo(x, y) {
  if (!inBounds(x, y)) return false;
  if (getCell(x, y) !== MATERIALS.EMPTY) return false;
  if (getCell(x, y + 1) !== MATERIALS.SAND) return false;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (getCell(x + dx, y + dy) === MATERIALS.GRASS) return true;
    }
  }
  return false;
}

function updateGrassSpread(now = performance.now()) {
  if (now - state.lastGrassSpreadAt < GRASS_SPREAD_INTERVAL_MS) return;
  state.lastGrassSpreadAt = now;

  const newGrass = [];
  for (let y = 0; y < WORLD_HEIGHT - 1; y += 1) {
    for (let x = 0; x < WORLD_WIDTH; x += 1) {
      if (!canGrassSpreadTo(x, y)) continue;
      if (Math.random() < 0.34) newGrass.push([x, y]);
    }
  }

  for (const [x, y] of newGrass) setCell(x, y, MATERIALS.GRASS);
}

function lavaKey(x, y) {
  return `${wrapX(x)},${y}`;
}

function initLavaSourcesFromWorld() {
  state.lavaSources = new Map();
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    for (let x = 0; x < WORLD_WIDTH; x += 1) {
      if (getCell(x, y) !== MATERIALS.LAVA) continue;
      // Each original lava tile may expand to ~10x its initial size.
      state.lavaSources.set(lavaKey(x, y), { x: wrapX(x), y, spreadLeft: 9 });
    }
  }
}

function killNpc(reason) {
  if (!state.npc.alive) return;
  state.npc.alive = false;
  setMessage(`NPC digger died: ${reason}. Buy another at the shop.`, 'danger');
}

function updateLavaFlow(now = performance.now()) {
  if (now - state.lastLavaFlowAt < LAVA_FLOW_INTERVAL_MS) return;
  state.lastLavaFlowAt = now;

  const newLava = [];
  for (const source of state.lavaSources.values()) {
    if (source.spreadLeft <= 0) continue;
    const candidates = [];
    const dirs = [[0, 1], [1, 0], [-1, 0], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = wrapX(source.x + dx);
      const ny = source.y + dy;
      if (!inBounds(nx, ny)) continue;
      if (getCell(nx, ny) === MATERIALS.EMPTY) candidates.push([nx, ny]);
    }
    if (!candidates.length) continue;
    const [nx, ny] = candidates[Math.floor(Math.random() * candidates.length)];
    newLava.push([nx, ny]);
    source.spreadLeft -= 1;
  }

  for (const [nx, ny] of newLava) {
    setCell(nx, ny, MATERIALS.LAVA);
    state.lavaSources.set(lavaKey(nx, ny), { x: nx, y: ny, spreadLeft: 0 });
    if (state.npc.alive && state.npc.x === nx && state.npc.y === ny) killNpc('walked into a lava leak');
    if (state.player.x === nx && state.player.y === ny) {
      state.gameOver = true;
      setMessage('Lava engulfed your tile. Game over!', 'danger');
    }
  }
}

function isAtWell() {
  const well = getLandmark(LANDMARK_IDS.WELL);
  return state.waterUnlocked && state.player.y === well.y && wrapX(state.player.x) === wrapX(well.x);
}

function useWater() {
  if (!state.gameStarted) return;
  if (state.gameOver || state.digAction?.active || state.restAction?.active) return;
  if (!state.waterUnlocked) {
    setMessage('Unlock the well in the shop before using water.', 'danger');
    return;
  }

  if (isAtWell()) {
    state.water = Math.min(12, state.water + 3);
    setMessage('Collected water from the well (+3).');
    updateHud();
    return;
  }

  if (state.water <= 0) {
    setMessage('No water left. Refill at the well (🪣).', 'danger');
    return;
  }

  let cooled = 0;
  for (let y = state.player.y - 1; y <= state.player.y + 1; y += 1) {
    for (let x = state.player.x - 1; x <= state.player.x + 1; x += 1) {
      if (!inBounds(x, y)) continue;
      if (getCell(x, y) !== MATERIALS.LAVA) continue;
      setCell(x, y, MATERIALS.GRANITE);
      state.lavaSources.delete(lavaKey(x, y));
      cooled += 1;
    }
  }

  if (cooled <= 0) {
    setMessage('Splash missed. Stand next to lava to cool it.', 'danger');
    return;
  }

  state.water -= 1;
  setMessage(`Water cooled ${cooled} lava tile${cooled === 1 ? '' : 's'} into granite.`);
  updateHud();
}

function isNpcTrapped() {
  const dirs = [[0,1],[1,0],[-1,0],[0,-1]];
  return !dirs.some(([dx,dy]) => {
    const nx = wrapX(state.npc.x + dx);
    const ny = state.npc.y + dy;
    if (!inBounds(nx, ny)) return false;
    const m = getCell(nx, ny);
    return m === MATERIALS.EMPTY || canDig(m, dy !== 0 ? (dy > 0 ? 'down':'up') : 'side');
  });
}

function updateNpcDigger(now = performance.now()) {
  if (!state.npc.alive) return;
  if (state.npc.restUntil > now) return;
  if (state.npc.restUntil && now >= state.npc.restUntil) {
    state.npc.restUntil = 0;
    state.npc.stamina = state.npc.maxStamina;
  }
  if (state.npc.stamina <= 0) {
    state.npc.restUntil = now + REST_DURATION_MS;
    return;
  }
  if (now < state.npc.nextActionAt) return;
  state.npc.nextActionAt = now + 800;

  if (isNpcTrapped()) {
    killNpc('became trapped underground');
    return;
  }

  const dirs = [[0,1],[1,0],[-1,0],[0,-1]];
  const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
  const nx = wrapX(state.npc.x + dx);
  const ny = state.npc.y + dy;
  if (!inBounds(nx, ny)) return;
  const m = getCell(nx, ny);
  const direction = dy > 0 ? 'down' : dy < 0 ? 'up' : 'side';
  if (m === MATERIALS.LAVA) {
    killNpc('entered lava');
    return;
  }
  if (m !== MATERIALS.EMPTY && !canDig(m, direction)) return;

  if (m === MATERIALS.TREASURE || m === MATERIALS.RELIC || m === MATERIALS.CRYSTAL || ANIMATED_MINERALS.has(m)) {
    let reward = m === MATERIALS.TREASURE ? 55 : m === MATERIALS.RELIC ? 95 : m === MATERIALS.CRYSTAL ? 70 : MINERAL_DEFS[m].payoutMin;
    state.money += Math.floor(reward * (state.lootMultiplier || 1));
    gainXp(12 + (ANIMATED_MINERALS.has(m) ? 6 : 0));
  }
  if (m !== MATERIALS.EMPTY) {
    setCell(nx, ny, MATERIALS.EMPTY);
    state.npc.stamina = Math.max(0, state.npc.stamina - 1);
  }
  state.npc.x = nx;
  state.npc.y = ny;
  settleColumn(nx);
  settleSurfaceLandmarks();
}

/**
 * Particle bursts make digs, treasure, and bombs feel responsive.
 * If an origin point is provided, particles can fly opposite the dig direction.
 */
function spawnParticles(worldX, worldY, color, count = 8, force = 1, originX = null, originY = null, reverseFromOrigin = false) {
  const baseX = originX == null ? 0 : worldX - originX;
  const baseY = originY == null ? -1 : worldY - originY;
  const directionScale = reverseFromOrigin ? -1 : 1;
  const travelX = baseX * directionScale;
  const travelY = baseY * directionScale;
  const travelLength = Math.hypot(travelX, travelY) || 1;
  const dirX = travelX / travelLength;
  const dirY = travelY / travelLength;

  for (let i = 0; i < count; i += 1) {
    const sprayStrength = 0.1 + (Math.random() * 0.08);
    state.particles.push({
      x: worldX + 0.5,
      y: worldY + 0.5,
      vx: (((Math.random() - 0.5) * 0.1) + (dirX * sprayStrength)) * force,
      vy: (((Math.random() - 0.5) * 0.08) + (dirY * sprayStrength)) * force,
      life: 1,
      color,
      size: 0.16 + Math.random() * 0.16,
    });
  }
}

/**
 * Emits short-lived dirt chunks from the current dig target while the 3 second dig is active.
 * This keeps the animation feeling alive instead of only bursting once at completion.
 */
function spawnDigDustBurst(action) {
  if (!action?.active) return;
  const material = getCell(action.targetX, action.targetY);
  if (material === MATERIALS.EMPTY) return;

  // Push the dust opposite the dig direction so debris kicks back toward the miner.
  const towardX = state.player.x - action.targetX;
  const towardY = state.player.y - action.targetY;
  const length = Math.hypot(towardX, towardY) || 1;
  const dirX = towardX / length;
  const dirY = towardY / length;
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i += 1) {
    const speed = 0.08 + (Math.random() * 0.12);
    state.particles.push({
      x: action.targetX + 0.5 + ((Math.random() - 0.5) * 0.5),
      y: action.targetY + 0.35 + (Math.random() * 0.35),
      vx: (dirX * speed) + ((Math.random() - 0.5) * 0.05),
      vy: (dirY * speed) + ((Math.random() - 0.5) * 0.05),
      life: 0.75 + (Math.random() * 0.3),
      color: getMaterialColor(material),
      size: 0.13 + Math.random() * 0.12,
    });
  }
}

function updateParticles() {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const p = state.particles[i];
    p.life -= 0.06;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.008;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

function draw() {
  const now = performance.now();
  const animatedPlayer = getAnimatedPlayerPosition(now);
  updateGrassSpread(now);
  updateLavaFlow(now);
  updateNpcDigger(now);
  updateAutoDig(now);
  resizeCanvasToDisplaySize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const fixedRows = state.zoom20x20 ? 20 : null;
  // In 20x20 zoom mode, lock vertical rows to 20 but let columns expand with the canvas width.
  // This keeps the board full-width on wide windows instead of forcing a centered square viewport.
  const tileSize = fixedRows ? Math.max(8, Math.floor(canvas.height / fixedRows)) : TILE_SIZE;
  // Keep visible tile count tight so player can stay centered unless clamped by world edges.
  const viewportRows = fixedRows ?? Math.ceil(canvas.height / TILE_SIZE);
  const viewportCols = fixedRows ? Math.max(fixedRows, Math.ceil(canvas.width / tileSize)) : Math.ceil(canvas.width / TILE_SIZE);
  const boardWidthPx = viewportCols * tileSize;
  const boardHeightPx = viewportRows * tileSize;
  const offsetX = Math.floor((canvas.width - boardWidthPx) / 2);
  const offsetY = Math.floor((canvas.height - boardHeightPx) / 2);

  // Camera centers on the player; keep tile sampling on integer rows/cols and apply sub-tile pixel offsets.
  // This preserves smooth scrolling without feeding fractional world indices into terrain lookups.
  const cameraFloatX = animatedPlayer.x - Math.floor(viewportCols / 2);
  const cameraTileX = Math.floor(cameraFloatX);
  const cameraSubX = cameraFloatX - cameraTileX;
  state.camera.x = wrapX(cameraTileX);

  const targetCameraY = animatedPlayer.y - Math.floor(viewportRows / 2);
  const topSkyRows = Math.max(0, Math.floor(viewportRows / 2) - 1);
  const minCameraY = -topSkyRows;
  const maxCameraY = WORLD_HEIGHT - viewportRows;
  const cameraFloatY = Math.max(minCameraY, Math.min(maxCameraY, targetCameraY));
  const cameraTileY = Math.floor(cameraFloatY);
  const cameraSubY = cameraFloatY - cameraTileY;
  state.camera.y = cameraTileY;

  const cameraRenderX = wrapX(state.camera.x + cameraSubX);
  const cameraRenderY = state.camera.y + cameraSubY;

  // Auto-rest should begin as soon as the player is idle on cottage with missing stamina.
  if (isAtCottage() && state.stamina < state.maxStamina && !state.restAction?.active && !state.digAction?.active) startRest();

  drawSurface(tileSize, viewportCols, offsetX, offsetY, boardWidthPx, boardHeightPx, cameraRenderY);

  // Apply underground vignette only below the surface horizon so the blue sky stays visible.
  const horizon = getSurfaceHorizonScreenY(tileSize, offsetY, boardHeightPx, cameraRenderY);
  const undergroundTop = Math.floor(horizon);
  const undergroundHeight = Math.max(0, (offsetY + boardHeightPx) - undergroundTop);
  if (undergroundHeight > 0) {
    const boardGlow = ctx.createLinearGradient(offsetX, undergroundTop, offsetX, offsetY + boardHeightPx);
    boardGlow.addColorStop(0, 'rgba(36, 23, 46, 0.2)');
    boardGlow.addColorStop(1, 'rgba(20, 22, 34, 0.78)');
    ctx.fillStyle = boardGlow;
    ctx.fillRect(offsetX - 2, undergroundTop - 1, boardWidthPx + 4, undergroundHeight + 3);
  }

  for (let vy = 0; vy < viewportRows; vy += 1) {
    for (let vx = 0; vx < viewportCols; vx += 1) {
      const wx = wrapX(state.camera.x + vx);
      const wy = state.camera.y + vy;
      if (!inBounds(wx, wy)) continue;

      const material = getCell(wx, wy);
      const px = offsetX + Math.round((vx - cameraSubX) * tileSize);
      const py = offsetY + Math.round((vy - cameraSubY) * tileSize);
      const isCottageTile = isLandmarkAt(LANDMARK_IDS.COTTAGE, wx, wy);
      const isShopTile = isLandmarkAt(LANDMARK_IDS.SHOP, wx, wy);
      const isWellTile = state.waterUnlocked && isLandmarkAt(LANDMARK_IDS.WELL, wx, wy);
      const transparentSurfaceLane = wy === 0 && material === MATERIALS.EMPTY && !isCottageTile && !isShopTile && !isWellTile;

      // Keep the y=0 lane transparent so the sky touches the grass with no black separator row.
      if (!transparentSurfaceLane) {
        ctx.fillStyle = getMaterialColor(material);
        ctx.fillRect(px, py, tileSize, tileSize);
      }

      if (material !== MATERIALS.EMPTY && !transparentSurfaceLane) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(px + 2, py + 2, Math.max(2, tileSize - 4), Math.max(2, Math.floor(tileSize * 0.18)));
      }

      // Overlay landmark icons so cottage/shop remain visible while on the surface lane.
      if (isCottageTile) {
        drawSurfaceIconTile(px, py, tileSize, '#8e5a31', '🛖');
      } else if (isShopTile) {
        drawSurfaceIconTile(px, py, tileSize, '#366fb0', '🛒');
      } else if (isWellTile) {
        drawSurfaceIconTile(px, py, tileSize, '#4d7bb5', '🪣');
      }

      if (material === MATERIALS.LAVA) {
        const lavaPulse = (Math.sin((performance.now() / 140) + (wx * 0.4) + (wy * 0.2)) + 1) / 2;
        ctx.fillStyle = `rgba(255, 208, 84, ${(0.22 + lavaPulse * 0.22).toFixed(3)})`;
        ctx.fillRect(px + 2, py + 2, Math.max(2, tileSize - 4), Math.max(2, tileSize - 4));
      }

      if (ANIMATED_MINERALS.has(material)) {
        const mineral = MINERAL_DEFS[material];
        const frame = Math.floor((performance.now() / 280) + ((wx + wy) * 0.25)) % 2;
        const frameColor = frame === 0 ? mineral.frameA : mineral.frameB;
        const shardSize = Math.max(3, Math.floor(tileSize * 0.28));
        const centerX = px + Math.floor((tileSize - shardSize) / 2);
        const centerY = py + Math.floor((tileSize - shardSize) / 2);
        // Two-step animated shard frame keeps each mineral visually distinct and lively.
        ctx.fillStyle = frameColor;
        ctx.fillRect(centerX, centerY, shardSize, shardSize);
        ctx.fillRect(px + 3, py + 3, Math.max(2, Math.floor(shardSize * 0.65)), Math.max(2, Math.floor(shardSize * 0.65)));
        ctx.fillRect(px + tileSize - shardSize - 3, py + tileSize - shardSize - 3, Math.max(2, Math.floor(shardSize * 0.62)), Math.max(2, Math.floor(shardSize * 0.62)));
      }

      if (material === MATERIALS.TREASURE) {
        const twinkle = (Math.sin((performance.now() / 220) + ((wx + wy) * 0.3)) + 1) / 2;
        const gemSize = Math.max(4, Math.floor(tileSize * (0.28 + twinkle * 0.14)));
        ctx.fillStyle = '#5d4300';
        ctx.fillRect(px + Math.floor((tileSize - gemSize) / 2), py + Math.floor((tileSize - gemSize) / 2), gemSize, gemSize);
      }

      // Keep the transparent surface lane unobstructed by fog/grid so sky remains continuous.
      if (!transparentSurfaceLane) {
        const fogAlpha = getFogAlpha(wx, wy);
        if (fogAlpha > 0) {
          ctx.fillStyle = `rgba(0, 0, 0, ${fogAlpha.toFixed(3)})`;
          ctx.fillRect(px, py, tileSize, tileSize);
        }

        ctx.strokeStyle = '#131723';
        ctx.strokeRect(px, py, tileSize, tileSize);
      }
    }
  }

  updateParticles();
  for (const p of state.particles) {
    const sx = offsetX + (wrapX(p.x - cameraRenderX) * tileSize);
    const sy = offsetY + ((p.y - cameraRenderY) * tileSize);
    const size = Math.max(1, Math.floor(tileSize * p.size));
    // Draw a dark offset shadow first so bright debris remains readable on all block colors.
    ctx.fillStyle = 'rgba(12, 8, 18, 0.45)';
    ctx.globalAlpha = Math.max(0, p.life * 0.9);
    ctx.fillRect(sx + 1, sy + 1, size, size);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillRect(sx, sy, size, size);
    ctx.globalAlpha = 1;
  }

  if (state.npc.alive) {
    const npcViewportX = wrapX(state.npc.x - cameraRenderX);
    const npcScreenX = offsetX + (npcViewportX * tileSize);
    const npcScreenY = offsetY + ((state.npc.y - cameraRenderY) * tileSize);
    ctx.fillStyle = '#6ff0b5';
    ctx.fillRect(npcScreenX + 2, npcScreenY + 2, Math.max(6, Math.floor(tileSize * 0.65)), Math.max(6, Math.floor(tileSize * 0.65)));
    ctx.font = `${Math.max(10, Math.floor(tileSize * 0.7))}px Trebuchet MS`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#123221';
    ctx.fillText('🤖', npcScreenX + Math.floor(tileSize * 0.5), npcScreenY + Math.floor(tileSize * 0.7));
  }

  // Convert world X -> viewport X with wrap awareness so edge-crossing never places
  // the player sprite off-screen when camera.x wrapped to the other side.
  const playerViewportX = wrapX(animatedPlayer.x - cameraRenderX);
  const playerScreenX = offsetX + (playerViewportX * tileSize);
  const playerScreenY = offsetY + ((animatedPlayer.y - cameraRenderY) * tileSize);
  const bob = Math.sin(state.playerAnim.bobPhase) * Math.max(1, tileSize * 0.05);
  const px = playerScreenX;
  const py = playerScreenY + bob;

  // 5-frame digging animation: arm/pick position changes while the timed dig action runs.
  const digFrameOffsets = [0.05, 0.15, 0.29, 0.15, 0.05];
  const isDigging = state.digAction?.active;
  const digFrame = isDigging ? state.digAction.frame : 0;
  const pickSwing = digFrameOffsets[digFrame] ?? 0.05;

  ctx.fillStyle = '#f9c232';
  ctx.fillRect(px + Math.floor(tileSize * 0.2), py + 1, Math.max(6, Math.floor(tileSize * 0.62)), Math.max(3, Math.floor(tileSize * 0.25)));
  ctx.fillStyle = '#ffd8ab';
  ctx.fillRect(px + Math.floor(tileSize * 0.3), py + Math.floor(tileSize * 0.3), Math.max(4, Math.floor(tileSize * 0.38)), Math.max(3, Math.floor(tileSize * 0.22)));
  ctx.fillStyle = '#2a5daa';
  ctx.fillRect(px + Math.floor(tileSize * 0.25), py + Math.floor(tileSize * 0.54), Math.max(5, Math.floor(tileSize * 0.5)), Math.max(4, Math.floor(tileSize * 0.31)));
  // Draw a larger, higher-contrast shovel so it is visible during movement and digging.
  const basePickOffset = state.playerAnim.facing > 0 ? 0.72 : 0.06;
  const directionalSwing = state.playerAnim.facing > 0 ? pickSwing : -pickSwing;
  const pickOffset = Math.max(0.02, Math.min(0.84, basePickOffset + directionalSwing));
  const pickHeight = isDigging ? 0.42 + (digFrame * 0.035) : 0.5;
  const handleX = px + Math.floor(tileSize * pickOffset);
  const handleY = py + Math.floor(tileSize * pickHeight);
  const handleW = Math.max(2, Math.floor(tileSize * 0.12));
  const handleH = Math.max(6, Math.floor(tileSize * 0.44));

  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(handleX, handleY, handleW, handleH);
  ctx.fillStyle = '#2a1200';
  ctx.fillRect(handleX, handleY, handleW, Math.max(1, Math.floor(tileSize * 0.05)));

  const bladeW = Math.max(5, Math.floor(tileSize * 0.32));
  const bladeH = Math.max(4, Math.floor(tileSize * 0.2));
  const bladeX = state.playerAnim.facing > 0 ? handleX + handleW - 1 : handleX - bladeW + 1;
  const bladeY = handleY + handleH - Math.max(3, Math.floor(tileSize * 0.14));
  ctx.fillStyle = '#d6deef';
  ctx.fillRect(bladeX, bladeY, bladeW, bladeH);
  ctx.fillStyle = '#9ea9c4';
  ctx.fillRect(bladeX, bladeY, bladeW, Math.max(1, Math.floor(tileSize * 0.05)));

  // Progress ring around player while a 3-second dig is in progress.
  if (isDigging) {
    const elapsed = performance.now() - state.digAction.startedAt;
    const progress = Math.min(1, elapsed / state.digAction.durationMs);
    ctx.strokeStyle = 'rgba(255, 222, 125, 0.95)';
    ctx.lineWidth = Math.max(2, Math.floor(tileSize * 0.08));
    ctx.beginPath();
    ctx.arc(
      px + Math.floor(tileSize * 0.5),
      py + Math.floor(tileSize * 0.5),
      Math.max(6, Math.floor(tileSize * 0.52)),
      -Math.PI / 2,
      -Math.PI / 2 + (Math.PI * 2 * progress),
    );
    ctx.stroke();
  }

  // Red warning pulse appears if user tries digging with zero stamina.
  const staminaWarningActive = performance.now() < state.staminaWarningUntil;
  if (staminaWarningActive) {
    const pulse = (Math.sin(performance.now() / 120) + 1) / 2;
    const warningAlpha = 0.16 + (pulse * 0.2);
    ctx.fillStyle = `rgba(255, 52, 72, ${warningAlpha.toFixed(3)})`;
    ctx.fillRect(offsetX, offsetY, boardWidthPx, boardHeightPx);

    ctx.lineWidth = Math.max(4, Math.floor(tileSize * 0.16));
    ctx.strokeStyle = `rgba(255, 90, 106, ${(0.4 + (pulse * 0.45)).toFixed(3)})`;
    ctx.strokeRect(offsetX + 2, offsetY + 2, boardWidthPx - 4, boardHeightPx - 4);

    const bannerW = Math.min(boardWidthPx - 30, Math.max(280, Math.floor(boardWidthPx * 0.7)));
    const bannerH = Math.max(44, Math.floor(tileSize * 2));
    const bannerX = offsetX + Math.floor((boardWidthPx - bannerW) / 2);
    const bannerY = offsetY + Math.max(12, Math.floor(tileSize * 0.6));
    ctx.fillStyle = 'rgba(55, 10, 18, 0.84)';
    ctx.fillRect(bannerX, bannerY, bannerW, bannerH);
    ctx.strokeStyle = 'rgba(255, 124, 135, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bannerX, bannerY, bannerW, bannerH);
    ctx.fillStyle = '#ffd3d8';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(14, Math.floor(tileSize * 0.8))}px Trebuchet MS`;
    ctx.fillText('⛔ Out of stamina — return to the 🛖 cottage to rest', bannerX + (bannerW / 2), bannerY + Math.floor(bannerH * 0.64));
  }

  if (state.gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(offsetX, offsetY, boardWidthPx, boardHeightPx);
    ctx.fillStyle = '#ff5f73';
    ctx.font = `bold ${Math.max(18, Math.floor(tileSize * 1.1))}px Trebuchet MS`;
    ctx.textAlign = 'center';
    ctx.fillText('TRAPPED! GAME OVER', offsetX + (boardWidthPx / 2), offsetY + (boardHeightPx / 2));
  }
}

function getLandmark(id) {
  return state.surfaceLandmarks[id];
}

function isLandmarkAt(id, x, y) {
  const landmark = getLandmark(id);
  return landmark && wrapX(landmark.x) === wrapX(x) && landmark.y === y;
}

/**
 * Landmark gravity: cottage/shop should sink when no block supports them below.
 * This mirrors a heavy rock dropping through empty space.
 */
function settleSurfaceLandmarks() {
  for (const id of Object.values(LANDMARK_IDS)) {
    if (id === LANDMARK_IDS.WELL && !state.waterUnlocked) continue;
    const landmark = getLandmark(id);
    if (!landmark) continue;
    while (landmark.y < WORLD_HEIGHT - 1 && getCell(landmark.x, landmark.y + 1) === MATERIALS.EMPTY) {
      landmark.y += 1;
    }
  }
}

function isAtCottage() {
  const cottage = getLandmark(LANDMARK_IDS.COTTAGE);
  return state.player.y === cottage.y && wrapX(state.player.x) === wrapX(cottage.x);
}

function isAtShop() {
  const shop = getLandmark(LANDMARK_IDS.SHOP);
  return state.player.y === shop.y && wrapX(state.player.x) === wrapX(shop.x);
}

function canSpendStamina() {
  return state.stamina > 0;
}

function spendStamina(amount = 1) {
  state.stamina = Math.max(0, state.stamina - amount);
}

/** Trigger a temporary visual warning pulse in the play area for zero-stamina digging attempts. */
function triggerStaminaWarning() {
  state.staminaWarningUntil = Math.max(state.staminaWarningUntil, performance.now() + STAMINA_WARNING_MS);
}

function clearRestAction() {
  if (state.restAction?.timer) clearTimeout(state.restAction.timer);
  if (state.restAction?.tickTimer) clearInterval(state.restAction.tickTimer);
  state.restAction = null;
}

/**
 * Resting is only allowed inside the cottage tile on the surface.
 * The digger remains responsive (render loop runs) while a 10s timer refills stamina.
 */
function startRest(manual = false) {
  if (state.gameOver || state.digAction?.active) return;
  if (state.restAction?.active) return;
  if (!isAtCottage()) {
    if (manual) setMessage('Go to the cottage (🛖) tile to rest.', 'danger');
    return;
  }
  if (state.stamina >= state.maxStamina) {
    if (manual) setMessage('Stamina is already full.');
    return;
  }

  const missing = Math.max(1, state.maxStamina - state.stamina);
  const tickMs = Math.max(250, Math.floor(REST_DURATION_MS / missing));
  state.restAction = {
    active: true,
    startedAt: performance.now(),
    durationMs: REST_DURATION_MS,
    tickMs,
    timer: null,
    tickTimer: null,
  };
  setMessage('Auto-resting in cottage... stamina refilling.', 'good');
  updateHud();

  state.restAction.tickTimer = setInterval(() => {
    if (!state.restAction?.active) return;
    state.stamina = Math.min(state.maxStamina, state.stamina + 1);
    updateHud();
    if (state.stamina >= state.maxStamina) {
      clearRestAction();
      setMessage('Fully rested! Stamina restored.');
      updateHud();
    }
  }, tickMs);

  state.restAction.timer = setTimeout(() => {
    state.stamina = state.maxStamina;
    clearRestAction();
    setMessage('Fully rested! Stamina restored.');
    updateHud();
  }, REST_DURATION_MS + 120);
}


function addInventory(material, amount = 1) {
  if (!INVENTORY_DEFS[material] || amount <= 0) return;
  state.inventory[material] = (state.inventory[material] || 0) + amount;
  if (!state.selectedInventoryMaterial) state.selectedInventoryMaterial = Number(material);
}

function removeInventory(material, amount = 1) {
  if (!state.inventory[material]) return false;
  state.inventory[material] -= amount;
  if (state.inventory[material] <= 0) delete state.inventory[material];
  if (state.selectedInventoryMaterial === material && !state.inventory[material]) {
    const next = Object.keys(state.inventory).map(Number).find((m) => INVENTORY_DEFS[m]?.placeable);
    state.selectedInventoryMaterial = next || null;
  }
  return true;
}

function sellInventory() {
  if (!isAtShop()) { setMessage('Go to shop tile to sell inventory.', 'danger'); return; }
  let total = 0;
  for (const [k, count] of Object.entries(state.inventory)) {
    const def = INVENTORY_DEFS[k];
    if (!def || count <= 0) continue;
    total += def.sell * count;
  }
  state.inventory = {};
  state.selectedInventoryMaterial = null;
  state.money += total;
  setMessage(total > 0 ? `Sold inventory for $${total}.` : 'Inventory is empty.');
  updateHud();
}

function getPlacementTarget() {
  const dir = state.lastMoveDir || { dx: 0, dy: 1 };
  const tx = wrapX(state.player.x + dir.dx);
  const ty = state.player.y + dir.dy;
  if (!inBounds(tx, ty)) return null;
  return { tx, ty };
}

function placeSelectedTile(dropOnly = false) {
  const material = state.selectedInventoryMaterial;
  if (!material) { setMessage('Select an inventory material first.', 'danger'); return; }
  if (!state.inventory[material]) { setMessage('No units of that tile left.', 'danger'); return; }
  const target = getPlacementTarget();
  if (!target) return;
  const targetMaterial = getCell(target.tx, target.ty);
  // Struts may replace sand in-place so players can reinforce a collapsing lane quickly.
  const canReplaceSandWithStrut = material === MATERIALS.STRUT && targetMaterial === MATERIALS.SAND;
  if (targetMaterial !== MATERIALS.EMPTY && !canReplaceSandWithStrut) {
    setMessage('Placement target must be empty (struts can replace sand).', 'danger');
    return;
  }
  if (!dropOnly && !state.buildMode) {
    setMessage('Enable Build mode (B) before placing.', 'danger');
    return;
  }
  if (!INVENTORY_DEFS[material]?.placeable) {
    setMessage('That material cannot be placed.', 'danger');
    return;
  }
  removeInventory(material, 1);
  setCell(target.tx, target.ty, material);
  if (material === MATERIALS.TORCH) state.placedTorches.add(tileKey(target.tx, target.ty));
  setMessage(dropOnly ? 'Dropped 1 tile.' : 'Placed tile.');
  updateHud();
}

function cycleBuildMaterial() {
  const placeable = Object.keys(state.inventory).map(Number).filter((m) => INVENTORY_DEFS[m]?.placeable);
  if (!placeable.length) { state.selectedInventoryMaterial = null; updateHud(); return; }
  const idx = Math.max(0, placeable.indexOf(state.selectedInventoryMaterial));
  state.selectedInventoryMaterial = placeable[(idx + 1) % placeable.length];
  updateHud();
}

function toggleCheatMode() {
  state.cheatMode = !state.cheatMode;
  if (state.cheatMode) {
    state.money = Math.max(state.money, 999999);
    state.bombs = 999;
    state.water = 999;
    state.waterUnlocked = true;
    state.canDigRock = true;
    state.canDigPillars = true;
    state.digSpeed = 4;
    state.cooldownMs = 40;
    addInventory(MATERIALS.STRUT, 60);
    addInventory(MATERIALS.TORCH, 60);
  }
  setMessage(state.cheatMode ? 'Cheat mode ON for testing.' : 'Cheat mode OFF.');
  updateHud();
}

function setMessage(msg, tone = 'good') {
  messageBox.textContent = msg;
  messageBox.classList.toggle('is-danger', tone === 'danger');
}

function xpToNextLevel() {
  return 100 + ((state.level - 1) * 70);
}

/** Stamina cap scales with level progression so longer digs become possible later on. */
function recalculateMaxStamina() {
  const newMax = MAX_STAMINA + Math.floor((state.level - 1) / 2);
  const previousMax = state.maxStamina;
  state.maxStamina = newMax;
  if (newMax > previousMax) state.stamina += (newMax - previousMax);
  state.stamina = Math.min(state.maxStamina, state.stamina);
}

function maybeWarnLowStamina(now = performance.now()) {
  if (state.stamina > 3 || state.restAction?.active) return;
  if (now - state.lastLowStaminaWarnAt < 4500) return;
  state.lastLowStaminaWarnAt = now;
  setMessage('⚠️ Low stamina (3 or less). Head to the cottage to auto-rest soon.', 'danger');
}

function gainXp(amount) {
  state.xp += amount;
  let didLevelUp = false;
  while (state.xp >= xpToNextLevel()) {
    state.xp -= xpToNextLevel();
    state.level += 1;
    state.money += 45;
    didLevelUp = true;
    recalculateMaxStamina();
    playSfx('levelup');
    setMessage(`Level up! You are now level ${state.level}. +$45 sponsor bonus.`);
  }
  if (didLevelUp) renderShop();
}

function updateHud() {
  const atShop = isAtShop();
  // Hide the entire Miner Shop panel unless the player is standing on the shop tile.
  shopPanel.classList.toggle('is-hidden', !atShop);
  shopPanel.setAttribute('aria-hidden', atShop ? 'false' : 'true');

  $('money').textContent = Math.floor(state.money);
  $('level').textContent = state.level;
  $('xp').textContent = Math.floor(state.xp);
  $('xp-next').textContent = xpToNextLevel();
  $('depth').textContent = state.maxDepth;
  $('speed').textContent = state.digSpeed.toFixed(2);
  $('bomb-count').textContent = state.bombs;
  $('bombs').textContent = state.bombs;
  $('water').textContent = state.water;
  $('water-count').textContent = state.water;
  $('zoom-mode').textContent = state.zoom20x20 ? '20x20' : 'Auto';
  $('stamina').textContent = state.stamina;
  $('stamina-max').textContent = state.maxStamina;
  const townStatus = isAtCottage()
    ? 'At Cottage'
    : isAtShop()
      ? 'At Shop'
      : isAtWell()
        ? 'At Well'
        : 'Away';
  $('town-status').textContent = townStatus;
  $('npc-status').textContent = !state.npc.owned ? 'None' : state.npc.alive ? 'Digging' : 'Dead';
  $('zoom-btn').textContent = state.zoom20x20 ? '🔍 Zoom: 20x20' : '🔍 Zoom: Auto';
  $('auto-dig-btn').textContent = state.autoDigEnabled ? '🤖 Auto Dig: On' : '🤖 Auto Dig: Off';
  $('water-btn').disabled = state.gameOver || (!state.waterUnlocked && !isAtShop()) || state.restAction?.active;
  $('sfx-mode').textContent = state.sfxEnabled ? 'On' : 'Off';
  $('build-mode').textContent = state.buildMode ? 'On' : 'Off';
  $('cheat-mode').textContent = state.cheatMode ? 'On' : 'Off';
  const selectedDef = INVENTORY_DEFS[state.selectedInventoryMaterial];
  $('build-tile').textContent = selectedDef ? `${selectedDef.icon} ${selectedDef.name}` : 'None';
  $('sfx-btn').textContent = state.sfxEnabled ? '🔊 SFX: On' : '🔇 SFX: Off';
  $('build-btn').textContent = state.buildMode ? '🧱 Build: On' : '🧱 Build: Off';
  $('cheat-btn').textContent = state.cheatMode ? '🧪 Cheat: On' : '🧪 Cheat: Off';
  $('status').textContent = state.gameOver ? 'Game Over' : state.restAction?.active ? 'Resting' : 'Active';
  $('rest-btn').disabled = state.gameOver || !isAtCottage() || state.stamina >= state.maxStamina || !!state.digAction?.active;
  $('sell-btn').disabled = state.gameOver || !isAtShop();
  $('drop-btn').disabled = state.gameOver || !state.selectedInventoryMaterial || !state.inventory[state.selectedInventoryMaterial];

  if (state.cheatMode) {
    state.money = Math.max(state.money, 999999);
    state.stamina = state.maxStamina;
    state.bombs = Math.max(state.bombs, 999);
    state.water = Math.max(state.water, 999);
  }

  const progressFill = $('rest-progress-fill');
  const progressText = $('rest-progress-text');
  if (state.restAction?.active) {
    const elapsed = performance.now() - state.restAction.startedAt;
    const progress = Math.min(1, elapsed / state.restAction.durationMs);
    progressFill.style.width = `${Math.round(progress * 100)}%`;
    progressText.textContent = `Resting ${Math.round(progress * 100)}%`;
  } else {
    progressFill.style.width = state.stamina >= state.maxStamina ? '100%' : '0%';
    progressText.textContent = state.stamina >= state.maxStamina ? 'Ready' : 'Needs Rest';
  }

  const list = $('inventory-list');
  list.innerHTML = "";
  const mats = Object.keys(state.inventory).map(Number).sort((a, b) => (INVENTORY_DEFS[b]?.sell || 0) - (INVENTORY_DEFS[a]?.sell || 0));
  if (!mats.length) {
    const empty = document.createElement('p');
    empty.className = 'shop-hint';
    empty.textContent = 'Inventory empty. Dig to collect blocks and valuables.';
    list.appendChild(empty);
  }
  for (const material of mats) {
    const def = INVENTORY_DEFS[material];
    if (!def) continue;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `inventory-item ${state.selectedInventoryMaterial === material ? 'is-selected' : ''}`;
    row.title = `${def.name}: sell $${def.sell} each${def.placeable ? ' (placeable)' : ''}`;
    row.innerHTML = `<span class="label">${def.icon} ${def.name}</span><span class="count">x${state.inventory[material]}</span>`;
    row.addEventListener('click', () => { state.selectedInventoryMaterial = material; updateHud(); });
    list.appendChild(row);
  }

  renderShop();
}

/** Struts are structural braces: pass-through for movement but block gravity/digging. */
function isPassThroughMaterial(material) {
  return material === MATERIALS.EMPTY || material === MATERIALS.STRUT;
}

function canDig(material, direction) {
  if ([MATERIALS.EMPTY, MATERIALS.SAND, MATERIALS.TREASURE, MATERIALS.GRASS, MATERIALS.RELIC, MATERIALS.CRYSTAL, MATERIALS.GOLD, MATERIALS.DIAMOND, MATERIALS.RUBY, MATERIALS.EMERALD, MATERIALS.SAPPHIRE, MATERIALS.GEMSTONE, MATERIALS.TORCH].includes(material)) return true;
  if (material === MATERIALS.STRUT) return false;
  if (material === MATERIALS.ROCK && direction === 'side' && state.canDigPillars) return true;
  if (material === MATERIALS.ROCK) return state.canDigRock;
  if (material === MATERIALS.GRANITE) return state.canDigRock;
  if (material === MATERIALS.LAVA) return false;
  return false;
}

function settleColumn(x) {
  const wx = wrapX(x);
  for (let y = WORLD_HEIGHT - 2; y >= 0; y -= 1) {
    const curr = getCell(wx, y);
    if (curr === MATERIALS.EMPTY || curr === MATERIALS.STRUT) continue;
    if (getCell(wx, y + 1) === MATERIALS.EMPTY) {
      setCell(wx, y + 1, curr);
      setCell(wx, y, MATERIALS.EMPTY);
    }
  }
}

function collectTreasure(siteDef, x, y) {
  const payout = Math.floor((45 + Math.random() * 50) * (state.lootMultiplier || 1));
  addInventory(MATERIALS.TREASURE, 1);
  gainXp(26 * siteDef.xpBonus);
  spawnParticles(x, y, '#ffdf55', 14, 1.2);
  playSfx('treasure');
  setMessage(`Treasure found! Added to inventory ($${payout} value).`);
}

/** Additional collectible node: relic cache with larger money and XP burst. */
function collectRelic(siteDef, x, y) {
  const payout = Math.floor((85 + Math.random() * 65) * (state.lootMultiplier || 1));
  addInventory(MATERIALS.RELIC, 1);
  gainXp(34 * siteDef.xpBonus);
  spawnParticles(x, y, '#d39b69', 16, 1.3);
  playSfx('treasure');
  setMessage(`Ancient relic recovered and stored ($${payout} value).`);
}

/** Additional collectible node: crystal seam that can also grant a bonus bomb. */
function collectCrystal(siteDef, x, y) {
  const payout = Math.floor((62 + Math.random() * 42) * (state.lootMultiplier || 1));
  addInventory(MATERIALS.CRYSTAL, 1);
  gainXp(30 * siteDef.xpBonus);
  const bonusBomb = Math.random() < 0.25;
  if (bonusBomb) state.bombs += 1;
  spawnParticles(x, y, '#7be8ff', 14, 1.1);
  playSfx('treasure');
  setMessage(`Crystal cache stored ($${payout} value).${bonusBomb ? " +1 bonus bomb!" : ""}`);
}

/** Collect from deep mineral veins/deposits with unique payouts and XP. */
function collectMineral(siteDef, x, y, material) {
  const def = MINERAL_DEFS[material];
  if (!def) return;
  const payout = Math.floor((def.payoutMin + (Math.random() * def.payoutVar)) * (state.lootMultiplier || 1));
  addInventory(material, 1);
  gainXp(def.xp * siteDef.xpBonus);
  spawnParticles(x, y, def.frameA, 16, 1.25);
  playSfx('treasure');
  setMessage(`${def.name} mined and stashed ($${payout} value).`);
}

function digCell(x, y, direction, siteDef) {
  if (!inBounds(x, y)) return false;
  const material = getCell(x, y);

  if (!canDig(material, direction)) {
    if (material === MATERIALS.ROCK) setMessage('Rock Drill upgrade required for this block.', 'danger');
    if (material === MATERIALS.METAL) setMessage('Too hard to dig. Use a bomb!', 'danger');
    if (material === MATERIALS.GRANITE) setMessage('Granite needs Rock Drill or bombs.', 'danger');
    if (material === MATERIALS.LAVA) setMessage('Lava is unpassable. Cool it with water first.', 'danger');
    if (material === MATERIALS.STRUT) setMessage('Placed struts are permanent supports and cannot be mined.', 'danger');
    playSfx('blocked');
    return false;
  }

  if (material === MATERIALS.TREASURE) collectTreasure(siteDef, x, y);
  if (material === MATERIALS.RELIC) collectRelic(siteDef, x, y);
  if (material === MATERIALS.CRYSTAL) collectCrystal(siteDef, x, y);
  if (ANIMATED_MINERALS.has(material)) collectMineral(siteDef, x, y, material);
  if (material !== MATERIALS.EMPTY) {
    if (![MATERIALS.TREASURE, MATERIALS.RELIC, MATERIALS.CRYSTAL].includes(material) && !ANIMATED_MINERALS.has(material)) addInventory(material, 1);
    if (material === MATERIALS.TORCH) state.placedTorches.delete(tileKey(x, y));
    setCell(x, y, MATERIALS.EMPTY);
    // Reverse origin spray so chunks kick back opposite the current dig direction.
    spawnParticles(x, y, getMaterialColor(material), 8, 1.05, state.player.x, state.player.y, true);
    playSfx('dig');
    gainXp(7 * siteDef.xpBonus);
    spendStamina(1);
    maybeWarnLowStamina();
  }
  return true;
}

/**
 * Runs a delayed dig action so each block takes ~3 seconds to mine.
 * Keeps the loop responsive by storing state and finishing via setTimeout.
 */
function beginTimedDig(nx, ny, direction, siteDef) {
  if (state.digAction?.active || state.gameOver) return;

  const material = getCell(nx, ny);
  if (material === MATERIALS.EMPTY) {
    completeMove(nx, ny, dyFromDirection(direction), siteDef);
    return;
  }

  const durationMs = state.cheatMode ? 220 : 3000;
  const startedAt = performance.now();

  state.digAction = {
    active: true,
    startedAt,
    durationMs,
    targetX: nx,
    targetY: ny,
    direction,
    siteDef,
    frame: 0,
    sfxTimer: null,
    dustTimer: null,
    doneTimer: null,
  };

  // Keep a steady 5-frame loop over 3 seconds for visible digging feedback.
  const frameIntervalMs = Math.floor(durationMs / 5);
  state.digAction.sfxTimer = setInterval(() => {
    if (!state.digAction?.active) return;
    const elapsed = performance.now() - startedAt;
    const frame = Math.min(4, Math.floor((elapsed / durationMs) * 5));
    state.digAction.frame = frame;
    playSfx('dig-loop');
  }, frameIntervalMs);

  // Extra dirt spray while actively digging adds feedback for each shovel stroke.
  state.digAction.dustTimer = setInterval(() => {
    if (!state.digAction?.active) return;
    spawnDigDustBurst(state.digAction);
  }, 110);

  setMessage('Digging block... (3s)');

  state.digAction.doneTimer = setTimeout(() => {
    const activeDig = state.digAction;
    if (!activeDig?.active) return;
    if (activeDig.sfxTimer) clearInterval(activeDig.sfxTimer);
    if (activeDig.dustTimer) clearInterval(activeDig.dustTimer);

    const didDig = digCell(nx, ny, direction, siteDef);
    state.digAction = null;
    if (!didDig) return;

    completeMove(nx, ny, dyFromDirection(direction), siteDef);
  }, durationMs);
}

function dyFromDirection(direction) {
  if (direction === 'down') return 1;
  if (direction === 'up') return -1;
  return 0;
}

function completeMove(nx, ny, dy, siteDef) {
  const prevX = state.player.x;
  const prevY = state.player.y;
  state.playerAnim.bobPhase += 0.85;
  const horizontalDelta = shortestWrappedDelta(state.player.x, nx);
  state.playerAnim.facing = horizontalDelta < 0 ? -1 : horizontalDelta > 0 ? 1 : state.playerAnim.facing;
  state.player.x = nx;
  state.player.y = ny;
  state.maxDepth = Math.max(state.maxDepth, ny);
  startMoveAnimation(prevX, prevY, nx, ny);
  markVisibleArea(state.player.x, state.player.y);

  if (dy === 0 && state.digRadius > 1) {
    digCell(nx, Math.min(WORLD_HEIGHT - 1, ny + 1), 'down', siteDef);
  }

  settleColumn(nx);
  settleColumn(state.player.x);
  settleSurfaceLandmarks();
  if (isAtCottage() && state.stamina < state.maxStamina) startRest();
  maybeWarnLowStamina();
  updateHud();
  draw();

  if (isTrapped()) endGameFromTrap();
}

/**
 * Detect a trap state: no legal movement in 4-neighborhood and no bombs.
 * This makes being fully boxed by hard blocks a lose condition.
 */
function isTrapped() {
  if (state.bombs > 0) return false;
  const directions = [
    { dx: 0, dy: -1, name: 'up' },
    { dx: 0, dy: 1, name: 'down' },
    { dx: -1, dy: 0, name: 'side' },
    { dx: 1, dy: 0, name: 'side' },
  ];

  return !directions.some((dir) => {
    const nx = wrapX(state.player.x + dir.dx);
    const ny = state.player.y + dir.dy;
    if (!inBounds(nx, ny)) return false;
    const material = getCell(nx, ny);
    return canDig(material, dir.name) || isPassThroughMaterial(material) || material === MATERIALS.TREASURE;
  });
}

function endGameFromTrap() {
  state.gameOver = true;
  playSfx('gameover');
  setMessage('You are trapped with no escape path or bombs left. Game over! Press Start Dig to restart.', 'danger');
  updateHud();
  draw();
}

function movePlayer(dx, dy) {
  if (!state.gameStarted) {
    setMessage('Press Start Dig to begin this expedition.', 'danger');
    return;
  }
  if (state.gameOver || state.digAction?.active) return;
  if (state.restAction?.active) clearRestAction();
  const now = performance.now();
  if (now - state.lastMoveAt < state.cooldownMs) return;

  state.lastMoveDir = { dx, dy };
  const nx = wrapX(state.player.x + dx);
  const ny = state.player.y + dy;
  if (!inBounds(0, ny)) return;

  const siteDef = SITE_DEFS.find((site) => site.id === state.selectedSiteId);
  const direction = dy > 0 ? 'down' : dy < 0 ? 'up' : 'side';
  const targetMaterial = getCell(nx, ny);

  // Pure movement into pass-through cells stays instant (no 3-second dig action).
  if (isPassThroughMaterial(targetMaterial)) {
    state.lastMoveAt = now;
    completeMove(nx, ny, dy, siteDef);
    return;
  }

  if (!isPassThroughMaterial(targetMaterial) && !canSpendStamina()) {
    // Emergency movement rule: with zero stamina, upward movement through loose sand is allowed.
    if (direction === 'up' && targetMaterial === MATERIALS.SAND) {
      setCell(nx, ny, MATERIALS.EMPTY);
      state.lastMoveAt = now;
      completeMove(nx, ny, dy, siteDef);
      return;
    }
    triggerStaminaWarning();
    setMessage('No stamina. Return to the cottage (🛖) and rest for 10s.', 'danger');
    playSfx('blocked');
    updateHud();
    return;
  }

  if (!canDig(targetMaterial, direction)) {
    // Reuse existing error messages and blocked SFX for undiggable materials.
    digCell(nx, ny, direction, siteDef);
    return;
  }

  // Only actual digging starts the timed 3-second mining action.
  state.lastMoveAt = now;
  beginTimedDig(nx, ny, direction, siteDef);
}

function autoCanMoveInto(nx, ny, direction) {
  if (!inBounds(nx, ny)) return false;
  const material = getCell(nx, ny);
  if (material === MATERIALS.LAVA) return false;
  if (isPassThroughMaterial(material)) return true;
  return canDig(material, direction);
}

/** Keep auto-dig conservative: do not move into cells that leave no nearby exits. */
function autoHasEscapeAt(nx, ny) {
  const dirs = [
    { dx: 0, dy: -1, direction: 'up' },
    { dx: 0, dy: 1, direction: 'down' },
    { dx: -1, dy: 0, direction: 'side' },
    { dx: 1, dy: 0, direction: 'side' },
  ];
  return dirs.some((d) => {
    const tx = wrapX(nx + d.dx);
    const ty = ny + d.dy;
    return autoCanMoveInto(tx, ty, d.direction);
  });
}

function tryAutoMove(dx, dy) {
  state.lastMoveDir = { dx, dy };
  const nx = wrapX(state.player.x + dx);
  const ny = state.player.y + dy;
  if (!inBounds(0, ny)) return false;
  const direction = dy > 0 ? 'down' : dy < 0 ? 'up' : 'side';
  if (!autoCanMoveInto(nx, ny, direction)) return false;
  if (!autoHasEscapeAt(nx, ny)) return false;
  movePlayer(dx, dy);
  return true;
}

function updateAutoDig(now = performance.now()) {
  if (!state.autoDigEnabled || !state.gameStarted) return;
  if (state.gameOver || state.digAction?.active || state.restAction?.active) return;
  if (now - state.lastMoveAt < state.cooldownMs) return;

  const cottage = getLandmark(LANDMARK_IDS.COTTAGE);

  // Safety-first: route home when stamina is low, then auto-rest.
  if (state.stamina <= 3) {
    if (isAtCottage()) {
      startRest();
      return;
    }
    if (state.player.y > cottage.y) {
      if (tryAutoMove(0, -1)) return;
    }
    const step = wrappedStepDirection(state.player.x, cottage.x);
    if (tryAutoMove(step, 0)) return;
    if (tryAutoMove(-step, 0)) return;
    if (tryAutoMove(0, -1)) return;
    return;
  }

  // Priority 1: immediately adjacent valuables.
  const valuableDirs = [
    { dx: 0, dy: 1, direction: 'down' },
    { dx: -1, dy: 0, direction: 'side' },
    { dx: 1, dy: 0, direction: 'side' },
    { dx: 0, dy: -1, direction: 'up' },
  ];
  for (const d of valuableDirs) {
    const nx = wrapX(state.player.x + d.dx);
    const ny = state.player.y + d.dy;
    if (!inBounds(nx, ny)) continue;
    const material = getCell(nx, ny);
    if (![MATERIALS.TREASURE, MATERIALS.RELIC, MATERIALS.CRYSTAL, MATERIALS.GOLD, MATERIALS.DIAMOND, MATERIALS.RUBY, MATERIALS.EMERALD, MATERIALS.SAPPHIRE, MATERIALS.GEMSTONE].includes(material)) continue;
    if (tryAutoMove(d.dx, d.dy)) return;
  }

  // Priority 2: progress deeper safely.
  if (tryAutoMove(0, 1)) return;

  // Priority 3: carve sideways, then up as last resort.
  const sideStep = Math.random() < 0.5 ? -1 : 1;
  if (tryAutoMove(sideStep, 0)) return;
  if (tryAutoMove(-sideStep, 0)) return;
  tryAutoMove(0, -1);
}

function useBomb() {
  if (!state.gameStarted) return;
  if (state.gameOver || state.digAction?.active || state.restAction?.active) return;
  if (state.bombs <= 0) {
    setMessage('Out of bombs. Buy Bomb Pack in the shop.', 'danger');
    playSfx('blocked');
    return;
  }

  const originX = state.player.x;
  const originY = Math.min(WORLD_HEIGHT - 1, state.player.y + 1);

  for (let y = originY - 1; y <= originY + 1; y += 1) {
    for (let x = originX - 1; x <= originX + 1; x += 1) {
      if (!inBounds(x, y)) continue;
      const cell = getCell(x, y);
      if (cell === MATERIALS.STRUT) continue;
      if (cell === MATERIALS.LAVA) state.lavaSources.delete(lavaKey(x, y));
      setCell(x, y, MATERIALS.EMPTY);
      spawnParticles(x, y, '#ff9466', 8, 1.6);
      settleColumn(x);
    }
  }

  settleSurfaceLandmarks();

  state.bombs -= 1;
  gainXp(20);
  playSfx('bomb');
  setMessage('Boom! Area cleared.');
  updateHud();
  draw();
}

function renderShop() {
  const container = $('shop-items');
  container.innerHTML = '';

  // Keep shop completely hidden unless the player is physically on the shop landmark tile.
  if (!isAtShop()) return;

  upgrades.forEach((upgrade) => {
    const cost = Math.floor(upgrade.baseCost * (1 + ((state.level - 1) * 0.1)));
    const levelLocked = state.level < upgrade.requiredLevel;

    const box = document.createElement('div');
    box.className = 'shop-item';

    const name = document.createElement('strong');
    name.textContent = `${upgrade.name} — $${cost} (Lvl ${upgrade.requiredLevel}+)`;

    const desc = document.createElement('p');
    desc.textContent = upgrade.desc;

    const atShop = isAtShop();
    const alreadyOwned = upgrade.oneTime && upgrade.isOwned?.();
    const customBlocked = upgrade.canBuy && !upgrade.canBuy();

    box.append(name, desc);

    // Hard-hide purchase controls unless the player is physically on the shop tile.
    if (atShop) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.title = levelLocked
        ? `Reach level ${upgrade.requiredLevel} to unlock ${upgrade.name}`
        : alreadyOwned
          ? `${upgrade.name} already unlocked`
          : customBlocked
            ? `Cannot buy ${upgrade.name} right now`
            : `Buy ${upgrade.name}`;
      btn.textContent = alreadyOwned ? 'Owned' : 'Buy Upgrade';
      btn.disabled = state.money < cost || levelLocked || state.gameOver || alreadyOwned || customBlocked;
      btn.addEventListener('click', () => {
        if (state.money < cost || levelLocked || state.gameOver || alreadyOwned || customBlocked) return;
        if (!isAtShop()) {
          setMessage('Go to the surface shop tile (🛒) to buy upgrades.', 'danger');
          playSfx('blocked');
          return;
        }
        state.money -= cost;
        if (upgrade.id === 'bomb-pack') state.bombs += state.bombPackBonus || 0;
        upgrade.apply();
        setMessage(`${upgrade.name} purchased.`);
        updateHud();
        draw();
      });
      box.append(btn);
    }
    container.appendChild(box);
  });
}

function startSelectedSite() {
  const siteDef = SITE_DEFS.find((site) => site.id === state.selectedSiteId);
  state.gameStarted = true;
  $('site-select-wrap').classList.add('is-hidden');
  setMessage('Generating 200x1000 looping world...');

  setTimeout(() => {
    state.world = buildWorld(siteDef);
    state.explored = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);
    state.player = { x: Math.floor(WORLD_WIDTH / 2), y: 0 };
    state.camera = { x: 0, y: 0 };
    state.surfaceLandmarks = {
      [LANDMARK_IDS.COTTAGE]: { x: SURFACE_SPOTS.cottageX, y: 0 },
      [LANDMARK_IDS.SHOP]: { x: SURFACE_SPOTS.shopX, y: 0 },
      [LANDMARK_IDS.WELL]: { x: SURFACE_SPOTS.shopX + 1, y: 0 },
    };
    state.maxDepth = 0;
    state.gameOver = false;
    state.bombPackBonus = 0;
    state.lootMultiplier = 1;
    state.waterUnlocked = false;
    state.water = 0;
    state.lastLavaFlowAt = 0;
    state.npc = { owned: false, alive: false, x: 0, y: 0, stamina: 8, maxStamina: 8, nextActionAt: 0, restUntil: 0 };
    state.autoDigEnabled = false;
    state.inventory = {};
    state.selectedInventoryMaterial = null;
    state.buildMode = false;
    state.cheatMode = false;
    state.lastMoveDir = { dx: 0, dy: 1 };
    state.placedTorches = new Set();
    if (state.digAction?.sfxTimer) clearInterval(state.digAction.sfxTimer);
    if (state.digAction?.dustTimer) clearInterval(state.digAction.dustTimer);
    if (state.digAction?.doneTimer) clearTimeout(state.digAction.doneTimer);
    state.digAction = null;
    state.moveAnim = null;
    state.particles = [];
    state.maxStamina = MAX_STAMINA;
    state.stamina = state.maxStamina;
    recalculateMaxStamina();
    state.staminaWarningUntil = 0;
    state.lastLowStaminaWarnAt = 0;
    state.lastGrassSpreadAt = 0;
    initLavaSourcesFromWorld();
    clearRestAction();
    markVisibleArea(state.player.x, state.player.y);
    setMessage(`Expedition active at ${siteDef.name}. Dig down and get rich!`);
    updateHud();
    draw();
  }, 0);
}

function bindUi() {
  for (const site of SITE_DEFS) {
    const option = document.createElement('option');
    option.value = site.id;
    option.textContent = site.name;
    siteSelect.appendChild(option);
  }

  siteSelect.addEventListener('change', (event) => {
    state.selectedSiteId = event.target.value;
    setMessage(`Site selected: ${SITE_DEFS.find((site) => site.id === state.selectedSiteId).name}. Press Start Dig.`);
  });

  $('start-btn').addEventListener('click', startSelectedSite);
  $('bomb-btn').addEventListener('click', useBomb);
  $('zoom-btn').addEventListener('click', () => {
    state.zoom20x20 = !state.zoom20x20;
    updateHud();
    draw();
  });
  $('rest-btn').addEventListener('click', () => startRest(true));
  $('water-btn').addEventListener('click', useWater);
  $('auto-dig-btn').addEventListener('click', () => {
    if (!state.gameStarted) {
      setMessage('Press Start Dig before enabling auto-dig.', 'danger');
      return;
    }
    state.autoDigEnabled = !state.autoDigEnabled;
    setMessage(state.autoDigEnabled ? 'Auto-dig enabled.' : 'Auto-dig disabled.');
    updateHud();
  });
  $('sfx-btn').addEventListener('click', () => {
    state.sfxEnabled = !state.sfxEnabled;
    updateHud();
  });
  $('cheat-btn').addEventListener('click', toggleCheatMode);
  $('sell-btn').addEventListener('click', sellInventory);
  $('build-btn').addEventListener('click', () => { state.buildMode = !state.buildMode; updateHud(); });
  $('drop-btn').addEventListener('click', () => placeSelectedTile(true));

  const helpDialog = $('help-dialog');
  $('help-btn').addEventListener('click', () => helpDialog.showModal());
  $('close-help').addEventListener('click', () => helpDialog.close());

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (['arrowup', 'w'].includes(key)) movePlayer(0, -1);
    if (['arrowdown', 's'].includes(key)) movePlayer(0, 1);
    if (['arrowleft', 'a'].includes(key)) movePlayer(-1, 0);
    if (['arrowright', 'd'].includes(key)) movePlayer(1, 0);
    if (key === ' ') {
      event.preventDefault();
      useBomb();
    }
    if (key === 'z') {
      state.zoom20x20 = !state.zoom20x20;
      updateHud();
      draw();
    }
    if (key === 'r') startRest(true);
    if (key === 'q') useWater();
    if (key === 'm') {
      state.sfxEnabled = !state.sfxEnabled;
      updateHud();
    }
    if (key === 'b') { state.buildMode = !state.buildMode; updateHud(); }
    if (key === 'c') cycleBuildMaterial();
    if (key === 'e') placeSelectedTile(false);
    if (key === 'x') toggleCheatMode();
  });

  window.addEventListener('resize', draw);

  // Continuous redraw keeps lightweight animations smooth.
  const loop = () => {
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

bindUi();
setMessage('Choose a site, then press Start Dig to begin.');
updateHud();
draw();
