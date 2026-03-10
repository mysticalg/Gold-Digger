/**
 * Gold Digger retro arcade game.
 * Core systems:
 * - 10x10 tile map with gravity for loose materials
 * - Digging rules + upgrades + bombs
 * - Treasure economy, XP/levels, and site progression
 */
const GRID_SIZE = 10;
const TILE_SIZE = 25;
const BOARD_OFFSET_X = 135;
const BOARD_OFFSET_Y = 295;
const BOARD_WIDTH = GRID_SIZE * TILE_SIZE;
const BOARD_HEIGHT = GRID_SIZE * TILE_SIZE;

const MATERIALS = {
  EMPTY: 'empty',
  SAND: 'sand',
  ROCK: 'rock',
  METAL: 'metal',
  GRANITE: 'granite',
  TREASURE: 'treasure',
};

const SITE_DEFS = [
  { id: 'egypt', name: 'Giza Sands (Easy)', rock: 8, metal: 0, granite: 0, treasure: 7, xpBonus: 1.0 },
  { id: 'andes', name: 'Andes Ruins (Medium)', rock: 16, metal: 4, granite: 2, treasure: 8, xpBonus: 1.25 },
  { id: 'atlantis', name: 'Sunken Atlantis (Hard)', rock: 20, metal: 8, granite: 6, treasure: 9, xpBonus: 1.55 },
  { id: 'himalaya', name: 'Himalayan Vault (Expert)', rock: 24, metal: 10, granite: 9, treasure: 10, xpBonus: 1.8 },
];

const state = {
  board: [],
  player: { x: Math.floor(GRID_SIZE / 2), y: 0 },
  money: 0,
  xp: 0,
  level: 1,
  digSpeed: 1,
  digRadius: 1,
  bombs: 0,
  canDigRock: false,
  canDigPillars: false,
  cooldownMs: 220,
  lastMoveAt: 0,
  selectedSiteId: SITE_DEFS[0].id,
  siteTreasureLeft: 0,
};

const upgrades = [
  { id: 'speed', name: 'Turbo Spade', baseCost: 80, desc: 'Dig faster by reducing move cooldown.', apply: () => {
    state.digSpeed += 0.25;
    state.cooldownMs = Math.max(85, Math.round(220 / state.digSpeed));
  }},
  { id: 'radius', name: 'Wide Scoop', baseCost: 120, desc: 'Dig a slightly larger tunnel (2-wide sideways).', apply: () => {
    state.digRadius = Math.min(2, state.digRadius + 1);
  }},
  { id: 'rock', name: 'Rock Drill', baseCost: 160, desc: 'Allows mining through regular rock blocks.', apply: () => {
    state.canDigRock = true;
  }},
  { id: 'pillars', name: 'Support Cutter', baseCost: 190, desc: 'Can remove support pillars and side packed sand.', apply: () => {
    state.canDigPillars = true;
  }},
  { id: 'bomb-pack', name: 'Bomb Pack', baseCost: 140, desc: 'Adds 3 bombs for metal and granite demolition.', apply: () => {
    state.bombs += 3;
  }},
];

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
const siteSelect = $('site-select');
const messageBox = $('message');

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

/** Build a board using site composition percentages. */
function buildBoard(siteDef) {
  const board = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => MATERIALS.SAND),
  );

  // Keep top row as empty to simulate surface entry and spawn lane.
  for (let x = 0; x < GRID_SIZE; x += 1) board[0][x] = MATERIALS.EMPTY;

  const placementPool = [];
  for (let y = 1; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) placementPool.push([x, y]);
  }

  function place(type, count) {
    for (let i = 0; i < count && placementPool.length; i += 1) {
      const idx = randomInt(placementPool.length);
      const [x, y] = placementPool.splice(idx, 1)[0];
      board[y][x] = type;
    }
  }

  place(MATERIALS.ROCK, siteDef.rock);
  place(MATERIALS.METAL, siteDef.metal);
  place(MATERIALS.GRANITE, siteDef.granite);
  place(MATERIALS.TREASURE, siteDef.treasure);
  return board;
}

function getMaterialColor(type) {
  switch (type) {
    case MATERIALS.SAND: return '#e8d091';
    case MATERIALS.ROCK: return '#7f879f';
    case MATERIALS.METAL: return '#adb7cc';
    case MATERIALS.GRANITE: return '#4c4f5c';
    case MATERIALS.TREASURE: return '#f3c741';
    default: return '#141726';
  }
}

/**
 * Draw bright above-ground scenery so the start point feels like a real dig site.
 * Includes sky, sun, grass strip, and simple pixel trees.
 */
