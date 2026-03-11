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
const GRASS_REGROW_MS = 30000;

// Surface buildings placed next to each other at the top lane.
const SURFACE_SPOTS = {
  cottageX: Math.floor(WORLD_WIDTH / 2) - 1,
  shopX: Math.floor(WORLD_WIDTH / 2),
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
};

const SITE_DEFS = [
  { id: 'egypt', name: 'Giza Sands (Easy)', rockBias: 0.05, metalBias: 0.00, graniteBias: 0.00, treasureBias: 0.012, xpBonus: 1.0 },
  { id: 'andes', name: 'Andes Ruins (Medium)', rockBias: 0.08, metalBias: 0.02, graniteBias: 0.01, treasureBias: 0.014, xpBonus: 1.22 },
  { id: 'atlantis', name: 'Sunken Atlantis (Hard)', rockBias: 0.12, metalBias: 0.03, graniteBias: 0.018, treasureBias: 0.016, xpBonus: 1.5 },
  { id: 'himalaya', name: 'Himalayan Vault (Expert)', rockBias: 0.15, metalBias: 0.04, graniteBias: 0.024, treasureBias: 0.018, xpBonus: 1.8 },
];

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
  maxDepth: 0,
  // Start zoomed-in by default so the play area is easier to read on high-DPI displays.
  zoom20x20: true,
  gameOver: false,
  sfxEnabled: true,
  particles: [],
  playerAnim: { bobPhase: 0, facing: 1 },
  // Active timed dig action (3 seconds) with a 5-frame animation.
  digAction: null,
  stamina: MAX_STAMINA,
  maxStamina: MAX_STAMINA,
  restAction: null,
  // Tracks pending regrowth timers so grass returns 30 seconds after mining.
  grassRegrowTimers: new Map(),
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
    desc: 'Allows mining standard rock.',
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
];

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
const siteSelect = $('site-select');
const messageBox = $('message');
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

  if (dist <= 1) return 0;

  if (dist >= FOW_SIGHT_RADIUS) {
    return explored ? 0.42 : 1;
  }

  const t = (dist - 1) / (FOW_SIGHT_RADIUS - 1);
  const activeFog = Math.min(1, Math.max(0, t ** 1.35));
  return explored ? activeFog * 0.45 : activeFog;
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
function getSurfaceHorizonScreenY(tileSize, offsetY, boardHeightPx) {
  const boardTop = offsetY;
  const boardBottom = offsetY + boardHeightPx;
  const grassRowScreenY = offsetY + ((1 - state.camera.y) * tileSize);
  const surfaceSkyHorizon = offsetY + Math.floor(boardHeightPx * 0.5);
  const useSurfaceSkyView = state.player.y <= 1;
  const rawHorizon = useSurfaceSkyView
    ? Math.max(grassRowScreenY, surfaceSkyHorizon)
    : grassRowScreenY;
  return Math.max(boardTop, Math.min(boardBottom, rawHorizon));
}

function drawSurface(tileSize, _viewportCols, offsetX, offsetY, boardWidthPx, boardHeightPx) {
  // Draw sky/soil inside the board bounds so the terrain and background start at the same point.
  const boardTop = offsetY;
  const boardBottom = offsetY + boardHeightPx;
  const horizon = getSurfaceHorizonScreenY(tileSize, offsetY, boardHeightPx);

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

  // Draw cottage and shop at y=0 so navigation targets are visible.
  const surfaceY = 0;
  const cottageScreenX = offsetX + ((wrapX(SURFACE_SPOTS.cottageX - state.camera.x)) * tileSize);
  const shopScreenX = offsetX + ((wrapX(SURFACE_SPOTS.shopX - state.camera.x)) * tileSize);
  const buildingY = offsetY + ((surfaceY - state.camera.y) * tileSize);
  if (buildingY + tileSize > 0 && buildingY < canvas.height) {
    drawSurfaceBuilding(cottageScreenX, buildingY, tileSize, '#7a4f2b', '🛖');
    drawSurfaceBuilding(shopScreenX, buildingY, tileSize, '#2f5f96', '🛒');
  }
}

