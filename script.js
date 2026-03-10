/**
 * Gold Digger (large-world edition)
 * - 1000x1000 blocks
 * - Camera-follow rendering (only visible tiles are drawn for speed)
 * - Arcade digging, gravity, upgrades, bombs, and site difficulty
 */
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 1000;
const TILE_SIZE = 16;

const MATERIALS = {
  EMPTY: 0,
  SAND: 1,
  ROCK: 2,
  METAL: 3,
  GRANITE: 4,
  TREASURE: 5,
};

const SITE_DEFS = [
  { id: 'egypt', name: 'Giza Sands (Easy)', rockBias: 0.05, metalBias: 0.00, graniteBias: 0.00, treasureBias: 0.012, xpBonus: 1.0 },
  { id: 'andes', name: 'Andes Ruins (Medium)', rockBias: 0.08, metalBias: 0.02, graniteBias: 0.01, treasureBias: 0.014, xpBonus: 1.22 },
  { id: 'atlantis', name: 'Sunken Atlantis (Hard)', rockBias: 0.12, metalBias: 0.03, graniteBias: 0.018, treasureBias: 0.016, xpBonus: 1.5 },
  { id: 'himalaya', name: 'Himalayan Vault (Expert)', rockBias: 0.15, metalBias: 0.04, graniteBias: 0.024, treasureBias: 0.018, xpBonus: 1.8 },
];

const state = {
  world: new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT),
  player: { x: Math.floor(WORLD_WIDTH / 2), y: 0 },
  camera: { x: 0, y: 0 },
  money: 0,
  xp: 0,
  level: 1,
  digSpeed: 1,
  digRadius: 1,
  bombs: 0,
  canDigRock: false,
  canDigPillars: false,
  cooldownMs: 160,
  lastMoveAt: 0,
  selectedSiteId: SITE_DEFS[0].id,
  maxDepth: 0,
  zoom20x20: false,
};

const upgrades = [
  {
    id: 'speed',
    name: 'Turbo Spade',
    baseCost: 120,
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
    desc: 'Side digs also clear one tile below for larger tunnels.',
    apply: () => { state.digRadius = Math.min(2, state.digRadius + 1); },
  },
  {
    id: 'rock',
    name: 'Rock Drill',
    baseCost: 220,
    desc: 'Allows mining standard rock.',
    apply: () => { state.canDigRock = true; },
  },
  {
    id: 'pillars',
    name: 'Support Cutter',
    baseCost: 260,
    desc: 'Allows side-cutting through packed rocky supports.',
    apply: () => { state.canDigPillars = true; },
  },
  {
    id: 'bomb-pack',
    name: 'Bomb Pack',
    baseCost: 190,
    desc: 'Adds 4 bombs for metal/granite demolition.',
    apply: () => { state.bombs += 4; },
  },
];

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
const siteSelect = $('site-select');
const messageBox = $('message');

function indexOf(x, y) {
  return (y * WORLD_WIDTH) + x;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < WORLD_WIDTH && y < WORLD_HEIGHT;
}

function getCell(x, y) {
  if (!inBounds(x, y)) return MATERIALS.GRANITE;
  return state.world[indexOf(x, y)];
}

function setCell(x, y, value) {
  if (inBounds(x, y)) state.world[indexOf(x, y)] = value;
}

/**
 * Fast deterministic noise for map generation.
 * Keeps generation reproducible per-site without expensive random state churn.
 */
function coordNoise(x, y, seed) {
  let h = (x * 374761393) ^ (y * 668265263) ^ (seed * 2147483647);
  h = (h ^ (h >> 13)) * 1274126177;
  h ^= h >> 16;
  return (h >>> 0) / 4294967295;
}

/**
 * Build a 1000x1000 world.
 * Material profile by depth:
 * - upper crust: mostly sand with rising rock
 * - mid crust: transitions to almost all rock
 * - deep crust: all rock baseline
 * - deep core: introduces metal then granite pockets
 */