function drawSurfaceScene() {
  const skyGradient = ctx.createLinearGradient(0, 0, 0, BOARD_OFFSET_Y - 20);
  skyGradient.addColorStop(0, '#8bd2ff');
  skyGradient.addColorStop(1, '#bdeaff');
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, canvas.width, BOARD_OFFSET_Y - 20);

  // Sun with a subtle glow.
  ctx.fillStyle = 'rgba(255, 222, 89, 0.35)';
  ctx.beginPath();
  ctx.arc(430, 72, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffdf4f';
  ctx.beginPath();
  ctx.arc(430, 72, 26, 0, Math.PI * 2);
  ctx.fill();

  // Distant hill line.
  ctx.fillStyle = '#79bb69';
  ctx.beginPath();
  ctx.moveTo(0, 240);
  ctx.quadraticCurveTo(130, 200, 260, 235);
  ctx.quadraticCurveTo(390, 270, 520, 220);
  ctx.lineTo(520, BOARD_OFFSET_Y - 20);
  ctx.lineTo(0, BOARD_OFFSET_Y - 20);
  ctx.closePath();
  ctx.fill();

  // Grass strip where the miner stands before digging down.
  ctx.fillStyle = '#2e8e3f';
  ctx.fillRect(0, BOARD_OFFSET_Y - 28, canvas.width, 28);

  // Pixel trees for environmental flavor.
  const trees = [
    { x: 48, y: 184, scale: 1 },
    { x: 88, y: 174, scale: 0.8 },
    { x: 478, y: 188, scale: 1.05 },
  ];
  for (const tree of trees) {
    const trunkW = 10 * tree.scale;
    const trunkH = 34 * tree.scale;
    ctx.fillStyle = '#6a4325';
    ctx.fillRect(tree.x - trunkW / 2, tree.y, trunkW, trunkH);
    ctx.fillStyle = '#2fb25f';
    ctx.fillRect(tree.x - 19 * tree.scale, tree.y - 20 * tree.scale, 38 * tree.scale, 18 * tree.scale);
    ctx.fillRect(tree.x - 14 * tree.scale, tree.y - 36 * tree.scale, 28 * tree.scale, 18 * tree.scale);
  }
}

/** Render pixel-style board and player sprite. */
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawSurfaceScene();

  // Draw bordered underground playfield.
  ctx.fillStyle = '#251c10';
  ctx.fillRect(BOARD_OFFSET_X - 4, BOARD_OFFSET_Y - 4, BOARD_WIDTH + 8, BOARD_HEIGHT + 8);

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const type = state.board[y][x];
      const px = BOARD_OFFSET_X + (x * TILE_SIZE);
      const py = BOARD_OFFSET_Y + (y * TILE_SIZE);

      ctx.fillStyle = getMaterialColor(type);
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      if (type !== MATERIALS.EMPTY) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, 4);
      }

      if (type === MATERIALS.TREASURE) {
        ctx.fillStyle = '#5d4300';
        ctx.fillRect(px + 7, py + 7, 11, 11);
      }

      ctx.strokeStyle = '#0d1020';
      ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  const { x, y } = state.player;
  const px = BOARD_OFFSET_X + (x * TILE_SIZE);
  const py = BOARD_OFFSET_Y + (y * TILE_SIZE);

  // Improved retro miner sprite with helmet, face, torso and spade.
  ctx.fillStyle = '#ffca3a';
  ctx.fillRect(px + 5, py + 1, 15, 5);
  ctx.fillStyle = '#ffd8a8';
  ctx.fillRect(px + 7, py + 6, 10, 6);
  ctx.fillStyle = '#2a5daa';
  ctx.fillRect(px + 6, py + 12, 12, 9);
  ctx.fillStyle = '#3b2a1b';
  ctx.fillRect(px + 8, py + 21, 3, 4);
  ctx.fillRect(px + 13, py + 21, 3, 4);
  ctx.fillStyle = '#9aa7bf';
  ctx.fillRect(px + 18, py + 13, 6, 2);
  ctx.fillRect(px + 23, py + 11, 2, 7);
}

function setMessage(msg) {
  messageBox.textContent = msg;
}

function xpToNextLevel() {
  return 100 + (state.level - 1) * 65;
}

function gainXp(amount) {
  state.xp += amount;
  while (state.xp >= xpToNextLevel()) {
    state.xp -= xpToNextLevel();
    state.level += 1;
    state.money += 40;
    setMessage(`Level up! You reached level ${state.level} and found $40 bonus funding!`);
  }
}

function updateHud() {
  $('money').textContent = state.money;
  $('level').textContent = state.level;
  $('xp').textContent = Math.floor(state.xp);
  $('xp-next').textContent = xpToNextLevel();
  $('treasure-left').textContent = state.siteTreasureLeft;
  $('speed').textContent = state.digSpeed.toFixed(2);
  $('bomb-count').textContent = state.bombs;
}

/** Apply gravity so loose blocks fall through empty spaces. */
function applyGravity() {
  let moved = false;
  for (let y = GRID_SIZE - 2; y >= 0; y -= 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const curr = state.board[y][x];
      if (curr === MATERIALS.EMPTY) continue;
      if (state.board[y + 1][x] === MATERIALS.EMPTY) {
        state.board[y + 1][x] = curr;
        state.board[y][x] = MATERIALS.EMPTY;
        moved = true;
      }
    }
  }
  return moved;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE;
}

