const cv = document.getElementById("g");
const WORLD = 480, H = 270;              // WORLD = área jogável (igual ao servidor); a tela pode ser mais larga
const EXT = 160, LW = WORLD + EXT * 2;   // margem extra das camadas de fundo (para o parallax e telas largas)
const RD = 90;                           // altura (px lógicos) do reflexo na água
let W = WORLD;                           // largura visível (ajusta sozinha ao formato da janela)
let S = 2;                               // resolução interna (baixa sozinha se o jogo ficar pesado)
let ctx, layers = null;
const refl = document.createElement("canvas");
const viewW = () => Math.max(WORLD, Math.min(WORLD + 240, Math.round(H * innerWidth / innerHeight)));

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
  S = s; layers = null; W = viewW();
  cv.width = buf.width = W * S; cv.height = buf.height = H * S;
  refl.width = W * S; refl.height = RD * S;
  cv.style.width = Math.min(innerWidth, innerHeight * W / H) + "px";   // preenche a tela, sem barras laterais
  ctx = buf.getContext("2d", gl ? {} : { willReadFrequently: true });
  ctx.scale(S, S);
}
setScale(2);
addEventListener("resize", () => setScale(S));

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
const HZ = 132;                                  // linha do horizonte: montanhas e mata acabam aqui; daqui até o cais é o lago distante
const BOB_Y = WATER_Y + 22;                       // a boia fica mais longe do cais, em água aberta
// afasta a boia dos postes de madeira (um poste a cada 48px)
const clearOfPosts = x => {
  x = Math.max(16, Math.min(WORLD - 16, x));
  const m = ((x - 6) % 48 + 48) % 48;
  return m < 14 ? x + 14 - m : m > 42 ? x + 48 - m + 14 : x;
};

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
const TRACK = { get x() { return W - 60; }, y: 50, h: 170 };
let cs = { t: 0, rel: null, hang: null }; const fxs = [];            // arremesso em andamento e respingos
let stepDist = 0, reelT = 0;                       // controle dos sons de passo e de carretilha
let camX = 0;                                     // câmera: acompanha o pescador (base do parallax)
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
let lastNet = 0, lastSt = "";
function net(now) {
  if (!socket || !socket.connected) return;
  if (now - lastNet < 66 && state === lastSt) return;            // 15x por segundo, ou na hora se o estado mudou
  lastNet = now; lastSt = state;
  socket.volatile.emit("move", { x: px, dir, state, bx: bobber.x });
}
const REST = -0.846, POSE0 = { rod: REST, arm: 0, lean: 0, flex: 0 };   // pose parada da vara
function drawFisher(x, dir, shirt, hat, amp = 0, pose = null) {
  const P = pose || POSE0;
  const ph = x * dir / 11, sw = Math.sin(ph) * amp, bob = -Math.abs(Math.cos(ph)) * 1.4 * amp;
  ctx.save(); ctx.translate(x, PIER_Y); ctx.scale(dir, 1);
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(0, 0, 9, 2, 0, 0, 7); ctx.fill();
  const leg = (a, col) => {                                                      // perna gira a partir do quadril
    ctx.save(); ctx.translate(0, -11 + bob); ctx.rotate(a);
    rect(col, -2.3, 0, 4.6, 9); rect("#15110e", -3, 8.5, 6.6, 2.5);
    ctx.restore();
  };
  leg(-sw * 0.75, "#1c2a38"); leg(sw * 0.75, "#26384a");                         // trás (escura) e frente
  if (P.crank === undefined) {                                                     // (na hora de puxar o peixe, esse braço vai girar a manivela)
    ctx.save(); ctx.translate(0, -22 + bob); ctx.rotate(-sw * 0.6 + 0.1 + (P.off || 0));   // braço livre balançando (e fazendo contrapeso no arremesso)
    rect(shirt, -1.7, 0, 3.4, 9); rect("rgba(0,0,0,.35)", -1.7, 0, 3.4, 9); rect("#d9ab6f", -1.7, 8.5, 3.4, 3);
    ctx.restore();
  }
  ctx.translate(0, bob); ctx.translate(0, -11); ctx.rotate(P.lean); ctx.translate(0, 11);   // tronco inclina a partir do quadril                                                         // tronco sobe e desce ao andar
  rect(shirt, -6, -24, 12, 14);
  rect("rgba(0,0,0,.25)", -6, -24, 3.5, 14); rect("rgba(255,255,255,.18)", 3, -24, 2, 14);
  rect("#5a3b22", -6, -12, 12, 2);
  ctx.save(); ctx.translate(3, -20.25); ctx.rotate(P.arm);                                 // antebraço gira no ombro
  rect(shirt, 0, -1.75, 8, 3.5); rect("rgba(0,0,0,.2)", 0, 1.25, 8, 0.8); rect("#f1c27d", 7.5, -1.75, 3, 3.5);
  ctx.restore();
  
  rect("#e0ac69", -3, -26, 4, 2.5);
  rect("#f1c27d", -3.5, -33, 9, 8.5); rect("rgba(0,0,0,.12)", -3.5, -33, 3, 8.5);
  rect("#2a1a10", 2.5, -30, 1.6, 1.8); rect("#c98d5a", 4, -27.5, 2, 1);
  rect(hat, -6, -35.5, 14, 3); rect(hat, -3.5, -40, 9, 5);
  rect("rgba(0,0,0,.25)", -6, -34, 14, 1.2); rect("rgba(255,255,255,.35)", -3.5, -36.5, 9, 1.2);
  const ca = Math.cos(P.arm), sa = Math.sin(P.arm);
  const hx = 3 + 8 * ca, hy = -20.25 + 8 * sa;                     // posição da mão
  const ra = P.rod - P.flex * 0.25, RL = 33.1;                       // a ponta da vara atrasa quando ela chicoteia
  const tx = hx + RL * Math.cos(ra), ty = hy + RL * Math.sin(ra);
  const cx = (hx + tx) / 2 + P.flex * 6.6 * Math.sin(P.rod), cy = (hy + ty) / 2 - P.flex * 6.6 * Math.cos(P.rod);
  ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(cx, cy, tx, ty); ctx.stroke();
  if (P.crank === undefined) rect("#b8b8b8", hx - 1.5, hy - 1.5, 3, 3);
  else {                                                                              // carretilha de verdade: corpo, manivela girando e a mão da frente puxando
    const rdx = Math.cos(ra), rdy = Math.sin(ra);
    const rcx = hx + rdx * 3 - rdy * 3, rcy = hy + rdy * 3 + rdx * 3;                  // carretilha pendurada embaixo da vara, logo à frente da mão
    rect("#7d7d7d", rcx - 2.8, rcy - 2.8, 5.6, 5.6); rect("#c9c9c9", rcx - 2.1, rcy - 2.1, 4.2, 4.2);
    rect("#8a8a8a", rcx - 2.1, rcy + 0.6, 4.2, 1.5); rect("#4d4d4d", rcx - 0.7, rcy - 0.7, 1.4, 1.4);
    const kx = rcx + 2.6 * Math.cos(P.crank), ky = rcy + 2.6 * Math.sin(P.crank);       // ponta da manivela
    ctx.strokeStyle = "#dcdcdc"; ctx.lineWidth = 1; ctx.lineCap = "butt";
    ctx.beginPath(); ctx.moveTo(rcx, rcy); ctx.lineTo(kx, ky); ctx.stroke();
    const ax = 4, ay = -20.5, vx = kx - ax, vy = ky - ay, L = Math.max(6, Math.hypot(vx, vy) - 1.5);
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(vy, vx));                // braço livre estica até a manivela
    rect(shirt, 0, -1.7, L, 3.4); rect("rgba(0,0,0,.2)", 0, 1.25, L, 0.8); rect("#d9ab6f", L - 0.8, -1.7, 3, 3.4);
    ctx.restore();
    rect("#e8c34a", kx - 1, ky - 1, 2, 2);                                              // cabo da manivela
  }
  ctx.restore();
  const dy = ty + 11, c = Math.cos(P.lean), sn = Math.sin(P.lean);   // ponta da vara no mundo (com a inclinação)
  return { x: x + dir * (tx * c - dy * sn), y: PIER_Y + (tx * sn + dy * c) - 11 + bob };
}
// zoom: reaproveita o quadro pronto (assim o reflexo continua certo) e redesenha só um pedaço dele, ampliado
const zb = document.createElement("canvas"); let zctx = null;
function zoomView(z, fx, fy, side = 0.5) {                       // side: onde o personagem fica na tela (0 = esquerda, 0.5 = meio)
  if (!zctx || zb.width !== buf.width || zb.height !== buf.height) { zb.width = buf.width; zb.height = buf.height; zctx = zb.getContext("2d"); }
  zctx.setTransform(1, 0, 0, 1, 0, 0); zctx.drawImage(buf, 0, 0);
  const sw = W / z, sh = H / z, sx = Math.max(0, Math.min(W - sw, fx - side * sw)), sy = Math.max(0, Math.min(H - sh, fy - sh / 2));
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(zb, sx * S, sy * S, sw * S, sh * S, 0, 0, W, H);
}
// ---------- Puxando o peixe: inclina para trás, vara envergada pela força do peixe e manivela girando ----------
let reelAng = 0, zk = 0;                                           // ângulo da manivela e quanto o zoom já "abriu" (0 a 1)
function reelPose(now, ang = reelAng, inside = fish && fp.y > bar.y && fp.y < bar.y + bar.h) {   // peixe dentro da barra = vara mais folgada; fora = peixe puxando forte
  const pull = (inside ? 0.55 : 0.95) + 0.2 * Math.sin(now / 95);
  const tipA = -1.0 + 0.2 * (pull - 0.5) + 0.03 * Math.sin(now / 130);   // ângulo da ponta: abaixa quando o peixe puxa forte
  return { rod: tipA + pull * 0.25, arm: -0.25, lean: -0.13 - 0.03 * Math.sin(now / 110), off: 0, flex: pull, crank: ang };
}
function drawLine(tx, ty, bx, now, st) {
  const b = Math.sin(now / 200) * (st === "bite" ? 3 : 1), by = BOB_Y + b;
  ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + bx) / 2, (ty + by) / 2 + 12, bx, by); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.beginPath(); ctx.ellipse(bx, BOB_Y + 1, 6 + Math.sin(now / 250), 1.6, 0, 0, 7); ctx.stroke();
  rect("#e63946", bx - 2, by - 3.5, 4, 3.5); rect("#fff", bx - 2, by, 4, 3);
  if (st === "bite") text("!", bx, by - 22, "#ffd166", "center");
}
function drawOther(p, now) {
  const dx = p.tx - p.x; p.x += dx * 0.25;
  p.amp = (p.amp || 0) + ((Math.abs(dx) > 0.4 && p.state === "walk" ? 1 : 0) - (p.amp || 0)) * 0.25;
  const dt = Math.min(0.1, (now - (p.lt || now)) / 1000); p.lt = now;
  if (p.pst !== p.state) {                                       // mudou de estado: começa a animação certa
    p.pst = p.state;
    if (p.state === "cast") { p.cs = { t: 0, rel: null, hang: null }; p.c0 = now; p.landed = false; }
    if (p.state === "reel") p.ra = 0;
  }
  let pose = null;
  if (p.state === "cast" && p.cs) {
    p.cs.t = (now - p.c0) / 1000;
    pose = castPose(p.cs.t);
    if (!p.landed && p.cs.t >= CAST_RELEASE + CAST_FLIGHT) { p.landed = true; fxs.push({ x: p.bx, t0: now }); }   // respingo quando a boia dele cai
  } else if (p.state === "reel") {
    const inside = Math.sin(now / 900 + p.x) > -0.2;             // o servidor não manda a barra do minigame: simula o vai-e-vem
    p.ra += (inside ? 14 : -3) * dt;
    pose = reelPose(now, p.ra, inside);
  }
  p.tip = drawFisher(p.x, p.dir, p.color, "#2d6a4f", p.amp, pose);   // o pescador entra no reflexo
}
function drawOtherLine(p, now) {                                 // linha e nome são desenhados por cima da água
  if (p.state === "cast" && p.cs && p.tip) drawCast(p.tip, p.cs, p.bx);
  else if (p.state !== "walk" && p.tip) drawLine(p.tip.x, p.tip.y, p.bx, now, p.state);
  text(p.name, p.x, PIER_Y - 46, "#cfe8ff", "center");
}

