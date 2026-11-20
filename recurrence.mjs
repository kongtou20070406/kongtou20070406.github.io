// Figure 1: a scalar synchronous neighborhood recurrence on a grid.
//
//   x_{t+1} = λ · Ā x_t + b,   x_0 = b
//
// Ā averages each cell with its four neighbours (cells outside the grid count
// as zero), b is 1 at the sources. Ā is nonnegative with row sums ≤ 1, so
// ‖x_{t+1} − x_t‖∞ ≤ λ ‖x_t − x_{t−1}‖∞: the map is a contraction and the
// iteration settles at the unique fixed point (I − λĀ)⁻¹ b. Information moves
// one cell per round, so after T rounds a cell is nonzero exactly when it lies
// within Manhattan distance T of a source.

const LAMBDA = 0.95;
const DECADES = 6;          // dot size covers six orders of magnitude
const MAX_SOURCES = 6;
const STEP_MS = 115;        // about nine rounds per second
const AUTO_STOP = 64;
const MAX_ROUNDS = 999;
const RAIL_TOP = 64;

const LAYOUTS = {
  wide: { cols: 41, rows: 25, sources: [[9, 8], [30, 17], [34, 5]] },
  narrow: { cols: 27, rows: 19, sources: [[6, 5], [19, 13]] },
};

const canvas = document.querySelector("#demo-canvas");
const context = canvas?.getContext("2d");
const buttons = document.querySelector("#demo-buttons");
const playButton = document.querySelector("#demo-play");
const shuffleButton = document.querySelector("#demo-shuffle");
const readoutT = document.querySelector("#readout-t");
const readoutNew = document.querySelector("#readout-new");
const readoutRes = document.querySelector("#readout-res");
const railFill = document.querySelector("#rail-fill");
const railTicks = [...document.querySelectorAll(".rail-ticks li")];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

let layoutName = "";
let cols = 0;
let rows = 0;
let state = new Float64Array(0);
let scratch = new Float64Array(0);
let source = new Uint8Array(0);
let reachedAt = new Int16Array(0);
let sourceOrder = [];
let round = 0;
let freshCount = 0;
let residual = NaN;
let playing = false;
let visible = true;
let frame = 0;
let lastTick = 0;
let colors = {};

function readColors() {
  const style = getComputedStyle(document.documentElement);
  colors = {
    ink: style.getPropertyValue("--ink").trim(),
    accent: style.getPropertyValue("--accent").trim(),
    faint: style.getPropertyValue("--rule-strong").trim(),
  };
}

function setLayout(name) {
  const layout = LAYOUTS[name];
  layoutName = name;
  cols = layout.cols;
  rows = layout.rows;
  const size = cols * rows;
  state = new Float64Array(size);
  scratch = new Float64Array(size);
  source = new Uint8Array(size);
  reachedAt = new Int16Array(size);
  sourceOrder = layout.sources.map(([c, r]) => r * cols + c);
  canvas.style.aspectRatio = `${cols} / ${rows}`;
}

function restart() {
  source.fill(0);
  state.fill(0);
  reachedAt.fill(-1);
  for (const index of sourceOrder) {
    source[index] = 1;
    state[index] = 1;
    reachedAt[index] = 0;
  }
  round = 0;
  freshCount = sourceOrder.length;
  residual = NaN;
}

function step() {
  let largestChange = 0;
  let fresh = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let sum = state[i];
      if (c > 0) sum += state[i - 1];
      if (c < cols - 1) sum += state[i + 1];
      if (r > 0) sum += state[i - cols];
      if (r < rows - 1) sum += state[i + cols];
      const value = LAMBDA * sum / 5 + source[i];
      scratch[i] = value;
      largestChange = Math.max(largestChange, Math.abs(value - state[i]));
      if (value > 0 && reachedAt[i] < 0) {
        reachedAt[i] = round + 1;
        fresh++;
      }
    }
  }
  [state, scratch] = [scratch, state];
  round++;
  freshCount = fresh;
  residual = largestChange;
}

const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

function formatResidual(value) {
  if (Number.isNaN(value)) return "—";
  if (value === 0) return "0";
  if (value >= 0.01) return value.toFixed(3);
  const exponent = Math.floor(Math.log10(value));
  const mantissa = value / 10 ** exponent;
  const power = String(exponent).replace(/[-\d]/g, (ch) => SUPERSCRIPT[ch]);
  return `${mantissa.toFixed(1)}×10${power}`;
}