function canDig(type, direction) {
  if (type === MATERIALS.EMPTY || type === MATERIALS.SAND || type === MATERIALS.TREASURE) return true;
  // Support Cutter allows carving sideways through supportive rock pillars.
  if (type === MATERIALS.ROCK && direction === 'side' && state.canDigPillars) return true;
  if (type === MATERIALS.ROCK) return state.canDigRock;
  return false;
}

function collectTreasure(siteDef) {
  const payout = 45 + randomInt(35);
  state.money += payout;
  state.siteTreasureLeft = Math.max(0, state.siteTreasureLeft - 1);
  gainXp(28 * siteDef.xpBonus);
  setMessage(`Treasure found! +$${payout}`);
}

function digCell(x, y, direction, siteDef) {
  if (!inBounds(x, y)) return false;
  const type = state.board[y][x];
  if (!canDig(type, direction)) {
    if (type === MATERIALS.METAL || type === MATERIALS.GRANITE) {
      setMessage('Hard material detected. Use bombs!');
    } else if (type === MATERIALS.ROCK) {
      setMessage('Rock blocks require Rock Drill upgrade.');
    }
    return false;
  }

  if (type === MATERIALS.TREASURE) collectTreasure(siteDef);
  if (type !== MATERIALS.EMPTY) {
    gainXp(8 * siteDef.xpBonus);
    state.board[y][x] = MATERIALS.EMPTY;
  }
  return true;
}

function movePlayer(dx, dy) {
  const now = performance.now();
  if (now - state.lastMoveAt < state.cooldownMs) return;
  state.lastMoveAt = now;

  const siteDef = SITE_DEFS.find((s) => s.id === state.selectedSiteId);
  const nx = state.player.x + dx;
  const ny = state.player.y + dy;
  if (!inBounds(nx, ny)) return;

  const direction = dy > 0 ? 'down' : dy < 0 ? 'up' : 'side';
  if (!digCell(nx, ny, direction, siteDef)) return;

  state.player.x = nx;
  state.player.y = ny;

  // Wide scoop upgrade digs adjacent side tile when moving sideways.
  if (dy === 0 && state.digRadius > 1) {
    const belowY = Math.min(GRID_SIZE - 1, ny + 1);
    digCell(nx, belowY, 'down', siteDef);
  }

  // Apply gravity repeatedly for smooth cascades.
  for (let i = 0; i < 8; i += 1) {
    if (!applyGravity()) break;
  }

  if (state.siteTreasureLeft === 0) {
    state.money += 90;
    gainXp(40 * siteDef.xpBonus);
    setMessage('Site cleared! +$90 expedition bonus. Select a new site for more treasure.');
  }

  updateHud();
  draw();
}

function useBomb() {
  if (state.bombs <= 0) {
    setMessage('Out of bombs. Buy Bomb Pack in the shop.');
    return;
  }

  const originX = state.player.x;
  const originY = Math.min(GRID_SIZE - 1, state.player.y + 1);
  let exploded = false;

  for (let y = originY - 1; y <= originY + 1; y += 1) {
    for (let x = originX - 1; x <= originX + 1; x += 1) {
      if (!inBounds(x, y)) continue;
      const block = state.board[y][x];
      if (block !== MATERIALS.EMPTY) {
        if (block === MATERIALS.TREASURE) state.siteTreasureLeft = Math.max(0, state.siteTreasureLeft - 1);
        state.board[y][x] = MATERIALS.EMPTY;
        exploded = true;
      }
    }
  }

  state.bombs -= 1;
  if (exploded) {
    gainXp(16);
    setMessage('Boom! You blasted through hard material.');
  }

  for (let i = 0; i < 8; i += 1) {
    if (!applyGravity()) break;
  }

  updateHud();
  draw();
}

function renderShop() {
  const container = $('shop-items');
  container.innerHTML = '';

  upgrades.forEach((upg) => {
    const levelFactor = 1 + (state.level - 1) * 0.12;
    const cost = Math.floor(upg.baseCost * levelFactor);

    const box = document.createElement('div');
    box.className = 'shop-item';

    const name = document.createElement('strong');
    name.textContent = `${upg.name} - $${cost}`;

    const desc = document.createElement('p');
    desc.textContent = upg.desc;

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.title = `Buy ${upg.name}`;
    btn.textContent = 'Buy Upgrade';
    btn.disabled = state.money < cost;
    btn.addEventListener('click', () => {
      if (state.money < cost) return;
      state.money -= cost;
      upg.apply();
      setMessage(`${upg.name} purchased.`);
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
  state.board = buildBoard(siteDef);
  state.player = { x: Math.floor(GRID_SIZE / 2), y: 0 };
  state.siteTreasureLeft = siteDef.treasure;
  setMessage(`Dig begun at ${siteDef.name}. Hunt all treasure!`);
  updateHud();
  renderShop();
  draw();
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
  });
}

bindUi();
startSelectedSite();