function drawSurfaceBuilding(screenX, screenY, tileSize, color, emoji) {
  const w = Math.max(18, Math.floor(tileSize * 1.8));
  const h = Math.max(14, Math.floor(tileSize * 1.2));
  const x = Math.floor(screenX - ((w - tileSize) / 2));
  const y = Math.floor(screenY - h - 2);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(x, y, w, Math.max(3, Math.floor(h * 0.25)));
  ctx.font = `${Math.max(11, Math.floor(tileSize * 0.85))}px Trebuchet MS`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff4d0';
  ctx.fillText(emoji, x + (w / 2), y + h - Math.max(2, Math.floor(h * 0.2)));
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

/** Grass at the surface grows back after a fixed cooldown to keep the map readable. */
function scheduleGrassRegrowth(x, y) {
  const key = `${wrapX(x)},${y}`;
  const previousTimer = state.grassRegrowTimers.get(key);
  if (previousTimer) clearTimeout(previousTimer);

  const timer = setTimeout(() => {
    state.grassRegrowTimers.delete(key);
    if (getCell(x, y) === MATERIALS.EMPTY) setCell(x, y, MATERIALS.GRASS);
  }, GRASS_REGROW_MS);

  state.grassRegrowTimers.set(key, timer);
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
  resizeCanvasToDisplaySize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const fixedTiles = state.zoom20x20 ? 20 : null;
  // Keep visible tile count tight so player can stay centered unless clamped by world edges.
  const viewportCols = fixedTiles ?? Math.ceil(canvas.width / TILE_SIZE);
  const viewportRows = fixedTiles ?? Math.ceil(canvas.height / TILE_SIZE);
  const tileSize = fixedTiles ? Math.floor(Math.min(canvas.width, canvas.height) / fixedTiles) : TILE_SIZE;
  const boardWidthPx = viewportCols * tileSize;
  const boardHeightPx = viewportRows * tileSize;
  const offsetX = Math.floor((canvas.width - boardWidthPx) / 2);
  const offsetY = Math.floor((canvas.height - boardHeightPx) / 2);

  // Camera centers on the player; at the surface we allow negative camera Y so the player stays centered.
  state.camera.x = wrapX(state.player.x - Math.floor(viewportCols / 2));
  const targetCameraY = state.player.y - Math.floor(viewportRows / 2);
  const topSkyRows = Math.max(0, Math.floor(viewportRows / 2) - 1);
  const minCameraY = -topSkyRows;
  state.camera.y = Math.max(minCameraY, Math.min(WORLD_HEIGHT - viewportRows, targetCameraY));

  drawSurface(tileSize, viewportCols, offsetX, offsetY, boardWidthPx, boardHeightPx);

  // Apply underground vignette only below the surface horizon so the blue sky stays visible.
  const horizon = getSurfaceHorizonScreenY(tileSize, offsetY, boardHeightPx);
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
      const px = offsetX + (vx * tileSize);
      const py = offsetY + (vy * tileSize);
      ctx.fillStyle = getMaterialColor(material);
      ctx.fillRect(px, py, tileSize, tileSize);

      if (material !== MATERIALS.EMPTY) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(px + 2, py + 2, Math.max(2, tileSize - 4), Math.max(2, Math.floor(tileSize * 0.18)));
      }

      // Overlay landmark icons so cottage/shop remain visible while on the surface lane.
      if (wy === 0 && wx === wrapX(SURFACE_SPOTS.cottageX)) {
        drawSurfaceIconTile(px, py, tileSize, '#8e5a31', '🛖');
      } else if (wy === 0 && wx === wrapX(SURFACE_SPOTS.shopX)) {
        drawSurfaceIconTile(px, py, tileSize, '#366fb0', '🛒');
      }

      if (material === MATERIALS.TREASURE) {
        const twinkle = (Math.sin((performance.now() / 220) + ((wx + wy) * 0.3)) + 1) / 2;
        const gemSize = Math.max(4, Math.floor(tileSize * (0.28 + twinkle * 0.14)));
        ctx.fillStyle = '#5d4300';
        ctx.fillRect(px + Math.floor((tileSize - gemSize) / 2), py + Math.floor((tileSize - gemSize) / 2), gemSize, gemSize);
      }

      const fogAlpha = getFogAlpha(wx, wy);
      if (fogAlpha > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${fogAlpha.toFixed(3)})`;
        ctx.fillRect(px, py, tileSize, tileSize);
      }

      ctx.strokeStyle = '#131723';
      ctx.strokeRect(px, py, tileSize, tileSize);
    }
  }

  updateParticles();
  for (const p of state.particles) {
    const sx = offsetX + ((p.x - state.camera.x) * tileSize);
    const sy = offsetY + ((p.y - state.camera.y) * tileSize);
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

  // Convert world X -> viewport X with wrap awareness so edge-crossing never places
  // the player sprite off-screen when camera.x wrapped to the other side.
  const playerViewportX = wrapX(state.player.x - state.camera.x);
  const playerScreenX = offsetX + (playerViewportX * tileSize);
  const playerScreenY = offsetY + ((state.player.y - state.camera.y) * tileSize);
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

  if (state.gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(offsetX, offsetY, boardWidthPx, boardHeightPx);
    ctx.fillStyle = '#ff5f73';
    ctx.font = `bold ${Math.max(18, Math.floor(tileSize * 1.1))}px Trebuchet MS`;
    ctx.textAlign = 'center';
    ctx.fillText('TRAPPED! GAME OVER', offsetX + (boardWidthPx / 2), offsetY + (boardHeightPx / 2));
  }
}

function isAtCottage() {
  return state.player.y === 0 && wrapX(state.player.x) === wrapX(SURFACE_SPOTS.cottageX);
}

function isAtShop() {
  return state.player.y === 0 && wrapX(state.player.x) === wrapX(SURFACE_SPOTS.shopX);
}

function canSpendStamina() {
  return state.stamina > 0;
}

function spendStamina(amount = 1) {
  state.stamina = Math.max(0, state.stamina - amount);
}

function clearRestAction() {
  if (state.restAction?.timer) clearTimeout(state.restAction.timer);
  state.restAction = null;
}

/**
 * Resting is only allowed inside the cottage tile on the surface.
 * The digger remains responsive (render loop runs) while a 10s timer refills stamina.
 */
function startRest() {
  if (state.gameOver || state.digAction?.active) return;
  if (state.restAction?.active) {
    setMessage('Already resting in the cottage...', 'good');
    return;
  }
  if (!isAtCottage()) {
    setMessage('Go to the cottage (🛖) at the surface to rest.', 'danger');
    playSfx('blocked');
    return;
  }
  if (state.stamina >= state.maxStamina) {
    setMessage('Stamina is already full.');
    return;
  }

  state.restAction = {
    active: true,
    startedAt: performance.now(),
    durationMs: REST_DURATION_MS,
    timer: null,
  };
  setMessage('Resting in cottage... 10 seconds to full stamina.');
  updateHud();

  state.restAction.timer = setTimeout(() => {
    state.stamina = state.maxStamina;
    clearRestAction();
    setMessage('Fully rested! Stamina restored.');
    updateHud();
  }, REST_DURATION_MS);
}

function setMessage(msg, tone = 'good') {
  messageBox.textContent = msg;
  messageBox.classList.toggle('is-danger', tone === 'danger');
}

function xpToNextLevel() {
  return 100 + ((state.level - 1) * 70);
}

function gainXp(amount) {
  state.xp += amount;
  let didLevelUp = false;
  while (state.xp >= xpToNextLevel()) {
    state.xp -= xpToNextLevel();
    state.level += 1;
    state.money += 45;
    didLevelUp = true;
    playSfx('levelup');
    setMessage(`Level up! You are now level ${state.level}. +$45 sponsor bonus.`);
  }
  if (didLevelUp) renderShop();
}

function updateHud() {
  $('money').textContent = Math.floor(state.money);
  $('level').textContent = state.level;
  $('xp').textContent = Math.floor(state.xp);
  $('xp-next').textContent = xpToNextLevel();
  $('depth').textContent = state.maxDepth;
  $('speed').textContent = state.digSpeed.toFixed(2);
  $('bomb-count').textContent = state.bombs;
  $('bombs').textContent = state.bombs;
  $('zoom-mode').textContent = state.zoom20x20 ? '20x20' : 'Auto';
  $('stamina').textContent = state.stamina;
  $('stamina-max').textContent = state.maxStamina;
  $('town-status').textContent = isAtCottage() ? 'At Cottage' : isAtShop() ? 'At Shop' : 'Away';
  $('zoom-btn').textContent = state.zoom20x20 ? '🔍 Zoom: 20x20' : '🔍 Zoom: Auto';
  $('sfx-mode').textContent = state.sfxEnabled ? 'On' : 'Off';
  $('sfx-btn').textContent = state.sfxEnabled ? '🔊 SFX: On' : '🔇 SFX: Off';
  $('status').textContent = state.gameOver ? 'Game Over' : state.restAction?.active ? 'Resting' : 'Active';
  $('rest-btn').disabled = state.gameOver || state.restAction?.active || !isAtCottage() || state.stamina >= state.maxStamina || !!state.digAction?.active;
  renderShop();
}

function canDig(material, direction) {
  if ([MATERIALS.EMPTY, MATERIALS.SAND, MATERIALS.TREASURE, MATERIALS.GRASS, MATERIALS.RELIC, MATERIALS.CRYSTAL].includes(material)) return true;
  if (material === MATERIALS.ROCK && direction === 'side' && state.canDigPillars) return true;
  if (material === MATERIALS.ROCK) return state.canDigRock;
  return false;
}

function settleColumn(x) {
  const wx = wrapX(x);
  for (let y = WORLD_HEIGHT - 2; y >= 0; y -= 1) {
    const curr = getCell(wx, y);
    if (curr === MATERIALS.EMPTY) continue;
    if (getCell(wx, y + 1) === MATERIALS.EMPTY) {
      setCell(wx, y + 1, curr);
      setCell(wx, y, MATERIALS.EMPTY);
    }
  }
}

function collectTreasure(siteDef, x, y) {
  const payout = Math.floor((45 + Math.random() * 50) * (state.lootMultiplier || 1));
  state.money += payout;
  gainXp(26 * siteDef.xpBonus);
  spawnParticles(x, y, '#ffdf55', 14, 1.2);
  playSfx('treasure');
  setMessage(`Treasure found! +$${payout}`);
}

/** Additional collectible node: relic cache with larger money and XP burst. */
function collectRelic(siteDef, x, y) {
  const payout = Math.floor((85 + Math.random() * 65) * (state.lootMultiplier || 1));
  state.money += payout;
  gainXp(34 * siteDef.xpBonus);
  spawnParticles(x, y, '#d39b69', 16, 1.3);
  playSfx('treasure');
  setMessage(`Ancient relic sold! +$${payout}`);
}

/** Additional collectible node: crystal seam that can also grant a bonus bomb. */
function collectCrystal(siteDef, x, y) {
  const payout = Math.floor((62 + Math.random() * 42) * (state.lootMultiplier || 1));
  state.money += payout;
  gainXp(30 * siteDef.xpBonus);
  const bonusBomb = Math.random() < 0.25;
  if (bonusBomb) state.bombs += 1;
  spawnParticles(x, y, '#7be8ff', 14, 1.1);
  playSfx('treasure');
  setMessage(`Crystal cache recovered! +$${payout}${bonusBomb ? ' +1 bonus bomb!' : ''}`);
}

function digCell(x, y, direction, siteDef) {
  if (!inBounds(x, y)) return false;
  const material = getCell(x, y);

  if (!canDig(material, direction)) {
    if (material === MATERIALS.ROCK) setMessage('Rock Drill upgrade required for this block.', 'danger');
    if (material === MATERIALS.METAL || material === MATERIALS.GRANITE) setMessage('Too hard to dig. Use a bomb!', 'danger');
    playSfx('blocked');
    return false;
  }

  if (material === MATERIALS.TREASURE) collectTreasure(siteDef, x, y);
  if (material === MATERIALS.RELIC) collectRelic(siteDef, x, y);
  if (material === MATERIALS.CRYSTAL) collectCrystal(siteDef, x, y);
  if (material !== MATERIALS.EMPTY) {
    setCell(x, y, MATERIALS.EMPTY);
    if (material === MATERIALS.GRASS) scheduleGrassRegrowth(x, y);
    // Reverse origin spray so chunks kick back opposite the current dig direction.
    spawnParticles(x, y, getMaterialColor(material), 8, 1.05, state.player.x, state.player.y, true);
    playSfx('dig');
    gainXp(7 * siteDef.xpBonus);
    spendStamina(1);
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

  const durationMs = 3000;
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
  state.playerAnim.bobPhase += 0.85;
  state.playerAnim.facing = nx < state.player.x ? -1 : nx > state.player.x ? 1 : state.playerAnim.facing;
  state.player.x = nx;
  state.player.y = ny;
  state.maxDepth = Math.max(state.maxDepth, ny);
  markVisibleArea(state.player.x, state.player.y);

  if (dy === 0 && state.digRadius > 1) {
    digCell(nx, Math.min(WORLD_HEIGHT - 1, ny + 1), 'down', siteDef);
  }

  settleColumn(nx);
  settleColumn(state.player.x);
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
    return canDig(material, dir.name) || material === MATERIALS.EMPTY || material === MATERIALS.TREASURE;
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
  if (state.gameOver || state.digAction?.active) return;
  if (state.restAction?.active) {
    setMessage('You are resting. Wait for stamina to refill.', 'danger');
    return;
  }
  const now = performance.now();
  if (now - state.lastMoveAt < state.cooldownMs) return;

  const nx = wrapX(state.player.x + dx);
  const ny = state.player.y + dy;
  if (!inBounds(0, ny)) return;

  const siteDef = SITE_DEFS.find((site) => site.id === state.selectedSiteId);
  const direction = dy > 0 ? 'down' : dy < 0 ? 'up' : 'side';
  const targetMaterial = getCell(nx, ny);

  // Pure movement into empty space stays instant (no 3-second dig action).
  if (targetMaterial === MATERIALS.EMPTY) {
    state.lastMoveAt = now;
    completeMove(nx, ny, dy, siteDef);
    return;
  }

  if (targetMaterial !== MATERIALS.EMPTY && !canSpendStamina()) {
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

function useBomb() {
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
      setCell(x, y, MATERIALS.EMPTY);
      spawnParticles(x, y, '#ff9466', 8, 1.6);
      settleColumn(x);
    }
  }

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

  upgrades.forEach((upgrade) => {
    const cost = Math.floor(upgrade.baseCost * (1 + ((state.level - 1) * 0.1)));
    const levelLocked = state.level < upgrade.requiredLevel;

    const box = document.createElement('div');
    box.className = 'shop-item';

    const name = document.createElement('strong');
    name.textContent = `${upgrade.name} — $${cost} (Lvl ${upgrade.requiredLevel}+)`;

    const desc = document.createElement('p');
    desc.textContent = upgrade.desc;

    const btn = document.createElement('button');
    btn.className = 'btn';
    const atShop = isAtShop();
    btn.title = levelLocked
      ? `Reach level ${upgrade.requiredLevel} to unlock ${upgrade.name}`
      : !atShop
        ? 'Stand on the surface shop tile (🛒) to buy upgrades'
        : `Buy ${upgrade.name}`;
    btn.textContent = 'Buy Upgrade';
    btn.disabled = state.money < cost || levelLocked || state.gameOver || !atShop;
    btn.addEventListener('click', () => {
      if (state.money < cost || levelLocked || state.gameOver) return;
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

    box.append(name, desc, btn);
    container.appendChild(box);
  });
}

function startSelectedSite() {
  const siteDef = SITE_DEFS.find((site) => site.id === state.selectedSiteId);
  setMessage('Generating 200x1000 looping world...');

  setTimeout(() => {
    // Reset pending grass regrowth when starting/restarting an expedition.
    for (const timer of state.grassRegrowTimers.values()) clearTimeout(timer);
    state.grassRegrowTimers.clear();

    state.world = buildWorld(siteDef);
    state.explored = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);
    state.player = { x: Math.floor(WORLD_WIDTH / 2), y: 0 };
    state.camera = { x: 0, y: 0 };
    state.maxDepth = 0;
    state.gameOver = false;
    state.bombPackBonus = 0;
    state.lootMultiplier = 1;
    if (state.digAction?.sfxTimer) clearInterval(state.digAction.sfxTimer);
    if (state.digAction?.dustTimer) clearInterval(state.digAction.dustTimer);
    if (state.digAction?.doneTimer) clearTimeout(state.digAction.doneTimer);
    state.digAction = null;
    state.particles = [];
    state.stamina = state.maxStamina;
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
    startSelectedSite();
  });

  $('start-btn').addEventListener('click', startSelectedSite);
  $('bomb-btn').addEventListener('click', useBomb);
  $('zoom-btn').addEventListener('click', () => {
    state.zoom20x20 = !state.zoom20x20;
    updateHud();
    draw();
  });
  $('rest-btn').addEventListener('click', startRest);
  $('sfx-btn').addEventListener('click', () => {
    state.sfxEnabled = !state.sfxEnabled;
    updateHud();
  });

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
    if (key === 'r') startRest();
    if (key === 'm') {
      state.sfxEnabled = !state.sfxEnabled;
      updateHud();
    }
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
startSelectedSite();
