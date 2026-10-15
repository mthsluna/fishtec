const cv = document.getElementById("g"), ctx = cv.getContext("2d");
const W = 480, H = 270; cv.width = W; cv.height = H;
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
let fish = null, score = 0, msg = "", msgT = 0, bite = 0;
const bar = { y: 0, v: 0, h: 44 }, fp = { y: 0, target: 0, timer: 0 };
let prog = 0;
const TRACK = { x: 420, y: 50, h: 170 };
const keys = {};

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
  if (state === "walk") {
    const m = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    if (m) { dir = m; px = Math.max(16, Math.min(W - 16, px + m * 90 * dt)); }
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

const rect = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w, h); };
const text = (s, x, y, c = "#fff", a = "left") => { ctx.font = "bold 10px monospace"; ctx.textAlign = a; ctx.fillStyle = "#000"; ctx.fillText(s, x + 1, y + 1); ctx.fillStyle = c; ctx.fillText(s, x, y); };

function draw(now) {
  // céu em faixas (efeito bitmap)
  ["#f4a261", "#f6b27a", "#f8c391", "#fad4ab", "#fce0c0"].forEach((c, i) => rect(c, 0, i * 30, W, 30));
  rect("#ffe9a8", 360, 40, 28, 28);
  // água
  rect("#2a6f97", 0, WATER_Y, W, H - WATER_Y);
  for (let i = 0; i < 40; i++) {
    const wx = (i * 37 + now / 40) % W, wy = WATER_Y + 8 + (i * 13) % 90;
    rect("#61a5c2", wx, wy, 8, 2);
  }
  // cais
  rect("#6b4226", 0, PIER_Y, W, 8);
  rect("#8a5a35", 0, PIER_Y, W, 3);
  for (let i = 0; i < W; i += 48) rect("#4a2d19", i, PIER_Y + 8, 6, 20);

  // jogador
  const bx = px - 6, by = PIER_Y - 30;
  rect("#d98e04", bx - 1, by - 4, 14, 4);       // chapéu
  rect("#f1c27d", bx + 2, by, 8, 8);            // rosto
  rect("#c0392b", bx, by + 8, 12, 12);          // camisa
  rect("#2c3e50", bx + 1, by + 20, 4, 10); rect("#2c3e50", bx + 7, by + 20, 4, 10);
  const tipX = px + dir * 30, tipY = PIER_Y - 46;
  ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px + dir * 4, by + 12); ctx.lineTo(tipX, tipY); ctx.stroke();

  if (state === "wait" || state === "bite" || state === "reel") {
    const bob = Math.sin(now / 200) * (state === "bite" ? 3 : 1);
    ctx.strokeStyle = "#eee"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(bobber.x, bobber.y + bob); ctx.stroke();
    rect("#e63946", bobber.x - 2, bobber.y - 3 + bob, 5, 3); rect("#fff", bobber.x - 2, bobber.y + bob, 5, 3);
  }
  if (state === "bite") text("!", bobber.x, bobber.y - 22, "#ffd166", "center");

  // minigame estilo Stardew
  if (state === "reel") {
    rect("#3b2a1a", TRACK.x - 14, TRACK.y - 8, 44, TRACK.h + 16);
    rect("#1b3a4b", TRACK.x, TRACK.y, 16, TRACK.h);
    rect("#6bd66b", TRACK.x + 1, TRACK.y + bar.y, 14, bar.h);
    const fi = img(fish.file), fyy = TRACK.y + fp.y - 8;
    if (fi.complete && fi.naturalWidth) ctx.drawImage(fi, TRACK.x - 2, fyy, 20, 16 * fi.naturalHeight / fi.naturalWidth * 1.25 | 0 || 16);
    else rect("#ffd166", TRACK.x + 3, fyy + 4, 10, 8);
    // progresso
    rect("#1b1b1b", TRACK.x + 22, TRACK.y, 6, TRACK.h);
    rect(prog > 66 ? "#6bd66b" : prog > 33 ? "#ffd166" : "#e63946", TRACK.x + 23, TRACK.y + TRACK.h * (1 - prog / 100), 4, TRACK.h * prog / 100);
  }

  // HUD
  text("Pontos: " + score, 10, 16);
  const hint = { walk: "← → mover   ESPAÇO lançar", wait: "Aguarde a fisgada...", bite: "ESPAÇO agora!", reel: "Segure ESPAÇO para subir a barra" }[state];
  text(hint, 10, H - 10, "#fff");
  if (msgT > 0) text(msg, W / 2, 40, "#ffd166", "center");
}

let last = performance.now();
(function loop(now) {
  update(Math.min(0.05, (now - last) / 1000)); last = now;
  draw(now); requestAnimationFrame(loop);
})(last);
cv.focus();
