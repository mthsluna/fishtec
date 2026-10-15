const cv = document.getElementById("g");
const W = 480, H = 270;
let S = 2;                               // resolução interna (baixa sozinha se o jogo ficar pesado)
let ctx, layers = null;

// ---------- Estilo Obra Dinn colorido (dithering Bayer 8x8) ----------
const LEVELS = 4;                        // níveis por canal: 2 = bem radical (8 cores), 4 = equilibrado, 6 = mais suave
const STEP = 255 / (LEVELS - 1);
const BAYER = [0,32,8,40,2,34,10,42, 48,16,56,24,50,18,58,26, 12,44,4,36,14,46,6,38, 60,28,52,20,62,30,54,22,
               3,35,11,43,1,33,9,41, 51,19,59,27,49,17,57,25, 15,47,7,39,13,45,5,37, 63,31,55,23,61,29,53,21];

// O dithering roda na placa de vídeo (WebGL). Se não houver WebGL, cai para a CPU.
const gl = (() => {
  try {
    if (!document.createElement("canvas").getContext("webgl")) return null;
    return cv.getContext("webgl", { antialias: false, alpha: false });
  } catch (e) { return null; }
})();
const out = gl ? null : cv.getContext("2d");
const buf = document.createElement("canvas");
let glTex;
if (gl) {
  const VS = "attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}";
  const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D t;uniform float steps;varying vec2 uv;
float b2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
float b8(vec2 a){return (b2(a*.25)*.25+b2(a*.5))*.25+b2(a);}
void main(){
  vec3 c=texture2D(t,uv).rgb*255.;
  float st=255./(steps-1.);
  float th=(b8(mod(floor(gl_FragCoord.xy),8.))-.47)*st;
  c=clamp(floor((c+th)/st+.5)*st,0.,255.)/255.;
  gl_FragColor=vec4(c,1.);
}`;
  const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return o; };
  const pg = gl.createProgram();
  gl.attachShader(pg, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pg); gl.useProgram(pg);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pg, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  glTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, glTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1f(gl.getUniformLocation(pg, "steps"), LEVELS);
}

function setScale(s) {
  S = s; layers = null;
  cv.width = buf.width = W * S; cv.height = buf.height = H * S;
  ctx = buf.getContext("2d", gl ? {} : { willReadFrequently: true });
  ctx.scale(S, S);
}
setScale(2);

// Fallback (CPU): tabela pronta, sem contas por pixel
const LUT = new Uint8Array(64 * 256);
for (let t = 0; t < 64; t++) for (let v = 0; v < 256; v++)
  LUT[(t << 8) | v] = Math.max(0, Math.min(255, Math.round((v + (BAYER[t] / 64 - 0.47) * STEP) / STEP) * STEP));
function dither() {
  const w = cv.width, h = cv.height, im = ctx.getImageData(0, 0, w, h), d = im.data;
  for (let y = 0; y < h; y++) {
    const row = (y & 7) << 3;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const o = (row | (x & 7)) << 8;
      d[i] = LUT[o | d[i]]; d[i + 1] = LUT[o | d[i + 1]]; d[i + 2] = LUT[o | d[i + 2]];
    }
  }
  out.putImageData(im, 0, 0);
}
function present() {
  if (!gl) return dither();
  gl.viewport(0, 0, cv.width, cv.height);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
const API = window.API_URL;
const PIER_Y = 150, WATER_Y = 168;

// Peixes (se o servidor estiver fora, usa a lista local)
let fishList = [
  { id: "piranha-vermelha", name: "Piranha-vermelha", file: "piranha-vermelha.png", difficulty: 3, points: 40 },
  { id: "budiao-verde", name: "Budião-verde", file: "budiao-verde.png", difficulty: 2, points: 20 },
  { id: "peixe-voador", name: "Peixe-voador", file: "peixe-voador.png", difficulty: 4, points: 70 },
  { id: "peixe-bandeira", name: "Peixe-bandeira", file: "peixe-bandeira.png", difficulty: 5, points: 120 },
];
fetch(API + "/api/fish").then(r => r.json()).then(d => fishList = d).catch(() => {});
const imgs = {};
const img = f => imgs[f] || (imgs[f] = Object.assign(new Image(), { src: "assets/fishs/" + f }));
fishList.forEach(f => img(f.file));
const post = (p, b) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }).then(r => r.json());

// Estado
let px = 240, dir = 1, state = "walk", t = 0, bobber = { x: 0, y: 0 };
let moving = false, walkAmp = 0;
let fish = null, score = 0, msg = "", msgT = 0, bite = 0;
const bar = { y: 0, v: 0, h: 44 }, fp = { y: 0, target: 0, timer: 0 };
let prog = 0;
const TRACK = { x: 420, y: 50, h: 170 };
const keys = {};

// ---------- Multiplayer ----------
const others = {};
const myName = (prompt("Escolha seu apelido:") || "").trim().slice(0, 14) || "Pescador" + (100 + Math.random() * 900 | 0);
const socket = typeof io !== "undefined" ? io(API, { transports: ["websocket"] }) : null;
if (socket) {
  const add = p => others[p.id] = { ...p, tx: p.x };
  socket.on("connect", () => socket.emit("join", { name: myName }));
  socket.on("players", list => { Object.keys(others).forEach(k => delete others[k]); list.forEach(p => p.id !== socket.id && add(p)); });
  socket.on("player:join", add);
  socket.on("player:move", ({ x, ...rest }) => { const o = others[rest.id]; if (o) { Object.assign(o, rest); o.tx = x; } });
  socket.on("player:leave", id => delete others[id]);
}
let lastNet = 0;
function net(now) {
  if (!socket || !socket.connected || now - lastNet < 66) return;
  lastNet = now;
  socket.volatile.emit("move", { x: px, dir, state, bx: bobber.x });
}
function drawFisher(x, dir, shirt, hat, amp = 0) {
  const ph = x * dir / 11, sw = Math.sin(ph) * amp, bob = -Math.abs(Math.cos(ph)) * 1.4 * amp;
  ctx.save(); ctx.translate(x, PIER_Y); ctx.scale(dir, 1);
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(0, 0, 9, 2, 0, 0, 7); ctx.fill();
  const leg = (a, col) => {                                                      // perna gira a partir do quadril
    ctx.save(); ctx.translate(0, -11 + bob); ctx.rotate(a);
    rect(col, -2.3, 0, 4.6, 9); rect("#15110e", -3, 8.5, 6.6, 2.5);
    ctx.restore();
  };
  leg(-sw * 0.75, "#1c2a38"); leg(sw * 0.75, "#26384a");                         // trás (escura) e frente
  ctx.save(); ctx.translate(0, -22 + bob); ctx.rotate(-sw * 0.6 + 0.1);          // braço livre balançando
  rect(shirt, -1.7, 0, 3.4, 9); rect("rgba(0,0,0,.35)", -1.7, 0, 3.4, 9); rect("#d9ab6f", -1.7, 8.5, 3.4, 3);
  ctx.restore();
  ctx.translate(0, bob);                                                         // tronco sobe e desce ao andar
  rect(shirt, -6, -24, 12, 14);
  rect("rgba(0,0,0,.25)", -6, -24, 3.5, 14); rect("rgba(255,255,255,.18)", 3, -24, 2, 14);
  rect("#5a3b22", -6, -12, 12, 2);
  rect(shirt, 3, -22, 8, 3.5); rect("rgba(0,0,0,.2)", 3, -19, 8, 0.8);
  rect("#f1c27d", 10.5, -22, 3, 3.5);
  rect("#e0ac69", -3, -26, 4, 2.5);
  rect("#f1c27d", -3.5, -33, 9, 8.5); rect("rgba(0,0,0,.12)", -3.5, -33, 3, 8.5);
  rect("#2a1a10", 2.5, -30, 1.6, 1.8); rect("#c98d5a", 4, -27.5, 2, 1);
  rect(hat, -6, -35.5, 14, 3); rect(hat, -3.5, -40, 9, 5);
  rect("rgba(0,0,0,.25)", -6, -34, 14, 1.2); rect("rgba(255,255,255,.35)", -3.5, -36.5, 9, 1.2);
  ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(10, -21); ctx.lineTo(33, -45); ctx.stroke();
  rect("#b8b8b8", 9, -23, 3, 3);
  ctx.restore();
  return { x: x + dir * 33, y: PIER_Y - 45 + bob };
}
function drawLine(tx, ty, bx, now, st) {
  const b = Math.sin(now / 200) * (st === "bite" ? 3 : 1), by = WATER_Y + 6 + b;
  ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + bx) / 2, (ty + by) / 2 + 12, bx, by); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.beginPath(); ctx.ellipse(bx, WATER_Y + 7, 6 + Math.sin(now / 250), 1.6, 0, 0, 7); ctx.stroke();
  rect("#e63946", bx - 2, by - 3.5, 4, 3.5); rect("#fff", bx - 2, by, 4, 3);
  if (st === "bite") text("!", bx, by - 22, "#ffd166", "center");
}
function drawOther(p, now) {
  const dx = p.tx - p.x; p.x += dx * 0.25;
  p.amp = (p.amp || 0) + ((Math.abs(dx) > 0.4 && p.state === "walk" ? 1 : 0) - (p.amp || 0)) * 0.25;
  const tip = drawFisher(p.x, p.dir, p.color, "#2d6a4f", p.amp);
  if (p.state !== "walk") drawLine(tip.x, tip.y, p.bx, now, p.state);
  text(p.name, p.x, PIER_Y - 46, "#cfe8ff", "center");
}

addEventListener("keydown", e => {
  keys[e.code] = true;
  if (e.code === "Space") { e.preventDefault(); if (!e.repeat) press(); }
});
addEventListener("keyup", e => keys[e.code] = false);
cv.addEventListener("pointerdown", e => {
  if (state === "walk" && e.clientX) { /* toque: metade esquerda/direita move, centro lança */ }
  keys.Space = true; press();
});
addEventListener("pointerup", () => keys.Space = false);

function say(m) { msg = m; msgT = 2.5; }

function press() {
  if (state === "walk") {
    state = "wait"; t = 2 + Math.random() * 3;
    bobber = { x: px + dir * 34, y: WATER_Y + 6 };
    fish = null;
    post("/api/bite").then(f => fish = f).catch(() => fish = fishList[Math.random() * fishList.length | 0]);
  } else if (state === "wait") { state = "walk"; say("Você recolheu a linha"); }
  else if (state === "bite") startReel();
}

function startReel() {
  if (!fish) fish = fishList[0];
  state = "reel"; prog = 25;
  bar.y = TRACK.h - bar.h; bar.v = 0;
  fp.y = TRACK.h / 2; fp.target = fp.y; fp.timer = 0;
}

function finish(win) {
  state = "walk";
  if (win) { score += fish.points; say(`Pegou: ${fish.name}! +${fish.points}`); post("/api/catch", { id: fish.id }).catch(() => {}); }
  else say("O peixe escapou...");
}

function update(dt) {
  msgT = Math.max(0, msgT - dt);
  walkAmp += ((moving ? 1 : 0) - walkAmp) * Math.min(1, dt * 14); moving = false;
  if (state === "walk") {
    const m = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    const ox = px;
    if (m) { dir = m; px = Math.max(16, Math.min(W - 16, px + m * 90 * dt)); }
    moving = Math.abs(px - ox) > 0.001;
  } else if (state === "wait") {
    t -= dt; if (t <= 0) { state = "bite"; bite = 1.4; }
  } else if (state === "bite") {
    bite -= dt; if (bite <= 0) { state = "walk"; say("Fisgou tarde demais"); }
  } else if (state === "reel") {
    const d = fish.difficulty;
    bar.v += (keys.Space ? -900 : 700) * dt * 0.012 * 60 / 60;
    bar.v = Math.max(-6, Math.min(6, bar.v));
    bar.y += bar.v * dt * 60 * 0.5;
    if (bar.y < 0) { bar.y = 0; bar.v = 0; }
    if (bar.y > TRACK.h - bar.h) { bar.y = TRACK.h - bar.h; bar.v *= -0.3; }
    fp.timer -= dt;
    if (fp.timer <= 0) { fp.target = 10 + Math.random() * (TRACK.h - 20); fp.timer = (0.5 + Math.random()) / (d * 0.5); }
    fp.y += (fp.target - fp.y) * Math.min(1, dt * (1.2 + d * 0.5));
    const inside = fp.y > bar.y && fp.y < bar.y + bar.h;
    prog += (inside ? 18 : -12) * dt;
    if (prog >= 100) finish(true); else if (prog <= 0) finish(false);
  }
}

const rect = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
const text = (s, x, y, c = "#fff", a = "left") => { ctx.font = "bold 10px monospace"; ctx.textAlign = a; ctx.fillStyle = "#000"; ctx.fillText(s, x + 1, y + 1); ctx.fillStyle = c; ctx.fillText(s, x, y); };

function layer(fn) {                      // desenha uma vez num canvas separado (cache)
  const c = document.createElement("canvas"); c.width = W * S; c.height = H * S;
  const x = c.getContext("2d"); x.scale(S, S);
  const prev = ctx; ctx = x; fn(); ctx = prev; return c;
}
function buildLayers() {
  const sky = layer(() => {
    let g = ctx.createLinearGradient(0, 0, 0, PIER_Y + 8);
    g.addColorStop(0, "#241a45"); g.addColorStop(0.45, "#b83f6a"); g.addColorStop(0.8, "#f4a261"); g.addColorStop(1, "#ffe0a8");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, PIER_Y + 8);
    g = ctx.createRadialGradient(370, 62, 4, 370, 62, 80);
    g.addColorStop(0, "#fffbe6"); g.addColorStop(0.2, "#ffe9a8"); g.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = g; ctx.fillRect(270, 0, 210, PIER_Y);
  });
  const back = layer(() => {
    ctx.fillStyle = "#6b3f6f"; ctx.beginPath(); ctx.moveTo(0, 160); [[0,128],[60,108],[110,128],[170,100],[230,130],[300,112],[360,134],[420,106],[480,126]].forEach(([x,y]) => ctx.lineTo(x, y)); ctx.lineTo(480, 160); ctx.fill();
    ctx.fillStyle = "#4a2f63"; ctx.beginPath(); ctx.moveTo(0, 160); [[0,142],[80,126],[150,142],[250,122],[340,144],[410,130],[480,142]].forEach(([x,y]) => ctx.lineTo(x, y)); ctx.lineTo(480, 160); ctx.fill();
    rect("#1a1230", 0, PIER_Y + 8, W, WATER_Y - PIER_Y - 8);
    const g = ctx.createLinearGradient(0, WATER_Y, 0, H);
    g.addColorStop(0, "#4a9cc0"); g.addColorStop(1, "#0b2a45");
    ctx.fillStyle = g; ctx.fillRect(0, WATER_Y, W, H - WATER_Y);
  });
  const pier = layer(() => {
    for (let i = 6; i < W; i += 48) { rect("#3b2314", i, PIER_Y + 8, 8, 32); rect("#5a3b22", i + 1, PIER_Y + 8, 2.5, 32); rect("rgba(255,255,255,.12)", i - 3, WATER_Y + 4, 14, 1.5); }
    rect("#6b4226", 0, PIER_Y, W, 8); rect("#a06f42", 0, PIER_Y, W, 3); rect("#4a2d19", 0, PIER_Y + 6, W, 2);
    for (let i = 0; i < W; i += 24) rect("rgba(0,0,0,.35)", i, PIER_Y, 0.8, 6);
  });
  layers = { sky, back, pier };
}
function scene(now) {
  if (!layers) buildLayers();
  ctx.drawImage(layers.sky, 0, 0, W, H);
  [[60, 38, 60, 7], [200, 68, 80, 9], [310, 26, 52, 6], [420, 92, 64, 7], [130, 100, 70, 6]].forEach(([cx, cy, rw, rh], i) => {
    const x = (cx + now / 1000 * (2 + i)) % (W + 160) - 80;
    ctx.fillStyle = "rgba(255,205,185,.32)";
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(x + k * rw * 0.45, cy - k % 2 * 3, rw * (1 - k * 0.2), rh, 0, 0, 7); ctx.fill(); }
  });
  ctx.drawImage(layers.back, 0, 0, W, H);
  for (let i = 0; i < 9; i++) rect("rgba(255,217,160,.9)", 366 - (28 - i * 3) / 2 + Math.sin(now / 500 + i) * 7, WATER_Y + 5 + i * 8, 28 - i * 3, 1.6);
  ctx.lineWidth = 0.8;
  for (let j = 0; j < 14; j++) {
    ctx.strokeStyle = `rgba(190,230,245,${0.28 - j * 0.015})`; ctx.beginPath();
    for (let x = 0; x <= W; x += 8) { const y = WATER_Y + 5 + j * 7 + Math.sin((x + now / (28 + j * 5)) / (9 + j)) * 1.6; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
  ctx.drawImage(layers.pier, 0, 0, W, H);
}

function draw(now) {
  scene(now);
  Object.values(others).forEach(o => drawOther(o, now));
  const tip = drawFisher(px, dir, "#c0392b", "#d98e04", walkAmp);
  text(myName, px, PIER_Y - 46, "#ffd166", "center");
  if (state === "wait" || state === "bite" || state === "reel") drawLine(tip.x, tip.y, bobber.x, now, state);

  // minigame estilo Stardew
  if (state === "reel") {
    rect("#3b2a1a", TRACK.x - 14, TRACK.y - 8, 44, TRACK.h + 16);
    rect("#1b3a4b", TRACK.x, TRACK.y, 16, TRACK.h);
    rect("#6bd66b", TRACK.x + 1, TRACK.y + bar.y, 14, bar.h);
    const fi = img(fish.file), cy = TRACK.y + fp.y;
    if (fi.complete && fi.naturalWidth) {
      const r = Math.min(40 / fi.naturalWidth, 30 / fi.naturalHeight), w = fi.naturalWidth * r, h = fi.naturalHeight * r;
      ctx.drawImage(fi, TRACK.x + 8 - w / 2, cy - h / 2, w, h);
    } else rect("#ffd166", TRACK.x + 3, cy - 4, 10, 8);
    // progresso
    rect("#1b1b1b", TRACK.x + 22, TRACK.y, 6, TRACK.h);
    rect(prog > 66 ? "#6bd66b" : prog > 33 ? "#ffd166" : "#e63946", TRACK.x + 23, TRACK.y + TRACK.h * (1 - prog / 100), 4, TRACK.h * prog / 100);
  }

  // HUD
  text("Pontos: " + score, 10, 16);
  const hint = { walk: "← → mover   ESPAÇO lançar", wait: "Aguarde a fisgada...", bite: "ESPAÇO agora!", reel: "Segure ESPAÇO para subir a barra" }[state];
  text(hint, 10, H - 10, "#fff");
  if (msgT > 0) text(msg, W / 2, 40, "#ffd166", "center");
  present();
}

let last = performance.now(), slow = 0;
(function loop(now) {
  const raw = (now - last) / 1000;
  update(Math.min(0.05, raw)); last = now;
  slow = raw > 0.04 ? slow + 1 : Math.max(0, slow - 1);          // abaixo de ~25 fps por um tempo: reduz a resolução
  if (slow > 60 && S > 1) { setScale(S > 1.5 ? 1.5 : 1); slow = 0; }
  net(now); draw(now); requestAnimationFrame(loop);
})(last);
cv.focus();