function buildWorld(siteDef) {
  const seed = SITE_DEFS.findIndex((s) => s.id === siteDef.id) + 1;
  const world = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);

  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    const depth = y / WORLD_HEIGHT;
    for (let x = 0; x < WORLD_WIDTH; x += 1) {
      const idx = indexOf(x, y);

      if (y === 0) {
        world[idx] = MATERIALS.EMPTY;
        continue;
      }

      const n = coordNoise(x, y, seed);
      const deepNoise = coordNoise(x + 99991, y + 31337, seed + 17);

      // Treasure becomes slightly rarer at extreme depth where hard materials dominate.
      const treasureChance = Math.max(0.004, siteDef.treasureBias - (depth * 0.006));
      if (n < treasureChance) {
        world[idx] = MATERIALS.TREASURE;
        continue;
      }

      // 0.00 -> 0.35: sand to rock ramp.
      if (depth < 0.35) {
        const rockRatio = Math.min(1, siteDef.rockBias + (depth / 0.35) * 0.9);
        world[idx] = deepNoise < rockRatio ? MATERIALS.ROCK : MATERIALS.SAND;
        continue;
      }

      // 0.35 -> 0.65: all rock band.
      if (depth < 0.65) {
        world[idx] = MATERIALS.ROCK;
        continue;
      }

      // 0.65 -> 0.85: rock + metal pockets.
      if (depth < 0.85) {
        const metalChance = siteDef.metalBias + ((depth - 0.65) / 0.2) * 0.24;
        world[idx] = deepNoise < metalChance ? MATERIALS.METAL : MATERIALS.ROCK;
        continue;
      }

      // 0.85 -> 1.00: core with granite and heavy metal mixed into rock.
      const graniteChance = siteDef.graniteBias + ((depth - 0.85) / 0.15) * 0.35;
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
    default: return '#0f1320';
  }
}