function updateReadout() {
  readoutT.textContent = String(round);
  readoutNew.textContent = String(freshCount);
  readoutRes.textContent = formatResidual(residual);
  const progress = round < 1 ? 0 : Math.min(1, Math.log2(round) / Math.log2(RAIL_TOP));
  railFill.style.width = `${(progress * 100).toFixed(2)}%`;
  for (const tick of railTicks) {
    tick.classList.toggle("is-passed", round >= Number(tick.dataset.t));
  }
}

function draw() {
  const width = canvas.clientWidth;
  if (width === 0) return;
  const cell = width / cols;
  const height = cell * rows;
  const density = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * density);
  const pixelHeight = Math.round(height * density);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(density, 0, 0, density, 0, 0);
  context.clearRect(0, 0, width, height);

  let largest = 0;
  for (let i = 0; i < state.length; i++) largest = Math.max(largest, state[i]);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = (c + 0.5) * cell;
      const y = (r + 0.5) * cell;

      if (source[i]) {
        const side = cell * 0.6;
        context.globalAlpha = 1;
        context.fillStyle = colors.accent;
        context.fillRect(x - side / 2, y - side / 2, side, side);
        continue;
      }

      let radius;
      if (reachedAt[i] < 0) {
        context.globalAlpha = 0.75;
        context.fillStyle = colors.faint;
        radius = cell * 0.055;
      } else if (reachedAt[i] === round && round > 0) {
        context.globalAlpha = 1;
        context.fillStyle = colors.accent;
        radius = cell * 0.16;
      } else {
        const level = largest > 0 ? 1 + Math.log10(state[i] / largest) / DECADES : 0;
        const strength = Math.min(1, Math.max(0, level));
        context.globalAlpha = 0.42 + 0.58 * strength;
        context.fillStyle = colors.ink;
        radius = cell * (0.1 + 0.32 * strength);
      }
      context.beginPath();
      context.arc(x, y, radius, 0, 2 * Math.PI);
      context.fill();
    }
  }
  context.globalAlpha = 1;
}

function render() {
  draw();
  updateReadout();
}

function setPlaying(next) {
  playing = next;
  playButton.textContent = playing ? "暂停" : round >= AUTO_STOP ? "继续跑" : "播放";
  cancelAnimationFrame(frame);
  if (playing && visible) {
    lastTick = performance.now();
    frame = requestAnimationFrame(tick);
  }
}

function tick(now) {
  if (now - lastTick >= STEP_MS) {
    lastTick = now;
    step();
    render();
    const autoStop = round === AUTO_STOP || round >= MAX_ROUNDS;
    if (autoStop) {
      setPlaying(false);
      return;
    }
  }
  frame = requestAnimationFrame(tick);
}

function runFromStart() {
  restart();
  if (reducedMotion.matches) {
    while (round < AUTO_STOP) step();
    render();
    setPlaying(false);
  } else {
    render();
    setPlaying(true);
  }
}

function toggleSource(index) {
  const position = sourceOrder.indexOf(index);
  if (position >= 0) {
    sourceOrder.splice(position, 1);
  } else {
    sourceOrder.push(index);
    if (sourceOrder.length > MAX_SOURCES) sourceOrder.shift();
  }
  runFromStart();
}

function shuffleSources() {
  const count = 2 + Math.floor(Math.random() * 3);
  const margin = 2;
  sourceOrder = [];
  while (sourceOrder.length < count) {
    const c = margin + Math.floor(Math.random() * (cols - 2 * margin));
    const r = margin + Math.floor(Math.random() * (rows - 2 * margin));
    const index = r * cols + c;
    if (!sourceOrder.includes(index)) sourceOrder.push(index);
  }
  runFromStart();
}

function chooseLayout() {
  const name = canvas.clientWidth < 520 ? "narrow" : "wide";
  if (name !== layoutName) {
    setLayout(name);
    runFromStart();
  } else {
    draw();
  }
}

if (context) {
  readColors();
  buttons.hidden = false;
  setLayout(canvas.clientWidth < 520 ? "narrow" : "wide");

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor((event.clientX - rect.left) / (rect.width / cols));
    const r = Math.floor((event.clientY - rect.top) / (rect.height / rows));
    if (c >= 0 && c < cols && r >= 0 && r < rows) toggleSource(r * cols + c);
  });

  playButton.addEventListener("click", () => setPlaying(!playing));
  shuffleButton.addEventListener("click", shuffleSources);

  darkScheme.addEventListener("change", () => {
    readColors();
    draw();
  });

  new ResizeObserver(chooseLayout).observe(canvas);

  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (playing) setPlaying(true);
  }).observe(canvas);

  runFromStart();
}