// ---------- Arremesso da vara: recuo -> chicote -> soltura; a boia voa em arco e cai com respingo ----------
const lerp = (a, b, k) => a + (b - a) * k, easeOut = k => 1 - (1 - k) * (1 - k), easeIn = k => k * k;
const easeInOut = k => k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
const CAST_SWING = 1.0, CAST_RELEASE = CAST_SWING * 0.6, CAST_FLIGHT = 0.6;   // segundos (a soltura acontece no fim do chicote)
function castPose(c) {
  const u = Math.min(1, c / CAST_SWING);
  if (u < 0.45) { const k = easeInOut(u / 0.45);                        // recuo: vara vai para trás, corpo inclina e o braço livre abre
    return { rod: lerp(REST, -2.5, k), arm: lerp(0, -1.15, k), lean: lerp(0, -0.2, k), off: lerp(0, -0.5, k), flex: -0.35 * Math.sin(Math.PI * k) }; }
  if (u < 0.6) { const k = (u - 0.45) / 0.15, e = easeIn(k);            // chicote rápido para a frente (a vara envergando)
    return { rod: lerp(-2.5, -0.3, e), arm: lerp(-1.15, 0.3, e), lean: lerp(-0.2, 0.18, e), off: lerp(-0.5, 0.7, e), flex: 1.2 * Math.sin(Math.PI * k) }; }
  const k = easeOut((u - 0.6) / 0.4);                                   // follow-through: a vara baixa um pouco, volta e balança até parar
  return { rod: lerp(-0.3, REST, k) + 0.3 * Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k), arm: lerp(0.3, 0, k), lean: lerp(0.18, 0, k), off: lerp(0.7, 0, k), flex: 0.6 * (1 - k) * Math.sin(k * 14) };
}
function drawCast(tip, st, tx) {                                         // st = { t, rel, hang }; tx = x onde a boia vai cair
  let bx, by, sag = 3;
  if (st.t < CAST_RELEASE) {                                              // boia pendurada na linha antes de soltar, balançando atrás da ponta
    if (!st.hang) st.hang = { x: tip.x, y: tip.y + 13 };
    st.hang.x += (tip.x - st.hang.x) * 0.18; st.hang.y += (tip.y + 13 - st.hang.y) * 0.18;
    bx = st.hang.x; by = st.hang.y; sag = 3 + Math.abs(tip.x - bx) * 0.6;
  } else {
    if (!st.rel) st.rel = st.hang ? { x: st.hang.x, y: st.hang.y } : { x: tip.x, y: tip.y + 13 };
    const s = Math.min(1, (st.t - CAST_RELEASE) / CAST_FLIGHT);
    bx = lerp(st.rel.x, tx, s);
    by = lerp(st.rel.y, BOB_Y, s) - 4 * 45 * s * (1 - s);               // arco
    sag = 3 + 10 * s;
  }
  ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + bx) / 2, (tip.y + by) / 2 + sag, bx, by); ctx.stroke();
  rect("#e63946", bx - 2, by - 3.5, 4, 3.5); rect("#fff", bx - 2, by, 4, 3);
}
function drawFx(now) {                                                   // anéis e gotas quando a boia cai na água
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i], a = (now - f.t0) / 1000;
    if (a > 0.7) { fxs.splice(i, 1); continue; }
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - a / 0.7)})`; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(f.x, BOB_Y + 1, 3 + a * 28, 1 + a * 5, 0, 0, 7); ctx.stroke();
    for (let d = 0; d < 6; d++) {
      const gx = f.x + (d - 2.5) * 9 * a, gy = BOB_Y + (-55 - (d % 2) * 15) * a + 140 * a * a;
      if (gy < BOB_Y + 2) rect(`rgba(255,255,255,${1 - a / 0.7})`, gx - 0.8, gy - 0.8, 1.6, 1.6);
    }
  }
}

addEventListener("keydown", e => {
  SND.unlock();                                         // o navegador só libera o som depois de uma tecla/toque
  keys[e.code] = true;
  if (e.code === "KeyM" && !e.repeat) say(SND.toggleMute() ? "Som desligado" : "Som ligado");
  if (e.code === "Space") { e.preventDefault(); if (!e.repeat) press(); }
});
addEventListener("keyup", e => keys[e.code] = false);
cv.addEventListener("pointerdown", e => {
  if (state === "walk" && e.clientX) { /* toque: metade esquerda/direita move, centro lança */ }
  SND.unlock();
  keys.Space = true; press();
});
addEventListener("pointerup", () => keys.Space = false);

function say(m) { msg = m; msgT = 2.5; }

function press() {
  if (state === "walk") {
    state = "cast"; cs = { t: 0, rel: null, hang: null };
    bobber = { x: clearOfPosts(px + dir * 70), y: BOB_Y };
    fish = null; SND.cast();
    post("/api/bite").then(f => fish = f).catch(() => fish = fishList[Math.random() * fishList.length | 0]);
  } else if (state === "wait") { state = "walk"; SND.retract(); say("Você recolheu a linha"); }
  else if (state === "bite") startReel();
}

function startReel() {
  if (!fish) fish = fishList[0];
  state = "reel"; prog = 25; reelT = 0; reelAng = 0; SND.hook();
  bar.y = TRACK.h - bar.h; bar.v = 0;
  fp.y = TRACK.h / 2; fp.target = fp.y; fp.timer = 0;
}

function finish(win) {
  state = "walk";
  if (win) { score += fish.points; SND.win(); say(`Pegou: ${fish.name}! +${fish.points}`); post("/api/catch", { id: fish.id }).catch(() => {}); }
  else { SND.lose(); say("O peixe escapou..."); }
}

function update(dt) {
  msgT = Math.max(0, msgT - dt);
  camX += (-(px - WORLD / 2) * 0.12 - camX) * Math.min(1, dt * 4);   // câmera suave atrás do pescador
  zk += ((state === "reel" ? 1 : 0) - zk) * Math.min(1, dt * 4);      // zoom entra e sai suavemente
  walkAmp += ((moving ? 1 : 0) - walkAmp) * Math.min(1, dt * 14); moving = false;
  if (state === "walk") {
    const m = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    const ox = px;
    if (m) { dir = m; px = Math.max(16, Math.min(WORLD - 16, px + m * 90 * dt)); }
    moving = Math.abs(px - ox) > 0.001;
    stepDist += Math.abs(px - ox);
    if (stepDist >= 22) { stepDist -= 22; SND.step(); }          // um passo a cada ~22px andados
  } else if (state === "cast") {
    cs.t += dt;
    if (cs.t >= CAST_RELEASE + CAST_FLIGHT) { state = "wait"; t = 2 + Math.random() * 3; fxs.push({ x: bobber.x, t0: performance.now() }); SND.splash(); }
  } else if (state === "wait") {
    t -= dt; if (t <= 0) { state = "bite"; bite = 1.4; SND.bite(); }
  } else if (state === "bite") {
    bite -= dt; if (bite <= 0) { state = "walk"; SND.lose(); say("Fisgou tarde demais"); }
  } else if (state === "reel") {
    reelAng += (keys.Space ? 16 : -3.5) * dt;                       // manivela gira rápido ao segurar ESPAÇO e volta devagar quando o peixe puxa a linha
    SND.reel(!!keys.Space);                                          // carretilha em loop enquanto segura ESPAÇO
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

function layer(fn, w = LW, h = H) {        // desenha uma vez num canvas separado (cache)
  const c = document.createElement("canvas"); c.width = w * S; c.height = h * S;
  const x = c.getContext("2d"); x.scale(S, S);
  const prev = ctx; ctx = x; fn(); ctx = prev; return c;
}
// ---------- Nuvens realistas: volumes com sombra, corpo e luz do sol (vinda da direita/cima) ----------
const CLOUDS = [                          // back: nuvens distantes (pequenas, lentas, mais apagadas), passam atrás das montanhas                          // m = segundos que a nuvem leva para se transformar numa nova forma (bem lento)
  { back: 1, w: 62, h: 20, y: 92,  x: 60,  v: 1.1, tone: 2, seed: 61, m: 95 },
  { back: 1, w: 48, h: 16, y: 104, x: 250, v: 0.8, tone: 2, seed: 67, m: 110 },
  { back: 1, w: 70, h: 22, y: 84,  x: 420, v: 1.3, tone: 2, seed: 73, m: 85 },
  { back: 1, w: 40, h: 14, y: 112, x: 560, v: 0.9, tone: 2, seed: 79, m: 100 },
  { w: 130, h: 46, y: 20, x: 200, v: 3.6, tone: 0, seed: 19, m: 75 },
  { w: 200, h: 72, y: 52, x: 30,  v: 2.4, tone: 1, seed: 7,  m: 60 },
  { w: 160, h: 56, y: 76, x: 330, v: 2.0, tone: 1, seed: 33, m: 90 },
  { w: 110, h: 40, y: 42, x: 440, v: 3.0, tone: 0, seed: 41, m: 68 },
];
function makeCloud(w, h, seed, tone) {
  let r = seed; const rnd = () => (r = r * 16807 % 2147483647) / 2147483647;
  const T = [{ hi: "255,236,200", mid: "244,150,140", sh: "100,52,112" }, { hi: "255,214,190", mid: "220,112,150", sh: "74,40,104" }, { hi: "255,214,180", mid: "238,150,150", sh: "150,84,130" }][tone];   // tone 2 = nuvem de longe, mais clara e sem contraste forte
  return layer(() => {
    const puffs = [], n = 14 + (rnd() * 6 | 0), yb = h * 0.78;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), bump = Math.sin(Math.PI * t), rad = h * (0.1 + 0.18 * bump) * (0.75 + rnd() * 0.5);
      puffs.push({ x: w * (0.16 + 0.68 * t) + (rnd() - 0.5) * 6, y: yb - rad * (0.55 + rnd() * 0.4) - bump * h * 0.08, r: rad });
      if (rnd() < 0.6) puffs.push({ x: w * (0.16 + 0.68 * t) + (rnd() - 0.5) * 14, y: yb - rad * 1.25 - bump * h * 0.08, r: rad * 0.55 });
    }
    const blob = (x, y, rad, stops) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad); stops.forEach(([o, c]) => g.addColorStop(o, c));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    };
    puffs.forEach(p => blob(p.x - p.r * 0.1, p.y + p.r * 0.25, p.r * 1.2, [[0, `rgba(${T.sh},.75)`], [0.6, `rgba(${T.sh},.45)`], [1, `rgba(${T.sh},0)`]]));   // sombra
    puffs.forEach(p => blob(p.x + p.r * 0.2, p.y - p.r * 0.2, p.r * 0.95, [[0, `rgba(${T.mid},.95)`], [0.65, `rgba(${T.mid},.6)`], [1, `rgba(${T.mid},0)`]])); // corpo
    puffs.forEach(p => blob(p.x + p.r * 0.38, p.y - p.r * 0.42, p.r * 0.6, [[0, `rgba(${T.hi},.95)`], [1, `rgba(${T.hi},0)`]]));                         // luz
    ctx.globalCompositeOperation = "destination-out";                                                                                                       // base achatada e suave
    const g = ctx.createLinearGradient(0, yb - h * 0.05, 0, h); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }, w, h);
}
// ---------- Montanhas: cristas fractais, lado do sol iluminado, neve rosada, névoa na base e pinheiros ----------
function ridgePts(seed, base, amp, rough, pow = 1.25, n = 128) {
  let r = seed; const rnd = () => (r = r * 16807 % 2147483647) / 2147483647;
  const h = new Array(n + 1); h[0] = rnd(); h[n] = rnd();
  let d = 1;
  for (let s = n; s > 1; s >>= 1) {                                   // deslocamento do ponto médio
    d *= rough;
    for (let i = s >> 1; i < n; i += s) h[i] = (h[i - (s >> 1)] + h[i + (s >> 1)]) / 2 + (rnd() - 0.5) * d;
  }
  const mn = Math.min(...h), mx = Math.max(...h);
  return h.map((v, i) => [-EXT + i * LW / n, base - Math.pow((v - mn) / (mx - mn), pow) * amp]);
}
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mixC = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
function valueNoise(seed) {
  let r = seed; const rnd = () => (r = r * 16807 % 2147483647) / 2147483647;
  const t = Array.from({ length: 512 }, rnd);
  return x => { const i = Math.floor(x), f = x - i, k = f * f * (3 - 2 * f), a = t[((i % 512) + 512) % 512], b = t[(((i + 1) % 512) + 512) % 512]; return a + (b - a) * k; };
}
// Montanhas pintadas: a crista vem de ruído suave (picos arredondados) e o sombreado é calculado por pixel.
// Esporões descem diagonalmente de cada pico; os voltados para o sol (direita) clareiam, os outros escurecem,
// e tudo some na névoa quente perto da base, igual ao resto do cenário.
function mountains(o) {
  return layer(() => {
    const BASE = HZ, X0 = -EXT - 80, RES = 4, nz = valueNoise(o.seed);
    const N = Math.ceil((LW + 160) * RES), tab = new Float32Array(N + 2);
    for (let i = 0; i < tab.length; i++) {                               // tabela da forma (0..1), 4 oitavas, as 2 primeiras "em pico"
      const x = X0 + i / RES; let v = 0, a = 0.55, f = o.f, sum = 0;
      for (let k = 0; k < 4; k++) { const n = nz(x * f + k * 17.3), rg = 1 - Math.abs(2 * n - 1); v += a * (k < 2 ? Math.pow(rg, o.sharp) : n); sum += a; a *= 0.5; f *= 2.1; }
      tab[i] = v / sum;
    }
    const R = u => tab[Math.max(0, Math.min(N, Math.round((u - X0) * RES)))];
    const top = hexRGB(o.top), bot = hexRGB(o.bot), shd = hexRGB(o.shadow), lit = hexRGB(o.lit), mist = [255, 196, 150];
    const w = Math.round(LW * S), h = Math.round(BASE * S), im = new ImageData(w, h), d = im.data;
    const yTop = o.base - o.amp;
    for (let i = 0; i < w; i++) {
      const x = i * LW / w - EXT, yr = o.base - o.amp * R(x);
      for (let j = 0; j < h; j++) {
        const y = j * BASE / h, dy = y - yr;
        if (dy < -0.6 / S) continue;
        const u = x + dy * o.skew, ds = -o.amp * (R(u + 1.2) - R(u - 1.2));       // inclinação do esporão naquele ponto
        const L = clamp01(0.5 + ds * o.k), fade = Math.exp(-Math.max(0, dy) / o.fd);
        let c = mixC(top, bot, clamp01((y - yTop) / (BASE - yTop)));
        c = mixC(c, shd, clamp01(0.5 - L) * 2 * o.shA * (0.35 + 0.65 * fade));
        c = mixC(c, lit, clamp01(L - 0.5) * 2 * o.ltA * (0.25 + 0.75 * fade));
        if (dy < 1.6 && L > 0.5) c = mixC(c, lit, 0.55 * (1 - dy / 1.6));          // fio de luz na crista
        c = mixC(c, mist, o.mist * clamp01((y - (BASE - o.mistH)) / o.mistH));      // névoa quente na base
        const p = (j * w + i) * 4;
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = clamp01(dy * S + 0.5) * 255;
      }
    }
    const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h; tmp.getContext("2d").putImageData(im, 0, 0);
    ctx.drawImage(tmp, 0, 0, LW, BASE);
  });
}
function pineHills(seed) {                  // mata da frente: copas arredondadas (2 fileiras), com luz do sol na borda e pouquíssimos pinheiros
  return layer(() => {
    ctx.translate(EXT, 0);
    const BASE = HZ + 1, nz = valueNoise(seed + 3);
    let rs = seed * 13 + 5; const rnd = () => (rs = rs * 16807 % 2147483647) / 2147483647;
    const hill = (sd, base, amp, col0, col1) => {
      const P = ridgePts(sd, base, amp, 0.5, 1, 64), n = P.length - 1, step = LW / n;
      const g = ctx.createLinearGradient(0, base - amp, 0, BASE); g.addColorStop(0, col0); g.addColorStop(1, col1);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(P[0][0], BASE);
      P.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(P[n][0], BASE); ctx.closePath(); ctx.fill();
      return x => { const f = (x + EXT) / step, i = Math.max(0, Math.min(n - 1, Math.floor(f))); return lerp(P[i][1], P[i + 1][1], f - i); };
    };
    const canopy = (yAt, col, shade, lit, rMin, rMax, bump, so) => {      // fileira de copas arredondadas de tamanhos e alturas variados
      const blobs = [];
      for (let x = -EXT; x < WORLD + EXT;) {
        const r = rMin + (rMax - rMin) * (0.5 * nz(x * 0.04 + so) + 0.5 * rnd());
        blobs.push({ x, y: yAt(x) - r * 0.4 - bump * nz(x * 0.09 + so + 5), r });
        x += r * (0.85 + rnd() * 0.6);
      }
      blobs.forEach(b => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); });
      blobs.forEach(b => {                                                                  // cada copa: sombra embaixo/esquerda e luz em cima/direita (recortado na própria copa)
        ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.clip();
        let g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y + b.r * 0.5, 0, b.x - b.r * 0.3, b.y + b.r * 0.5, b.r * 1.1);
        g.addColorStop(0, shade); g.addColorStop(1, shade.replace(/[\d.]+\)$/, "0)"));
        ctx.fillStyle = g; ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
        g = ctx.createRadialGradient(b.x + b.r * 0.35, b.y - b.r * 0.45, 0, b.x + b.r * 0.35, b.y - b.r * 0.45, b.r * 0.8);
        g.addColorStop(0, lit); g.addColorStop(1, lit.replace(/[\d.]+\)$/, "0)"));
        ctx.fillStyle = g; ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
        ctx.restore();
      });
    };
    const pine = (x, y, h, col, litCol) => {                       // pinheiro macio (poucos, só para quebrar a linha das copas)
      const w = h * 0.4;
      ctx.fillStyle = col; ctx.fillRect(x - 0.8, y - 2, 1.6, 3);
      for (let t = 0; t < 3; t++) {
        const ty = y - h + t * h * 0.27, hw = w * (0.5 + 0.28 * t), by = ty + h * 0.45;
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, ty); ctx.quadraticCurveTo(x + hw * 0.5, by - (by - ty) * 0.35, x + hw, by);
        ctx.lineTo(x - hw, by); ctx.quadraticCurveTo(x - hw * 0.5, by - (by - ty) * 0.35, x, ty); ctx.fill();
        ctx.fillStyle = litCol; ctx.beginPath(); ctx.moveTo(x, ty); ctx.quadraticCurveTo(x + hw * 0.5, by - (by - ty) * 0.35, x + hw, by); ctx.lineTo(x + hw * 0.25, by); ctx.closePath(); ctx.fill();
      }
    };
    const back = hill(seed, 126, 4, "#6a3d7a", "#6a3d7a");
    canopy(back, "#6a3d7a", "rgba(70,38,100,.35)", "rgba(240,150,155,.55)", 3, 5, 3, 0);
    for (let x = -EXT + 10; x < WORLD + EXT; x += 45 + rnd() * 60) pine(x, back(x) + 1, 8 + rnd() * 4, "#5e3672", "rgba(232,142,156,.4)");
    const front = hill(seed + 5, 130, 3, "#4d2c6c", "#4d2c6c");
    canopy(front, "#4d2c6c", "rgba(32,16,56,.45)", "rgba(214,120,148,.5)", 3.5, 6, 2, 40);
  });
}
// ---------- Gaivotas ao longe: só de vez em quando passa um bando pequeno (1 a 3), pequenas, de asas quase retas ----------
function drawLakeGlints(now, sx) {          // brilho do sol cintilando no lago distante (some e volta devagar)
  const t = now / 1000;
  for (let i = 0; i < 14; i++) {
    const y = HZ + 1 + i * 1.6, w = 5 + i * 3.2, a = Math.max(0, (0.45 + 0.3 * Math.sin(t * 1.3 + i * 1.7)) * (1 - i * 0.04)), j = Math.sin(t * 0.7 + i) * 2;
    rect(`rgba(255,232,178,${a})`, sx - w / 2 + j, y, w * 0.42, 0.9);
    rect(`rgba(255,232,178,${a})`, sx + w * 0.08 + j, y, w * 0.42, 0.9);
  }
}
function drawGulls(now) {
  const t = now / 1000, P = 70, CROSS = 30, k = Math.floor(t / P), u0 = (t - k * P) / CROSS;   // a cada 70s sorteia se passa um bando; atravessa a tela em ~30s
  if (u0 > 1.2) return;
  let r = k * 7919 + 13; const rnd = () => (r = r * 16807 % 2147483647) / 2147483647; rnd(); rnd();
  if (rnd() > 0.6) return;                                                   // ~40% das vezes não passa ninguém
  const n = 1 + (rnd() * 3 | 0), dir = rnd() < 0.5 ? -1 : 1, y0 = 40 + rnd() * 55, off = camX * 0.08;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let i = 0; i < n; i++) {
    const ph = rnd() * 6.28, fr = 4.2 + rnd() * 1.4, s = 2 + rnd() * 0.7, dy = (rnd() - 0.5) * 12, u = u0 - i * 0.03;
    if (u < 0 || u > 1) continue;
    const x = (dir > 0 ? -20 + (W + 40) * u : W + 20 - (W + 40) * u) + off;
    const y = y0 + dy + Math.sin(t * 0.5 + ph) * 2 - (u - 0.5) * 6;
    const glide = Math.sin(t * 0.3 + ph * 2) > 0.3 ? 0.1 : 1, f = Math.sin(t * fr + ph) * glide;   // de vez em quando só planam
    const ex = s * 0.95, ey = y - s * 0.3 + f * s * 0.2, tx = s * 1.9, ty = y + s * 0.1 + f * s * 0.6;
    ctx.strokeStyle = "rgba(58,30,84,.8)"; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(x - tx, ty); ctx.lineTo(x - ex, ey); ctx.lineTo(x, y); ctx.lineTo(x + ex, ey); ctx.lineTo(x + tx, ty); ctx.stroke();
  }
}
// ---------- Neblina: faixas baixas e irregulares (nada de manchas redondas), na cor do pôr do sol, que derivam bem devagar ----------
function periodicNoise(seed, period) {                                  // ruído que "fecha" nas pontas, para a faixa poder emendar ao derivar
  let r = seed; const rnd = () => (r = r * 16807 % 2147483647) / 2147483647;
  const t = Array.from({ length: period }, rnd);
  return x => { const i = Math.floor(x), f = x - i, k = f * f * (3 - 2 * f); return t[((i % period) + period) % period] * (1 - k) + t[(((i + 1) % period) + period) % period] * k; };
}
const FOGS = [                                                          // y0/bh = posição e altura da faixa; str = força; sp = px/s (negativo = vai para a esquerda)
  { y0: 92,  bh: 40, str: 0.30, rgb: [255, 192, 164], seed: 5,  sc: 0.012, par: 0.31, sp: 4 },     // entre as montanhas de trás e as do meio
  { y0: 100, bh: 34, str: 0.34, rgb: [255, 196, 170], seed: 17, sc: 0.016, par: 0.44, sp: -5 },    // entre as do meio e as da frente
  { y0: HZ - 20, bh: 34, str: 0.50, rgb: [255, 208, 186], seed: 29, sc: 0.010, par: 0.75, sp: 2.5 },  // rente à margem e à água distante
];
function makeFog(f) {
  const w = Math.round(LW * S), h = Math.round(f.bh * S), period = Math.max(2, Math.round(LW * f.sc));
  const n1 = periodicNoise(f.seed, period), n2 = periodicNoise(f.seed + 9, period * 2);
  const im = new ImageData(w, h), d = im.data, sm = (a, b, v) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };
  for (let i = 0; i < w; i++) {
    const x = i * LW / w, m = clamp01((0.62 * n1(x * f.sc) + 0.38 * n2(x * f.sc * 2) - 0.22) * 1.9);   // trechos mais densos e trechos quase limpos
    for (let j = 0; j < h; j++) {
      const v = j / (h - 1), a = f.str * sm(0, 0.62, v) * (1 - sm(0.72, 1, v)) * (0.15 + 0.85 * m), p = (j * w + i) * 4;
      d[p] = f.rgb[0]; d[p + 1] = f.rgb[1]; d[p + 2] = f.rgb[2]; d[p + 3] = a * 255;
    }
  }
  const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").putImageData(im, 0, 0); return c;
}
function drawFog(i, now, ox) {
  const f = FOGS[i], x0 = ox + camX * f.par - EXT, d = ((now / 1000 * f.sp) % LW + LW) % LW;
  ctx.drawImage(layers.fogs[i], x0 + d - LW, f.y0, LW, f.bh);
  ctx.drawImage(layers.fogs[i], x0 + d, f.y0, LW, f.bh);
}
function buildLayers(now) {
  // todas as camadas usam coordenadas do mundo (0..480) e têm EXT px de sobra de cada lado
  const sky = layer(() => {
    ctx.translate(EXT, 0);
    let g = ctx.createLinearGradient(0, 0, 0, PIER_Y + 8);
    g.addColorStop(0, "#241a45"); g.addColorStop(0.45, "#b83f6a"); g.addColorStop(0.8, "#f4a261"); g.addColorStop(1, "#ffe0a8");
    ctx.fillStyle = g; ctx.fillRect(-EXT, 0, LW, PIER_Y + 8);
    g = ctx.createRadialGradient(370, 62, 4, 370, 62, 80);
    g.addColorStop(0, "#fffbe6"); g.addColorStop(0.2, "#ffe9a8"); g.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = g; ctx.fillRect(270, 0, 210, PIER_Y);
  });
  const far = mountains({ seed: 5, base: 120, amp: 64, f: 0.011, sharp: 1.0, skew: 0.55, k: 0.16, fd: 55, shA: 0.75, ltA: 0.55,
    top: "#8a4684", bot: "#d27088", shadow: "#5e3274", lit: "#ffb88a", mist: 0.5, mistH: 62 });
  const mid = mountains({ seed: 23, base: 125, amp: 46, f: 0.017, sharp: 1.0, skew: 0.5, k: 0.18, fd: 45, shA: 0.8, ltA: 0.55,
    top: "#6a3a78", bot: "#b4587f", shadow: "#46285f", lit: "#f0907f", mist: 0.38, mistH: 52 });
  const near = mountains({ seed: 71, base: 129, amp: 32, f: 0.026, sharp: 1.0, skew: 0.45, k: 0.2, fd: 36, shA: 0.85, ltA: 0.5,
    top: "#46285f", bot: "#7c4079", shadow: "#2c1a48", lit: "#c8658a", mist: 0.22, mistH: 38 });
  const hills = pineHills(9);
  const lake = layer(() => {                                          // lago distante entre a margem e o cais
    ctx.translate(EXT, 0);
    let g = ctx.createLinearGradient(0, HZ, 0, WATER_Y);
    g.addColorStop(0, "#e9a69c"); g.addColorStop(0.4, "#c98ba2"); g.addColorStop(1, "#a8808f");
    ctx.fillStyle = g; ctx.fillRect(-EXT, HZ, LW, WATER_Y - HZ);
    g = ctx.createLinearGradient(0, HZ, 0, HZ + 13);                  // reflexo escuro da mata na água
    g.addColorStop(0, "rgba(70,36,100,.6)"); g.addColorStop(1, "rgba(70,36,100,0)");
    ctx.fillStyle = g; ctx.fillRect(-EXT, HZ, LW, 13);
    g = ctx.createLinearGradient(0, HZ - 8, 0, HZ);                   // neblina rente à margem: afasta a mata
    g.addColorStop(0, "rgba(255,200,170,0)"); g.addColorStop(1, "rgba(255,200,170,.38)");
    ctx.fillStyle = g; ctx.fillRect(-EXT, HZ - 8, LW, 8);
    let rr = 77; const rn = () => (rr = rr * 16807 % 2147483647) / 2147483647;     // marolas finas: mais curtas e juntas ao longe, maiores perto
    for (let i = 0; i < 70; i++) {
      const k = rn(), y = HZ + 3 + k * (WATER_Y - HZ - 5), len = 6 + k * 34 + rn() * 12, x = -EXT + rn() * LW;
      rect(`rgba(255,226,196,${0.1 + 0.14 * k})`, x, y, len, 0.8);
      if (rn() < 0.5) rect(`rgba(70,36,100,${0.08 + 0.1 * k})`, x + len * 0.3, y + 1.6, len * 0.7, 0.8);
    }
  });
  const deck = layer(() => {
    ctx.translate(EXT, 0);
    rect("#1a1230", -EXT, PIER_Y + 8, LW, WATER_Y - PIER_Y - 8);
    rect("#6b4226", -EXT, PIER_Y, LW, 8); rect("#a06f42", -EXT, PIER_Y, LW, 3); rect("#4a2d19", -EXT, PIER_Y + 6, LW, 2);
    for (let i = -EXT; i < WORLD + EXT; i += 24) rect("rgba(0,0,0,.35)", i, PIER_Y, 0.8, 6);
  });
  const posts = layer(() => {
    ctx.translate(EXT, 0);
    for (let i = 6 - 48 * 4; i < WORLD + EXT; i += 48) { rect("#3b2314", i, PIER_Y + 8, 8, 32); rect("#5a3b22", i + 1, PIER_Y + 8, 2.5, 32); }
  });
  const water = layer(() => {
    const g = ctx.createLinearGradient(0, WATER_Y, 0, H);
    g.addColorStop(0, "#a8808f"); g.addColorStop(0.12, "#63869f"); g.addColorStop(0.45, "#2a6089"); g.addColorStop(1, "#0b2a45");
    ctx.fillStyle = g; ctx.fillRect(0, WATER_Y, W, H - WATER_Y);
  }, W, H);
  // cada nuvem guarda a forma atual (a) e a próxima (b); o desenho faz a transição entre as duas bem devagar
  const clouds = CLOUDS.map(c => {
    const n = Math.floor((now / 1000 + c.seed * 3.7) / c.m);
    return { n, a: makeCloud(c.w, c.h, c.seed + n * 101, c.tone), b: makeCloud(c.w, c.h, c.seed + (n + 1) * 101, c.tone) };
  });
  layers = { sky, far, mid, near, hills, lake, deck, posts, water, clouds, fogs: FOGS.map(makeFog) };
}

// ---------- Parallax: cada camada acompanha a câmera numa fração diferente (0 = parada no fundo, 1 = mesma do cais) ----------
const PAR = { sky: 0.04, cloud: 0.12, far: 0.25, mid: 0.37, near: 0.5, hills: 0.75, lake: 0.75, pier: 1 };
const rctx = refl.getContext("2d");

function reflect() {                       // copia o que está acima da água para o canvas do reflexo
  rctx.setTransform(1, 0, 0, 1, 0, 0);
  rctx.clearRect(0, 0, refl.width, refl.height);
  rctx.drawImage(buf, 0, (WATER_Y - RD) * S, W * S, RD * S, 0, 0, W * S, RD * S);
}
function drawReflection(now) {             // desenha o reflexo espelhado, em faixas que ondulam (mais forte longe da margem)
  const rh = 1;
  for (let r = 0; r < RD; r += rh) {
    const k = r / RD;
    const off = Math.sin(r / 5 + now / 900) * (0.3 + k * 1.6) + Math.sin(r / 2.6 - now / 650) * 0.35;
    ctx.globalAlpha = 0.6 * (1 - k * 0.8);
    ctx.drawImage(refl, 0, (RD - r - rh) * S, W * S, rh * S, off - 4, WATER_Y + r, W + 8, rh);
  }
  ctx.globalAlpha = 1;
}

// ---------- Ondas: cristas horizontais em perspectiva, iluminadas pelo sol (grade pequena, suavizada ao desenhar) ----------
// As cristas só ondulam de lado e "respiram" no lugar: nada escorre para cima nem para baixo.
const WV = { cw: 2, ch: 2, cols: 0, rows: 0, cv: null, c: null, im: null, q: null, m: null, dq: null };
const WA = [1, 0.7, 0.45], WK = [40, 62, 88], WQ = [1.8, 1.4, 1.1], WKX = [0.018, 0.035, 0.06], WT = [-0.5, 0.7, -0.9], WPH = [0, 1.3, 2.1];
function waveSetup() {
  WV.cols = Math.ceil(W / WV.cw) + 1; WV.rows = Math.ceil((H - WATER_Y) / WV.ch);
  WV.cv = document.createElement("canvas"); WV.cv.width = WV.cols; WV.cv.height = WV.rows;
  WV.c = WV.cv.getContext("2d"); WV.im = WV.c.createImageData(WV.cols, WV.rows);
  WV.q = new Float32Array(WV.cols * 3); WV.m = new Float32Array(WV.cols * 3); WV.dq = new Float32Array(WV.cols * 3);
}
function drawWaves(now, ox) {
  if (WV.cols !== Math.ceil(W / WV.cw) + 1) waveSetup();
  const t = now / 1000, sunX = ox + camX * PAR.sky + 366, d = WV.im.data, cols = WV.cols, rows = WV.rows, HT = rows * WV.ch;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const bob = [0.35 * Math.sin(t * 0.8), 0.4 * Math.sin(t * 1.1), 0.5 * Math.sin(t * 1.5 + 1)];
  for (let i = 0; i < cols; i++) {                                         // partes que dependem só da coluna (uma vez por quadro)
    const xw = i * WV.cw - camX * 0.7;
    for (let k = 0; k < 3; k++) {
      const arg = WKX[k] * xw + WT[k] * t + WPH[k];
      WV.q[i * 3 + k] = WQ[k] * Math.sin(arg); WV.dq[i * 3 + k] = WQ[k] * WKX[k] * Math.cos(arg);
      WV.m[i * 3 + k] = WA[k] * (0.7 + 0.3 * Math.sin(xw * 0.013 + k * 2.1 + t * 0.2));
    }
  }
  for (let j = 0; j < rows; j++) {
    const s = j / (rows - 1), WB = 0.6, v = Math.log((WB + s) / WB), vp = 1 / (WB + s), amp = 0.35 + 0.65 * s;   // perspectiva: cristas mais juntas ao longe
    const width = 20 + 80 * s;                                             // a trilha do sol alarga perto de quem olha
    for (let i = 0; i < cols; i++) {
      let h = 0, sy = 0, sx = 0;
      for (let k = 0; k < 3; k++) {
        const a = WV.m[i * 3 + k] * amp, p = WK[k] * v + WV.q[i * 3 + k] + bob[k] + k * 1.7, cs = Math.cos(p);
        h += a * Math.sin(p); sy += a * cs * WK[k] * vp / HT * 2.4; sx += a * cs * WV.dq[i * 3 + k];
      }
      const shade = cl(-sy * 0.3 + h * 0.06, -0.5, 0.5);                    // faces viradas ao sol clareiam, as outras escurecem
      const dx = (i * WV.cw - sunX) / width, mask = Math.exp(-dx * dx);     // trilha do sol
      const g = Math.pow(cl((-sy + 0.25 * sx - 0.5) * 1.8, 0, 1), 1.4) * mask * (1 - 0.4 * s);   // só as ondas inclinadas para o sol cintilam
      const aL = Math.min(1, Math.max(shade, 0) * 0.5 + mask * 0.08 * (1 - 0.5 * s) + g);
      const aD = Math.max(-shade, 0) * 0.7 * (1 - aL);
      const kk = g / (aL + 1e-3), a = aL + aD, o = (j * cols + i) * 4;
      const Lg = 205 + 33 * kk, Lb = 150 + 40 * kk;                        // luz quente -> branco-dourado nos pontos fortes
      d[o] = a > 0 ? (255 * aL + 6 * aD) / a : 0; d[o + 1] = a > 0 ? (Lg * aL + 24 * aD) / a : 0; d[o + 2] = a > 0 ? (Lb * aL + 44 * aD) / a : 0;
      d[o + 3] = a * 255;
    }
  }
  WV.c.putImageData(WV.im, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(WV.cv, 0, WATER_Y, cols * WV.cw, rows * WV.ch);
}

// ---------- Água batendo nos postes: no pé de cada poste a própria água sobe só um pouquinho e desce ----------
// A faixa que cobre o poste é copiada da água logo abaixo dele (mesma cor, ondas e brilho), então a água "vai junto";
// uma linha clara fina na borda de cima dá o contraste.
function postWaves(now, wxp) {
  const t = now / 1000, BOTTOM = PIER_Y + 8 + 32;                       // base dos postes (onde encostam na água)
  for (let i = 6 - 48 * 4; i < WORLD + EXT; i += 48) {
    const x0 = Math.max(0, wxp + i), x1 = Math.min(W, wxp + i + 8);
    if (x1 - x0 < 1) continue;
    const ph = i * 0.37;
    const h = Math.max(0.6, 1.3 + 1.0 * Math.sin(t * 1.6 + ph) + 0.6 * Math.sin(t * 2.7 + ph * 1.7));   // quanto a água sobe no poste (0 a ~3px)
    rect("rgba(0,0,0,.18)", x0, BOTTOM - 4, x1 - x0, 4 - h + 0.01);              // madeira úmida logo acima da água
    ctx.globalAlpha = 0.93;
    ctx.drawImage(buf, x0 * S, (BOTTOM + 1) * S, (x1 - x0) * S, h * S, x0, BOTTOM - h, x1 - x0, h);   // água de verdade cobrindo o pé do poste
    ctx.globalAlpha = 1;
    rect(`rgba(225,240,250,${0.3 + 0.12 * h})`, x0, BOTTOM - h, x1 - x0, 0.9);   // borda de cima mais clara (contraste)
  }
}

function draw(now) {
  if (!layers) buildLayers(now);
  const ox = (W - WORLD) / 2, wx = ox + camX;              // wx = deslocamento do mundo na tela
  const lx = f => ox + camX * f - EXT;                     // posição de uma camada com fator de parallax f

  // 1) acima da água: céu, nuvens, montanhas, cais e pescadores
  ctx.drawImage(layers.sky, lx(PAR.sky), 0, LW, H);
  CLOUDS.forEach((c, i) => {
    const cl = layers.clouds[i], u = (now / 1000 + c.seed * 3.7) / c.m, n = Math.floor(u), f = u - n;
    if (n !== cl.n) {                                                       // chegou a hora: a "próxima forma" vira a atual e sorteia outra
      cl.a = n === cl.n + 1 ? cl.b : makeCloud(c.w, c.h, c.seed + n * 101, c.tone);
      cl.b = makeCloud(c.w, c.h, c.seed + (n + 1) * 101, c.tone); cl.n = n;
    }
    const e = f * f * (3 - 2 * f), x = (c.x + now / 1000 * c.v) % (LW + c.w) - c.w + lx(c.back ? PAR.sky + 0.03 : PAR.cloud);
    const k = c.back ? 0.8 : 1;                                              // nuvem de longe é mais apagada
    ctx.globalAlpha = (1 - e) * k; ctx.drawImage(cl.a, x, c.y, c.w, c.h);    // uma forma some devagar...
    ctx.globalAlpha = e * k;       ctx.drawImage(cl.b, x, c.y, c.w, c.h);    // ...enquanto a outra aparece
    ctx.globalAlpha = 1;
  });
  drawGulls(now);                                          // gaivotas bem ao fundo, atrás das montanhas
  ctx.drawImage(layers.far, lx(PAR.far), 0, LW, H);
  drawFog(0, now, ox);
  ctx.drawImage(layers.mid, lx(PAR.mid), 0, LW, H);
  drawFog(1, now, ox);
  ctx.drawImage(layers.near, lx(PAR.near), 0, LW, H);
  ctx.drawImage(layers.hills, lx(PAR.hills), 0, LW, H);
  ctx.drawImage(layers.lake, lx(PAR.lake), 0, LW, H);
  drawFog(2, now, ox);
  drawLakeGlints(now, ox + camX * PAR.sky + 366);
  ctx.drawImage(layers.deck, lx(PAR.pier), 0, LW, H);
  ctx.save(); ctx.translate(wx, 0);
  Object.values(others).forEach(o => drawOther(o, now));
  const tip = drawFisher(px, dir, "#c0392b", "#d98e04", walkAmp, state === "cast" ? castPose(cs.t) : state === "reel" ? reelPose(now) : null);
  ctx.restore();

  // 2) água com reflexo
  reflect();
  ctx.drawImage(layers.water, 0, 0, W, H);
  drawReflection(now);
  drawWaves(now, ox);                                      // ondas, sombras e o brilho do sol na água
  ctx.drawImage(layers.posts, lx(PAR.pier), 0, LW, H);
  postWaves(now, ox + camX);

  // 3) linhas, boias e nomes por cima
  ctx.save(); ctx.translate(wx, 0);
  Object.values(others).forEach(o => drawOtherLine(o, now));
  text(myName, px, PIER_Y - 46, "#ffd166", "center");
  drawFx(now);
  if (state === "cast") drawCast(tip, cs, bobber.x);
  else if (state === "wait" || state === "bite" || state === "reel") drawLine(tip.x, tip.y, bobber.x, now, state);
  ctx.restore();

  if (zk > 0.003) zoomView(1 + 0.45 * zk, wx + px, PIER_Y - 6, 0.3);   // aproxima no pescador enquanto puxa o peixe (a interface abaixo não é ampliada)

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
  const hint = { walk: "← → mover   ESPAÇO lançar", cast: "Lançando...", wait: "Aguarde a fisgada...", bite: "ESPAÇO agora!", reel: "Segure ESPAÇO para subir a barra" }[state];
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