/** Keep internal canvas pixels synced to displayed size. */
function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(600, Math.floor(rect.width * dpr));
  const height = Math.max(420, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawSurface() {
  const horizon = Math.max(60, Math.floor(canvas.height * 0.16));
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#78c8ff');
  sky.addColorStop(1, '#bce9ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, horizon);

  ctx.fillStyle = 'rgba(255, 225, 91, 0.4)';
  ctx.beginPath();
  ctx.arc(canvas.width - 95, 70, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffdf55';
  ctx.beginPath();
  ctx.arc(canvas.width - 95, 70, 28, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2f8d40';
  ctx.fillRect(0, horizon - 10, canvas.width, 10);
}

/**
 * Camera follows player downward through the giant world.
 * Rendering draws only visible tiles so 1,000,000 blocks stay performant.
 */
function draw() {
  resizeCanvasToDisplaySize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Zoom mode can lock the camera to a tactical 20x20 tile view.
  const fixedTiles = state.zoom20x20 ? 20 : null;
  const viewportCols = fixedTiles ?? (Math.ceil(canvas.width / TILE_SIZE) + 2);
  const viewportRows = fixedTiles ?? (Math.ceil(canvas.height / TILE_SIZE) + 2);
  const tileSize = fixedTiles ? Math.floor(Math.min(canvas.width, canvas.height) / fixedTiles) : TILE_SIZE;
  const boardWidthPx = viewportCols * tileSize;
  const boardHeightPx = viewportRows * tileSize;
  const offsetX = Math.floor((canvas.width - boardWidthPx) / 2);
  const offsetY = Math.floor((canvas.height - boardHeightPx) / 2);

  state.camera.x = Math.max(0, Math.min(WORLD_WIDTH - viewportCols, state.player.x - Math.floor(viewportCols / 2)));
  state.camera.y = Math.max(0, Math.min(WORLD_HEIGHT - viewportRows, state.player.y - Math.floor(viewportRows / 2)));

  drawSurface();

  // Backplate helps visualize the exact zoomed 20x20 region.
  ctx.fillStyle = '#19111a';
  ctx.fillRect(offsetX - 2, offsetY - 2, boardWidthPx + 4, boardHeightPx + 4);

  for (let vy = 0; vy < viewportRows; vy += 1) {
    for (let vx = 0; vx < viewportCols; vx += 1) {
      const wx = state.camera.x + vx;
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

      if (material === MATERIALS.TREASURE) {
        const gemSize = Math.max(4, Math.floor(tileSize * 0.38));
        ctx.fillStyle = '#5d4300';
        ctx.fillRect(px + Math.floor((tileSize - gemSize) / 2), py + Math.floor((tileSize - gemSize) / 2), gemSize, gemSize);
      }

      ctx.strokeStyle = '#131723';
      ctx.strokeRect(px, py, tileSize, tileSize);
    }
  }

  // Player sprite in screen coordinates (scaled to current zoom tile size).
  const playerScreenX = offsetX + ((state.player.x - state.camera.x) * tileSize);
  const playerScreenY = offsetY + ((state.player.y - state.camera.y) * tileSize);
  ctx.fillStyle = '#f9c232';
  ctx.fillRect(playerScreenX + Math.floor(tileSize * 0.2), playerScreenY + 1, Math.max(6, Math.floor(tileSize * 0.62)), Math.max(3, Math.floor(tileSize * 0.25)));
  ctx.fillStyle = '#ffd8ab';
  ctx.fillRect(playerScreenX + Math.floor(tileSize * 0.3), playerScreenY + Math.floor(tileSize * 0.3), Math.max(4, Math.floor(tileSize * 0.38)), Math.max(3, Math.floor(tileSize * 0.22)));
  ctx.fillStyle = '#2a5daa';
  ctx.fillRect(playerScreenX + Math.floor(tileSize * 0.25), playerScreenY + Math.floor(tileSize * 0.54), Math.max(5, Math.floor(tileSize * 0.5)), Math.max(4, Math.floor(tileSize * 0.31)));
  ctx.fillStyle = '#9ea9c4';
  ctx.fillRect(playerScreenX + Math.floor(tileSize * 0.74), playerScreenY + Math.floor(tileSize * 0.54), Math.max(2, Math.floor(tileSize * 0.16)), Math.max(4, Math.floor(tileSize * 0.38)));
}

function setMessage(msg) {
  messageBox.textContent = msg;
}

function xpToNextLevel() {
  return 100 + ((state.level - 1) * 70);
}

function gainXp(amount) {
  state.xp += amount;
  while (state.xp >= xpToNextLevel()) {
    state.xp -= xpToNextLevel();
    state.level += 1;
    state.money += 45;
    setMessage(`Level up! You are now level ${state.level}. +$45 sponsor bonus.`);
  }
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
  $('zoom-btn').textContent = state.zoom20x20 ? '🔍 Zoom: 20x20' : '🔍 Zoom: Auto';
}

function canDig(material, direction) {
  if (material === MATERIALS.EMPTY || material === MATERIALS.SAND || material === MATERIALS.TREASURE) return true;
  if (material === MATERIALS.ROCK && direction === 'side' && state.canDigPillars) return true;
  if (material === MATERIALS.ROCK) return state.canDigRock;
  return false;
}

function settleColumn(x) {
  // Column-local gravity for performance: O(height) on one column per move.
  for (let y = WORLD_HEIGHT - 2; y >= 0; y -= 1) {
    const curr = getCell(x, y);
    if (curr === MATERIALS.EMPTY) continue;
    if (getCell(x, y + 1) === MATERIALS.EMPTY) {
      setCell(x, y + 1, curr);
      setCell(x, y, MATERIALS.EMPTY);
    }
  }
}

function collectTreasure(siteDef) {
  const payout = 45 + Math.floor(Math.random() * 50);
  state.money += payout;
  gainXp(26 * siteDef.xpBonus);
  setMessage(`Treasure found! +$${payout}`);
}

function digCell(x, y, direction, siteDef) {
  if (!inBounds(x, y)) return false;
  const material = getCell(x, y);

  if (!canDig(material, direction)) {
    if (material === MATERIALS.ROCK) setMessage('Rock Drill upgrade required for this block.');
    if (material === MATERIALS.METAL || material === MATERIALS.GRANITE) setMessage('Too hard to dig. Use a bomb!');
    return false;
  }

  if (material === MATERIALS.TREASURE) collectTreasure(siteDef);
  if (material !== MATERIALS.EMPTY) {
    setCell(x, y, MATERIALS.EMPTY);
    gainXp(7 * siteDef.xpBonus);
  }
  return true;
}

function movePlayer(dx, dy) {
  const now = performance.now();
  if (now - state.lastMoveAt < state.cooldownMs) return;
  state.lastMoveAt = now;

  const nx = state.player.x + dx;
  const ny = state.player.y + dy;
  if (!inBounds(nx, ny)) return;

  const siteDef = SITE_DEFS.find((s) => s.id === state.selectedSiteId);
  const direction = dy > 0 ? 'down' : dy < 0 ? 'up' : 'side';
  if (!digCell(nx, ny, direction, siteDef)) return;

  state.player.x = nx;
  state.player.y = ny;
  state.maxDepth = Math.max(state.maxDepth, ny);

  if (dy === 0 && state.digRadius > 1) {
    digCell(nx, Math.min(WORLD_HEIGHT - 1, ny + 1), 'down', siteDef);
  }

  settleColumn(nx);
  settleColumn(state.player.x);
  updateHud();
  draw();
}

function useBomb() {
  if (state.bombs <= 0) {
    setMessage('Out of bombs. Buy Bomb Pack in the shop.');
    return;
  }

  const originX = state.player.x;
  const originY = Math.min(WORLD_HEIGHT - 1, state.player.y + 1);

  for (let y = originY - 1; y <= originY + 1; y += 1) {
    for (let x = originX - 1; x <= originX + 1; x += 1) {
      if (!inBounds(x, y)) continue;
      setCell(x, y, MATERIALS.EMPTY);
      settleColumn(x);
    }
  }

  state.bombs -= 1;
  gainXp(20);
  setMessage('Boom! Area cleared.');
  updateHud();
  draw();
}

function renderShop() {
  const container = $('shop-items');
  container.innerHTML = '';

  upgrades.forEach((upgrade) => {
    const cost = Math.floor(upgrade.baseCost * (1 + ((state.level - 1) * 0.1)));

    const box = document.createElement('div');
    box.className = 'shop-item';

    const name = document.createElement('strong');
    name.textContent = `${upgrade.name} — $${cost}`;

    const desc = document.createElement('p');
    desc.textContent = upgrade.desc;

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.title = `Buy ${upgrade.name}`;
    btn.textContent = 'Buy Upgrade';
    btn.disabled = state.money < cost;
    btn.addEventListener('click', () => {
      if (state.money < cost) return;
      state.money -= cost;
      upgrade.apply();
      setMessage(`${upgrade.name} purchased.`);
      updateHud();
      renderShop();
      draw();
    });

    box.append(name, desc, btn);
    container.appendChild(box);
  });
}

function startSelectedSite() {
  const siteDef = SITE_DEFS.find((s) => s.id === state.selectedSiteId);
  setMessage('Generating 1000x1000 world...');

  // Small timeout gives browser a frame to paint message before generation loop starts.
  setTimeout(() => {
    state.world = buildWorld(siteDef);
    state.player = { x: Math.floor(WORLD_WIDTH / 2), y: 0 };
    state.camera = { x: 0, y: 0 };
    state.maxDepth = 0;
    setMessage(`Expedition active at ${siteDef.name}. Dig down and get rich!`);
    updateHud();
    renderShop();
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
  });

  window.addEventListener('resize', draw);
}

bindUi();
startSelectedSite();
