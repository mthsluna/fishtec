// ---------- Fonte do jogo: DigitalDisco (assets/fonts/DigitalDisco.ttf). Só o celular continua com a fonte do Nokia ----------
const UI_FONT = '"DigitalDisco", ui-monospace, monospace', UI_PX = 11;     // UI_PX: tamanho do texto no canvas (a fonte é de pixel: 1/16 do tamanho = 1 "pixel" da letra)
const UI_CH = Math.ceil(UI_PX * 576 / 1024 * 10) / 10;                    // largura de uma letra larga (usada para dimensionar a caixa de fala)
(() => {
  const st = document.createElement("style");
  st.textContent = '@font-face{font-family:"DigitalDisco";src:url("assets/fonts/DigitalDisco.ttf") format("truetype");font-display:block}';
  document.head.appendChild(st);
  if (document.fonts) document.fonts.load("16px DigitalDisco").catch(() => {});
})();
const cv = document.getElementById("g");
const WORLD = 480, H = 270;              // WORLD = área jogável (igual ao servidor); a tela pode ser mais larga
const EXT = 280, LW = WORLD + EXT * 2;   // margem extra das camadas de fundo (para o parallax e telas largas)
const RD = 90;                           // altura (px lógicos) do reflexo na água
let W = WORLD;                           // largura visível (ajusta sozinha ao formato da janela)
let S = 2;                               // resolução interna (baixa sozinha se o jogo ficar pesado)
let ctx, layers = null;
const refl = document.createElement("canvas");
const viewW = () => Math.max(WORLD, Math.min(WORLD + 240, Math.round(H * innerWidth / innerHeight)));

// ---------- Estilo Obra Dinn colorido (dithering Bayer 8x8) ----------
const LEVELS = 6;                        // níveis por canal: 2 = bem radical (8 cores), 4 = estilo Obra Dinn clássico, 6 = profissional (216 cores), 8 = quase sem dithering visível
const STEP = 255 / (LEVELS - 1);
const NIGHT_LIFT = 0.12;                // clareia as sombras à noite ANTES do dithering (0 = igual a antes, 0.5 = bem mais claro). A paleta continua a mesma de 4 níveis
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
let DITHER_CELL = 1;
let glTex, liftLoc, texelLoc, cellLoc, stepsLoc;
if (gl) {
  const VS = "attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}";
  const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D t;uniform float steps;uniform float lift;uniform vec2 texel;uniform float cell;varying vec2 uv;
float b2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
float b8(vec2 a){return (b2(a*.25)*.25+b2(a*.5))*.25+b2(a);}
void main(){
  vec3 c0=texture2D(t,uv).rgb;
  vec3 bl=(texture2D(t,uv+vec2(texel.x,0.)).rgb+texture2D(t,uv-vec2(texel.x,0.)).rgb+texture2D(t,uv+vec2(0.,texel.y)).rgb+texture2D(t,uv-vec2(0.,texel.y)).rgb)*.25;
  c0=clamp(c0+(c0-bl)*.45,0.,1.);                       // nitidez leve: bordas mais limpas depois da ampliação
  vec3 c=pow(c0,vec3(lift))*255.;
  float st=255./(steps-1.);
  float th=(b8(mod(floor(gl_FragCoord.xy/cell),8.))-.47)*st;
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  stepsLoc = gl.getUniformLocation(pg, "steps"); gl.uniform1f(stepsLoc, LEVELS);
  liftLoc = gl.getUniformLocation(pg, "lift");
  texelLoc = gl.getUniformLocation(pg, "texel"); cellLoc = gl.getUniformLocation(pg, "cell");
}

function setScale(s) {
  S = s; layers = null; W = viewW();
  buf.width = W * S; buf.height = H * S;
  refl.width = W * S; refl.height = Math.ceil(RD * S * 2.3);   // altura extra: com zoom o reflexo ocupa mais pixels
  const cssW = Math.min(innerWidth, innerHeight * W / H), cssH = cssW * H / W;   // preenche a tela, sem barras laterais
  cv.style.width = cssW + "px"; cv.style.height = cssH + "px";
  if (gl) {                                                           // saída na resolução real do monitor (até 2x e no máximo 2560 px): dithering nítido, sem moiré
    const dpr = Math.min(window.devicePixelRatio || 1, 2), k = Math.min(dpr, 2560 / cssW);
    cv.width = Math.max(1, Math.round(cssW * k)); cv.height = Math.max(1, Math.round(cssH * k));
    DITHER_CELL = Math.max(1, Math.round(k));                         // tamanho de cada "pixel" do padrão de dithering
  } else { cv.width = buf.width; cv.height = buf.height; }           // sem WebGL: dithering na CPU, no tamanho do buffer
  ctx = buf.getContext("2d", gl ? {} : { willReadFrequently: true });
  ctx.scale(S, S);
}
setScale(2);
addEventListener("resize", () => setScale(S));

// Fallback (CPU): tabela pronta, sem contas por pixel
const LUT = new Uint8Array(64 * 256);
let lutLift = -1;
function buildLUT(lift) {                              // lift < 1 clareia as sombras antes de quantizar (ver NIGHT_LIFT)
  lutLift = lift;
  for (let t = 0; t < 64; t++) for (let v = 0; v < 256; v++) {
    const l = Math.pow(v / 255, lift) * 255;
    LUT[(t << 8) | v] = Math.max(0, Math.min(255, Math.round((l + (BAYER[t] / 64 - 0.47) * STEP) / STEP) * STEP));
  }
}
const nightLift = () => 1 - NIGHT_LIFT * Math.max(0, Math.min(1, DAY.starA));   // 1 de dia, até 1-NIGHT_LIFT com o céu estrelado
function dither() {
  const lf = Math.round(nightLift() * 50) / 50; if (lf !== lutLift) buildLUT(lf);
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
  gl.uniform1f(liftLoc, nightLift());
  gl.uniform1f(stepsLoc, LEVELS);
  gl.uniform2f(texelLoc, 1 / buf.width, 1 / buf.height); gl.uniform1f(cellLoc, DITHER_CELL);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
const API = window.API_URL;
const PIER_Y = 150, WATER_Y = 168;
const HZ = 132;                                  // linha do horizonte: montanhas e mata acabam aqui; daqui até o cais é o lago distante
const BOB_Y = WATER_Y + 22;                       // a boia fica mais longe do cais, em água aberta
// o cais ACABA em DECK_END (x do mundo); o pescador anda até PX_MAX, um pouco antes da ponta, e não passa dali
const DECK_END = 600, PX_MAX = 584, CAM_K = 0.12;   // o cais acaba em 600 e o pescador anda até 584; depois do x=440 a câmera acompanha de perto para a ponta do cais aparecer na tela
const CAM_FAR = 380, CAM_EXTRA = 110;   // a partir de CAM_FAR a câmera vai abrindo em curva suave (até CAM_EXTRA px a mais na ponta do cais), sem tranco
const CITY = { on: false, MAX: 1900 };                                  // cidade (cenário extra): MAX = até onde o pescador anda nela
const TR = { ph: "none", t: 0, to: "city", lock: false, edge: 0 };      // transição: none | out (escurece) | hold (preto, troca o cenário) | in (clareia)
const pxMax = () => CITY.on ? CITY.MAX : PX_MAX;
// afasta a boia dos postes de madeira (um poste a cada 48px)
const clearOfPosts = x => {
  x = Math.max(16, Math.min(pxMax() + 8, x));
  const m = ((x - 6) % 48 + 48) % 48;
  return m < 14 ? x + 14 - m : m > 42 ? x + 48 - m + 14 : x;
};

// Peixes (se o servidor estiver fora, usa a lista local)
let fishList = [
  { id: "piranha-vermelha", name: "Piranha vermelha", file: "piranha-vermelha.png", difficulty: 3, points: 40 },
  { id: "budiao-verde", name: "Budião verde", file: "budiao-verde.png", difficulty: 2, points: 20 },
  { id: "peixe-voador", name: "Peixe voador", file: "peixe-voador.png", difficulty: 4, points: 70 },
  { id: "peixe-bandeira", name: "Peixe bandeira", file: "peixe-bandeira.png", difficulty: 5, points: 120 },
  { id: "peixe-cofre", name: "Peixe cofre", file: "peixe-cofre.png", difficulty: 2, points: 25 },
  { id: "peixe-listrado", name: "Peixe listrado", file: "peixe-listrado.png", difficulty: 2, points: 25 },
  { id: "budiao-listrado", name: "Budião listrado", file: "budiao-listrado.png", difficulty: 2, points: 22 },
  { id: "peixe-zebra", name: "Peixe zebra", file: "peixe-zebra.png", difficulty: 3, points: 45 },
  { id: "garoupa-pintada", name: "Garoupa pintada", file: "garoupa-pintada.png", difficulty: 3, points: 50 },
  { id: "salmao", name: "Salmão", file: "salmao.png", difficulty: 3, points: 55 },
  { id: "peixe-tigre", name: "Peixe tigre", file: "peixe-tigre.png", difficulty: 4, points: 75 },
  { id: "garoupa-azul", name: "Garoupa azul", file: "garoupa-azul.png", difficulty: 4, points: 80 },
  { id: "peixe-dourado-dentuco", name: "Peixe dourado dentuço", file: "peixe-dourado-dentuco.png", difficulty: 4, points: 65 },
  { id: "lagosta", name: "Lagosta", file: "lagosta.png", difficulty: 5, points: 140 },
];
fetch(API + "/api/fish").then(r => r.json()).then(d => fishList = d.map(f => ({ ...f, name: String(f.name).replace(/-/g, " ") }))).catch(() => {});
const imgs = {};
const img = f => imgs[f] || (imgs[f] = Object.assign(new Image(), { src: "assets/fishes/" + f }));
fishList.forEach(f => img(f.file));
// ---------- Peixe misterioso: aparece no minigame no lugar do peixe de verdade (a revelação vem só depois de pescar) ----------
const MYST_SRC = ["assets/fishes/misterioso.png", "assets/misterioso.png"];   // ajuste aqui se o arquivo estiver em outro lugar/nome
const mystery = new Image(); let mystI = 0;
mystery.onerror = () => { if (++mystI < MYST_SRC.length) mystery.src = MYST_SRC[mystI]; };
mystery.src = MYST_SRC[0];
function drawMystery(cx, cy, mw, mh) {
  if (mystery.complete && mystery.naturalWidth) {
    const r = Math.min(mw / mystery.naturalWidth, mh / mystery.naturalHeight), w = mystery.naturalWidth * r, h = mystery.naturalHeight * r;
    ctx.drawImage(mystery, cx - w / 2, cy - h / 2, w, h);
  } else {                                                                      // se a imagem não carregar: peixinho azul com "?"
    ctx.fillStyle = "#f4f4f4"; ctx.strokeStyle = "#1f78c8"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(cx - mw * 0.06, cy, mw * 0.33, mh * 0.34, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + mw * 0.22, cy); ctx.lineTo(cx + mw * 0.46, cy - mh * 0.3); ctx.lineTo(cx + mw * 0.46, cy + mh * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
    text("?", cx - mw * 0.06, cy + 4, "#1f4f8f", "center");
  }
}

const post = (p, b) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }).then(r => r.json());

// Estado
let px = 240, dir = 1, state = "walk", t = 0, bobber = { x: 0, y: 0 };
let moving = false, walkAmp = 0;
let fish = null, msg = "", msgT = 0, bite = 0;
const bar = { y: 0, v: 0, h: 44 }, fp = { y: 0, target: 0, timer: 0 };
let prog = 0;
const TRACK = { get x() { return W - 60; }, y: 50, h: 170 };
let landT0 = 0;                                                          // quando a boia caiu na água (para o elástico)
let cs = { t: 0, rel: null, hang: null }; const fxs = [];            // arremesso em andamento e respingos
let gaitPh = 0, stepIdx = -1, reelT = 0;                       // controle dos sons de passo e de carretilha
const WALK = 90, RUN = 165;                       // velocidades (px/s): andar e correr (SHIFT)
let spd = 0, runK = 0, brake = 0, dustT = 0, wasBraking = false;   // velocidade atual, quanto está correndo (0-1), quanto está freando (0-1)
const dust = [];                                  // fumacinha da freada
const rodL = newRod(1);                           // a vara começa (e fica) nas costas; só é sacada para pescar
let wantDraw = false, vigK = 0;                    // wantDraw: quer lançar mas ainda está sacando a vara; vigK: vinheta
const STOW_T = 0.6, DRAW_T = 0.55;                // segundos para guardar nas costas / sacar de volta
let PAUSED = false;                               // menu de pausa (ESC) aberto: o jogo congela
let SHAKE_ON = true;                               // config: tremor da tela ligado?
try { SHAKE_ON = localStorage.getItem("shake") !== "0"; } catch (e) {}
let GSHAKE = 0;                                   // tremor leve do jogo (px): sobe nos eventos e decai sozinho
const kick = a => { if (SHAKE_ON) GSHAKE = Math.max(GSHAKE, a); };
let camX = 0;                                     // câmera: acompanha o pescador (base do parallax)
const keys = {};

// ---------- Multiplayer ----------
const others = {};
// Aparência (personalizável): camiseta, calça e altura. TW = meia largura do tronco (fino o bastante para a altura máxima não passar o Malto).
const TW = 5, AW = TW + 1.75;                                                    // AW: centro do braço de frente: colado na lateral do tronco (sem folga e sem esconder dentro dele)
const MALTO_TOP = 51, FISHER_TOP = 40, MAX_H = MALTO_TOP / FISHER_TOP;       // altura máxima = a do Malto (quepe a 51px do chão; o chapéu do pescador a 40px)
const hScale = h => 1 + (MAX_H - 1) * Math.max(0, Math.min(1, +h || 0));    // h: 0 (altura normal) ... 1 (altura do Malto)
const DEF_SHIRT = "#c0392b", DEF_PANTS = "#26384a";
const shade = (hex, f) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.substr(i, 2), 16) * f).toString(16).padStart(2, "0")).join("");
let LEGS = [shade(DEF_PANTS, 0.75), DEF_PANTS];                              // perna de trás (escura) e da frente
let myName = "";
const me = { shirt: DEF_SHIRT, pants: DEF_PANTS, h: 0 };                        // minha aparência (h: 0 a 1)
let ready = false;                                                              // só entra na sala depois da tela de personalizar
try { const sv = JSON.parse(localStorage.getItem("look") || "{}"); myName = String(sv.name || "").slice(0, 14);
  if (/^#[0-9a-f]{6}$/i.test(sv.shirt)) me.shirt = sv.shirt; if (/^#[0-9a-f]{6}$/i.test(sv.pants)) me.pants = sv.pants; me.h = Math.max(0, Math.min(1, +sv.h || 0)); } catch (e) {}
const lookPayload = () => ({ name: myName, shirt: me.shirt, pants: me.pants, h: +me.h.toFixed(3) });
// ---------- Relógio do jogo: o dia tem 30 min reais (1 min do jogo = 1,25 s) e todos veem a mesma hora ----------
// A hora vem do relógio do SERVIDOR: medimos a diferença (clockOff) entre ele e o do aparelho, compensando a latência.
const DAY_MS = 30 * 60 * 1000;
let clockOff = 0;                                                               // servidor - aparelho, em ms (0 = sem servidor: usa o relógio local)
const gameMinutes = () => (((Date.now() + clockOff) % DAY_MS) / DAY_MS) * 1440;   // 0 a 1440 (00:00 a 24:00)
function gameClock() {
  const m = Math.floor(gameMinutes()) % 1440;
  return String(m / 60 | 0).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}
const socket = typeof io !== "undefined" ? io(API, { transports: ["websocket"] }) : null;
if (socket) {
  const syncClock = () => {
    const t0 = Date.now();
    socket.timeout(4000).emit("time:sync", (err, serverNow) => {
      if (err || !(serverNow > 0)) return;
      const t1 = Date.now();
      clockOff = serverNow + (t1 - t0) / 2 - t1;                                // supõe que a ida e a volta levaram o mesmo tempo
    });
  };
  setInterval(() => { if (socket.connected) syncClock(); }, 60000);             // reajusta de minuto em minuto (corrige deriva)
  const add = p => others[p.id] = { ...p, tx: p.x };
  socket.on("connect", () => { syncClock(); if (ready) socket.emit("join", lookPayload()); });
  socket.on("players", list => { Object.keys(others).forEach(k => delete others[k]); list.forEach(p => p.id !== socket.id && add(p)); });
  socket.on("player:join", add);
  socket.on("player:look", d => { const o = others[d.id]; if (o) Object.assign(o, d); });
  socket.on("player:move", ({ x, ...rest }) => { const o = others[rest.id]; if (o) { Object.assign(o, rest); o.tx = x; } });
  socket.on("player:leave", id => delete others[id]);
}
let lastNet = 0, lastSt = "";
function net(now) {
  if (!socket || !socket.connected || CITY.on) return;
  if (now - lastNet < 66 && state === lastSt) return;            // 15x por segundo, ou na hora se o estado mudou
  lastNet = now; lastSt = state;
  socket.volatile.emit("move", { x: px, dir, state, bx: bobber.x });
}
function softShadow(x, y, rx, ry, a, maxY) {                       // sombra macia: centro mais escuro e bordas que somem (maxY: não passa da borda do deck)
  ctx.save();
  if (maxY !== undefined) { ctx.beginPath(); ctx.rect(x - rx - 2, y - ry - 2, rx * 2 + 4, maxY - (y - ry - 2)); ctx.clip(); }
  ctx.translate(x, y); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(20,8,36,${a})`); g.addColorStop(0.55, `rgba(20,8,36,${a * 0.6})`); g.addColorStop(1, "rgba(20,8,36,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill(); ctx.restore();
}
const REST = -0.846, POSE0 = { rod: REST, arm: 0, lean: 0, flex: 0 };   // pose parada da vara
// ---------- Vara: guardar nas costas / sacar (keyframes com spline, como numa animação de verdade) ----------
// R.k: 0 = na mão ... 1 = nas costas. Fases: preparação (agacha e recua de leve) -> a vara sobe e gira por cima do ombro
// -> pausa no alto -> desliza pelas costas -> a mão solta, o braço desce com sobra e a vara balança até assentar.
// Sacar é o caminho inverso, e no fim a vara "estala" na mão (balanço amortecido).
const RA = -2.55, SL0 = 0.55, SL1 = 0.85, RL = 33.1;      // RA: braço atrás do ombro; SL0/SL1: início/fim do deslize pelas costas; RL: comprimento da vara
const BKB = [-9, -5], BKT = [-3, -43];                     // base e ponta da vara guardada nas costas (diagonal)
const BKL = Math.hypot(BKT[0] - BKB[0], BKT[1] - BKB[1]), BUX = (BKT[0] - BKB[0]) / BKL, BUY = (BKT[1] - BKB[1]) / BKL, TB = Math.atan2(BUY, BUX);
const SHX = 0, SHY = -20.25;                                          // ombro de lado: no centro do tronco (antes ficava à frente, em x = 3)
// (a mão atrás do ombro, onde a vara é segurada para deslizar, depende do comprimento do braço: é calculada em drawFisherBase)
const K_REL = [[0, 0], [0.5, 0.72], [0.78, 1.06], [1, 1]];           // soltar o braço: arranca devagar, passa um pouquinho e assenta
const K_ARM  = [[0, 0], [0.14, 0.4], [0.42, -1.8], [0.55, RA]];
const K_ROD  = [[0, REST], [0.14, -0.5], [0.42, -1.45], [0.55, -2.0]];
const K_LEAN = [[0, 0], [0.14, 0.12], [0.4, -0.14], [0.6, -0.1], [0.85, 0.05], [1, 0]];
const K_BOB  = [[0, 0], [0.14, 0.9], [0.35, -0.4], [0.6, 0.25], [0.85, 0.55], [1, 0]];
const K_OFF  = [[0, 0], [0.14, 0.4], [0.4, -0.8], [0.6, -0.35], [1, 0]];
function spl(K, x) {                                       // interpolação cúbica (Hermite) com velocidade contínua e pontas paradas
  const n = K.length;
  if (x <= K[0][0]) return K[0][1];
  if (x >= K[n - 1][0]) return K[n - 1][1];
  let i = 0; while (x > K[i + 1][0]) i++;
  const x0 = K[i][0], x1 = K[i + 1][0], y0 = K[i][1], y1 = K[i + 1][1], h = x1 - x0, t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
  const m = j => j <= 0 || j >= n - 1 ? 0 : (K[j + 1][1] - K[j - 1][1]) / (K[j + 1][0] - K[j - 1][0]);
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m(i) * h + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m(i + 1) * h;
}
const ease3 = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
function newRod(k = 0) { return { k, v: 0, st: 9 }; }        // k: progresso, v: velocidade suavizada, st: tempo desde que parou
function stepRod(R, goal, dt) {
  const o = R.k;
  R.k += Math.sign(goal - R.k) * Math.min(Math.abs(goal - R.k), dt / (goal ? STOW_T : DRAW_T));
  const v = dt > 0 ? (R.k - o) / dt : 0;
  R.v += (v - R.v) * Math.min(1, dt * 18);
  if (v !== 0) R.st = 0; else R.st += dt;
}
function rodPose(R, b) {                                   // soma a animação da vara (corpo, braço livre, balanço) a uma pose base
  const k = R.k, wig = R.st < 1.4 ? Math.exp(-R.st * 4.2) * Math.sin(R.st * 21) : 0;
  return { ...b, run: b.run === undefined && k > 0.001 ? 0 : b.run, stow: k, sv: R.v, wig: k > 0.5 ? wig : 0,
    flex: (b.flex || 0) + (k < 0.02 ? wig * 0.7 : 0),
    lean: (b.lean || 0) + spl(K_LEAN, k), off: (b.off || 0) + spl(K_OFF, k), sb: spl(K_BOB, k) };
}
// ---------- Giro de lado -> de frente, parte por parte: primeiro a cabeça, depois o tronco, depois as pernas ----------
// Cada parte é desenhada como um cilindro girando em torno do eixo vertical: x_tela = profundidade*cos(a) + lateral*sen(a)
// (a = 0 é de lado, a = 90° é de frente). Os detalhes do rosto, do cinto e dos braços deslizam pela superfície enquanto giram.
// Altura de verdade: quem cresce são principalmente as PERNAS (LEGX); o tronco cresce só um pouco (TORSOX); cabeça, braços e chapéu
// mantêm o tamanho (só sobem). Nada é esticado: cada parte é desenhada já com o comprimento certo dentro de drawFisherBase/Turn.
const LEG_SHARE = 0.73;                                                         // fatia do ganho de altura que vai para as pernas (o resto vai para o tronco)
let LEGX = 0, TORSOX = 0, AL = 8;                                               // AL: comprimento do braço (cresce com a altura, junto com as pernas)
function collarFront(col) {                                                    // gola redonda de frente: barra escura em "U" em volta do pescoço
  ctx.fillStyle = shade(col, 0.76); roundPath(-2.7, -24.6, 5.4, 3.8, 1.7); ctx.fill();                 // barra (ribana)
  ctx.fillStyle = "#e0ac69"; roundPath(-1.8, -24.8, 3.6, 2.5, 1.2); ctx.fill();                    // pescoço aparecendo no decote
  rect("rgba(0,0,0,.12)", -1.8, -24.4, 3.6, 0.6);                                                  // sombrinha embaixo do queixo
}
function collarSide(col) {                                                     // gola redonda de lado: barra fina em volta da base do pescoço
  ctx.fillStyle = shade(col, 0.76); roundPath(-3.2, -24.3, 5, 1.8, 0.8); ctx.fill();
}
function shoulder(sx, y, col) {                                                 // ombrinho: capa arredondada por cima da junta do braço (some o "degrau" no canto do tronco)
  ctx.fillStyle = col; roundPath(sx - 1.8, y - 2.5, 3.6, 4.6, 1.4); ctx.fill();   // mesma largura do braço e topo na linha do ombro: sem "calombo"
  rect("rgba(255,255,255,.22)", sx - 1, y - 2.1, 2, 0.7);                        // luz em cima
}
function drawFisher(x, dir, shirt, hat, amp = 0, pose = null, look = null) {
  const E = ((look && look.hs || 1) - 1) * FISHER_TOP, pants = look && /^#[0-9a-f]{6}$/i.test(look.pants) ? look.pants : DEF_PANTS;
  LEGS = [shade(pants, 0.75), pants]; LEGX = E * LEG_SHARE; TORSOX = E - LEGX; AL = 8 + TORSOX;
  const tn = pose && pose.turn, sum = tn ? tn[0] + tn[1] + tn[2] : 0;
  return tn && sum > 0.001 && sum < 2.999 ? drawFisherTurn(x, dir, shirt, hat, tn) : drawFisherBase(x, dir, shirt, hat, amp, pose);
}
function drawFisherTurn(x, dir, shirt, hat, tn) {
  const sleeve = shade(shirt, 0.84);                                                   // manga: mais escura que o tronco, o braço não some nele
  const ang = v => v * v * (3 - 2 * v) * Math.PI / 2, mix = (a, b, k) => a + (b - a) * k;
  const ah = ang(tn[0]), at = ang(tn[1]), al = ang(tn[2]);
  const ch = Math.cos(ah), sh = Math.sin(ah), ct = Math.cos(at), st = Math.sin(at), cl = Math.cos(al), sl = Math.sin(al);
  const kt = at / (Math.PI / 2), avg = (tn[0] + tn[1] + tn[2]) / 3;
  ctx.save(); ctx.translate(x, PIER_Y); ctx.scale(dir, 1);
  softShadow(-7 * dir, 1.4, 17, 2.6, 0.34, 3); softShadow(0, 1.1, 8, 1.7, 0.5, 3);
  ctx.translate(0, Math.sin(performance.now() / 600) * 0.3 * avg);                   // respira (igual ao parado de frente)
  // vara nas costas (atrás de tudo): a ponta de baixo e a de cima giram junto com o tronco
  ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
  const UP = LEGX + TORSOX;
  ctx.beginPath(); ctx.moveTo(-9 * ct - 4 * st, mix(-5, -14, st) - UP); ctx.lineTo(-3 * ct + 4.5 * st, mix(-43, -44, st) - UP); ctx.stroke();
  // pernas (a de trás escura, a da frente clara)
  const leg = (wl, col) => {
    const cx = wl * sl, hw = Math.hypot(2.3 * cl, 2 * sl), sx = Math.hypot(3.3 * cl, 2.5 * sl);
    rect(col, cx - hw, -11 - LEGX, hw * 2, 9 + LEGX); rect("#15110e", cx + 0.3 * cl - sx, -2.5, sx * 2, 2.5);
  };
  leg(-2.6, LEGS[0]); leg(2.6, LEGS[1]);
  ctx.translate(0, -UP);                                                              // tudo de cima sobe
  // braço de longe (atrás do tronco; só aparece de fora quando já está bem de frente)
  const arm = (sx, y, a, alpha) => {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(sx, y); ctx.rotate(a);
    rect(sleeve, 0, -1.75, AL, 3.5); rect("rgba(0,0,0,.2)", 0, 1.25, AL, 0.8); rect("#f1c27d", AL - 0.5, -1.75, 3, 3.5);
    ctx.restore();
  };
  const farX = AW * st, farA = mix(1.4, 1.45, st), farY = mix(-22, -21.5, st);
  arm(farX, farY, farA, 1); shoulder(farX, farY, sleeve);
  // tronco
  rect(shirt, -TW, -24, TW * 2, 14 + TORSOX);
  rect("rgba(0,0,0,.25)", -TW, -24, mix(3.5, 2.5, kt), 14 + TORSOX); rect("rgba(255,255,255,.18)", mix(TW - 3, TW - 2.5, kt), -24, mix(2, 2.5, kt), 14 + TORSOX);
  if (st > 0.3) rect(`rgba(0,0,0,${0.5 * st * ct})`, TW * ct - 0.3, -24, 0.6, 12 + TORSOX);        // costura da frente deslizando para o meio
  rect("#5a3b22", -TW, -12 + TORSOX, TW * 2, 2);
  if (st > 0.15) rect("#e8c34a", TW * ct - st, -12 + TORSOX, 2 * st, 2);                          // fivela aparece quando a frente vira para nós
  const fa = Math.min(1, Math.max(0, (st - 0.8) / 0.2));
  if (fa > 0) { arm(farX, farY, farA, fa); ctx.globalAlpha *= fa; shoulder(farX, farY, sleeve); ctx.globalAlpha /= fa; }                                                // de frente: o braço do outro lado passa a ficar por cima
  arm(SHX * ct - AW * st, mix(-20.25, -21.5, st), mix(1.4, 1.69, st), 1); shoulder(SHX * ct - AW * st, mix(-20.25, -21.5, st), sleeve);                // braço de perto
  // pescoço, cabeça e rosto (a cabeça gira antes do resto)
  const hx = ch, nx = -ch;
  rect("#e0ac69", nx - 2, -26, 4, 2.5);
  if (sh < 0.99) { ctx.save(); ctx.globalAlpha *= 1 - sh; collarSide(shirt); ctx.restore(); }          // a gola gira junto com a cabeça: faixa de lado -> abas de frente
  if (sh > 0.01) { ctx.save(); ctx.globalAlpha *= sh; collarFront(shirt); ctx.restore(); }
  rect("#f1c27d", hx - 4.5, -33, 9, 8.5); rect(`rgba(0,0,0,${mix(0.12, 0.1, sh)})`, hx - 4.5, -33, mix(3, 2, sh), 8.5);
  for (const w of [-1.8, 1.8]) if (3.3 * sh - w * ch > 0.1) rect("#2a1a10", 3.3 * ch + w * sh - 0.8, mix(-30, -30.2, sh), 1.6, 1.8);   // olhos (o de longe só aparece quando a cabeça já virou)
  if (ch > 0.25) rect("#c98d5a", 5 * ch - ch, -27.5, 2 * ch, 1);                       // nariz (some quando fica de frente)
  if (sh > 0.2) { rect("#a0583a", 5.5 * ch - 1.4 * sh, -27.4, 2.8 * sh, 0.8);              // boca
    for (const w of [-3.1, 3.1]) if (4.5 * sh - w * ch > 0.1) rect(`rgba(230,120,100,${0.45 * sh})`, 4.5 * ch + w * sh - 0.7, -28.6, 1.4, 1.2); }   // bochechas
  const hb = Math.hypot(7 * ch, 7.5 * sh);
  rect(hat, hx - hb, -35.5, hb * 2, 3); rect(hat, hx - 4.5, -40, 9, 5);
  rect("rgba(0,0,0,.25)", hx - hb, -34, hb * 2, 1.2); rect("rgba(255,255,255,.35)", hx - 4.5, -36.5, 9, 1.2);
  ctx.restore();
  return { x, y: PIER_Y - 30 - UP };
}
function drawFisherBase(x, dir, shirt, hat, amp = 0, pose = null) {
  const P = pose || POSE0;
  const sleeve = shade(shirt, 0.84);
  const rk = P.run || 0;
  const ph = P.gait !== undefined ? P.gait : x * dir / (11 + 3 * rk + LEGX * 0.5);   // fase da passada: avança com o chão percorrido (pernas mais longas dão passadas mais longas)
  const gs = Math.sin(ph), gc = Math.cos(ph);
  const GA = amp * 0.5, KB = amp * (0.2 + 0.45 * rk), LG = 11 + LEGX;       // GA: abertura da coxa; KB: quanto o joelho dobra na perna que vai pra frente; LG: comprimento da perna
  const sw = P.brake ? 0.85 * P.brake : gs * amp;                                    // freando: pernas abertas e firmes
  const bob = (P.brake ? 1.1 * P.brake : LG * (1 - Math.cos(GA * gs)) * (1 - 0.35 * rk) - rk * 1.2 * Math.abs(gc)) + (P.sb || 0);   // o quadril desce quando as pernas abrem (pé sempre no chão) e quica ao correr
  const armSw = (P.brake ? 0 : gs * amp) * (0.35 + 0.2 * rk);                       // braço balança CONTRA a perna do mesmo lado (antes balançava junto, e por isso parecia torto)
  const s = P.stow !== undefined ? P.stow : 0;                                      // vara: 0 na mão ... 1 nas costas
  const sv = P.sv || 0, wig = P.wig || 0;
  const h1x = SHX + AL * Math.cos(RA), h1y = SHY + AL * Math.sin(RA);               // mão atrás do ombro (onde a vara é segurada para deslizar)
  const bd = (h1x - BKB[0]) * BUX + (h1y - BKB[1]) * BUY;                           // distância da base ao ponto da vara nas costas mais perto da mão
  const hbx = BKB[0] + BUX * bd, hby = BKB[1] + BUY * bd;
  const hold = P.phone || 0, A0n = P.run !== undefined && !P.brake ? (1.4 - 0.35 * rk) - armSw : P.arm;
  const A0 = hold ? lerp(A0n, PHONE_ARM, hold) : A0n;             // para onde o braço volta ao soltar a vara (correndo: balança com o corpo)
  const A = s <= 0 ? P.arm : s < SL0 ? spl(K_ARM, s) + P.arm * Math.max(0, 1 - s / 0.3) : s < 0.70 ? RA : lerp(RA, A0 - 2 * Math.PI, spl(K_REL, (s - 0.70) / 0.30));   // o braço cai por trás das costas (não atravessa o rosto)   // sobe, segura no alto e só então solta (com sobra)
  const fk = P.front || 0;                                                         // virando de frente: 0 = de lado ... 1 = de frente
  ctx.save(); ctx.translate(x, PIER_Y); ctx.scale(dir, 1);
  softShadow(-7 * dir, 1.4, 17, 2.6, 0.34, 3); softShadow(0, 1.1, 8, 1.7, 0.5, 3);        // sombra longa para a esquerda (sol à direita) + sombra de contato nos pés
  if (P.cheer !== undefined || fk >= 0.5) {                                          // comemorando (braços pro alto) ou parado (braços caídos): de frente para o jogador
    const wv = P.wv || 0, idle = P.cheer === undefined;
    ctx.translate(0, idle ? Math.sin(performance.now() / 600) * 0.3 : -(P.hop || 0));    // parado: respira de leve
    if (idle) { ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 1.6; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-4, -14 - LEGX - TORSOX); ctx.lineTo(4.5, -44 - LEGX - TORSOX); ctx.stroke(); }   // vara nas costas, aparecendo atrás dele
    const lg = (lx, col) => { rect(col, lx, -11 - LEGX, 4, 9 + LEGX); rect("#15110e", lx - 0.5, -2.5, 5, 2.5); };
    lg(-4.6, LEGS[0]); lg(0.6, LEGS[1]);
    ctx.translate(0, -(LEGX + TORSOX));                                              // tudo de cima (tronco, braços, cabeça) sobe
    rect(shirt, -TW, -24, TW * 2, 14 + TORSOX); rect("rgba(0,0,0,.2)", -TW, -24, 2.5, 14 + TORSOX); rect("rgba(255,255,255,.18)", TW - 2.5, -24, 2.5, 14 + TORSOX);
    rect("#5a3b22", -TW, -12 + TORSOX, TW * 2, 2); rect("#e8c34a", -1, -12 + TORSOX, 2, 2);
    const arm = (sx, ang) => { ctx.save(); ctx.translate(sx, -21.5); ctx.rotate(ang);
      rect(sleeve, 0, -1.75, AL, 3.5); rect("rgba(0,0,0,.2)", 0, 1.25, AL, 0.8); rect("#f1c27d", AL - 0.5, -1.75, 3, 3.5); ctx.restore(); };
    if (idle) { arm(-AW, Math.PI / 2 + 0.03); arm(AW, Math.PI / 2 - 0.03); }
    else { arm(-AW, -Math.PI + 1.0 - wv * 0.12); arm(AW, -1.0 + wv * 0.12); }
    shoulder(-AW, -21.5, sleeve); shoulder(AW, -21.5, sleeve);
    rect("#e0ac69", -2, -26, 4, 2.5); collarFront(shirt);
    rect("#f1c27d", -4.5, -33, 9, 8.5); rect("rgba(0,0,0,.1)", -4.5, -33, 2, 8.5);
    rect("#2a1a10", -2.6, -30.2, 1.6, 1.8); rect("#2a1a10", 1, -30.2, 1.6, 1.8);       // olhos
    rect("rgba(230,120,100,.45)", -3.8, -28.6, 1.4, 1.2); rect("rgba(230,120,100,.45)", 2.4, -28.6, 1.4, 1.2);
    if (idle) rect("#a0583a", -1.4, -27.4, 2.8, 0.8);                                  // parado: boca neutra
    else { rect("#7a2a1a", -1.6, -27.6, 3.2, 1.5); rect("#fff", -1.2, -27.6, 2.4, 0.7); }   // comemorando: sorriso
    rect(hat, -7.5, -35.5, 15, 3); rect(hat, -4.5, -40, 9, 5);
    rect("rgba(0,0,0,.25)", -7.5, -34, 15, 1.2); rect("rgba(255,255,255,.35)", -4.5, -36.5, 9, 1.2);
    ctx.restore();
    return { x, y: PIER_Y - 30 };
  }
  if (P.crank === undefined) {                                                     // braço livre, desenhado ANTES das pernas: fica atrás delas e não atravessa a calça (na hora de puxar o peixe ele gira a manivela)
    const ak = AL / 8;
    ctx.save(); ctx.translate(0, -(LEGX + TORSOX) - 22 + bob); ctx.rotate((P.brake ? -sw * 0.6 : armSw) + 0.1 + (P.off || 0));   // braço livre: oposto ao braço da vara (e contrapeso no arremesso)
    rect(sleeve, -1.7, 0, 3.4, 9 * ak); rect("rgba(0,0,0,.2)", -1.7, 0, 3.4, 9 * ak); rect("#d9ab6f", -1.7, 8.5 * ak, 3.4, 3);
    ctx.restore();
  }
  const leg = (th, kn, col) => {                                                 // coxa gira no quadril; a canela gira no joelho (dobra para trás)
    const Lt = (9 + LEGX) / 2;
    ctx.save(); ctx.translate(0, -11 - LEGX + bob); ctx.rotate(th);
    rect(col, -2.3, 0, 4.6, Lt + 0.4);
    ctx.translate(0, Lt); ctx.rotate(kn);
    rect(col, -2.3, 0, 4.6, Lt); rect("#15110e", -3, Lt - 0.5, 6.6, 2.5);
    ctx.restore();
  };
  if (P.brake) { leg(-0.64 * P.brake, 0, LEGS[0]); leg(0.64 * P.brake, 0, LEGS[1]); }   // freando: pernas abertas e retas
  else {                                                                          // trás (escura) e frente em oposição: uma apoia (reta) enquanto a outra vai pra frente (joelho dobrado)
    leg(-GA * gs, KB * Math.max(0, gc), LEGS[0]);
    leg(GA * gs, KB * Math.max(0, -gc), LEGS[1]);
  }
  ctx.translate(0, -(LEGX + TORSOX));                                               // tudo de cima (tronco, braços, cabeça) sobe

  ctx.translate(0, bob); ctx.translate(0, -11 + TORSOX); ctx.rotate(P.lean); ctx.translate(0, 11 - TORSOX);   // tronco inclina a partir do quadril
  const ca = Math.cos(A), sa = Math.sin(A);
  const hx = SHX + AL * ca, hy = SHY + AL * sa;                    // posição da mão
  const ra = P.rod - P.flex * 0.25;                                  // a ponta da vara atrasa quando ela chicoteia
  let tx = hx + RL * Math.cos(ra), ty = hy + RL * Math.sin(ra);
  const kS = s < SL0 ? 0 : ease3(Math.min(1, (s - SL0) / (SL1 - SL0)));   // quanto a vara já deslizou para as costas
  rect(shirt, -TW, -24, TW * 2, 14 + TORSOX);
  rect("rgba(0,0,0,.25)", -TW, -24, 3.5, 14 + TORSOX); rect("rgba(255,255,255,.18)", TW - 3, -24, 2, 14 + TORSOX);
  rect("#5a3b22", -TW, -12 + TORSOX, TW * 2, 2);
  const foreArm = () => {
    ctx.save(); ctx.translate(SHX, SHY); ctx.rotate(A);                                // antebraço gira no ombro (no centro do tronco)
    rect(sleeve, 0, -1.75, AL, 3.5); rect("rgba(0,0,0,.2)", 0, 1.25, AL, 0.8); rect("#f1c27d", AL - 0.5, -1.75, 3, 3.5);
    ctx.restore();
    shoulder(SHX, SHY, sleeve);
  };
  if (s <= 0) foreArm();                                                               // durante guardar/sacar o braço é desenhado por cima (a mão não some atrás da cabeça)
  
  rect("#e0ac69", -3, -26, 4, 2.5); collarSide(shirt);
  ctx.save(); if (hold) { ctx.translate(0, -25); ctx.rotate(0.22 * hold); ctx.translate(0, 25); }     // cabeça baixa olhando o celular
  rect("#f1c27d", -3.5, -33, 9, 8.5); rect("rgba(0,0,0,.12)", -3.5, -33, 3, 8.5);
  rect("#2a1a10", 2.5, -30, 1.6, 1.8); rect("#c98d5a", 4, -27.5, 2, 1);
  if (hold > 0.3) rect(`rgba(205,245,160,${PHONE_LIGHT * 0.5 * clamp01((hold - 0.3) / 0.5)})`, -0.5, -33, 6, 8.5);   // luz da tela iluminando o rosto
  rect(hat, -6, -35.5, 14, 3); rect(hat, -3.5, -40, 9, 5);
  rect("rgba(0,0,0,.25)", -6, -34, 14, 1.2); rect("rgba(255,255,255,.35)", -3.5, -36.5, 9, 1.2);
  ctx.restore();
  if (s > 0) foreArm();                                                                // guardando/sacando: braço por cima de tudo
  if (hold > 0.01) drawHeldPhone(SHX + (AL + 2) * ca, SHY + (AL + 2) * sa, hold);                  // celular na mão, com a luz no rosto
  const cx = (hx + tx) / 2 + P.flex * 6.6 * Math.sin(P.rod), cy = (hy + ty) / 2 - P.flex * 6.6 * Math.cos(P.rod);
  ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
  if (P.cheer === undefined) {                                                         // (comemorando: sem vara)
    let bx = hx, by = hy, ex = tx, ey = ty, qx = cx, qy = cy;
    if (s > 0) {
      let fl;
      if (s < SL0) {                                                                   // vara na mão: sobe e gira por cima do ombro; a ponta atrasa com a velocidade (envergada)
        const r = spl(K_ROD, s), dr = (spl(K_ROD, Math.min(1, s + 0.01)) - spl(K_ROD, Math.max(0, s - 0.01))) / 0.02;
        ex = hx + RL * Math.cos(r); ey = hy + RL * Math.sin(r);
        fl = Math.max(-0.9, Math.min(0.9, dr * sv * 0.1));
      } else {                                                                         // a vara desliza pela mão e por trás do corpo até as costas (ou o inverso)
        const th = lerp(-2.0, TB, kS), L = lerp(RL, BKL, kS), ux = Math.cos(th), uy = Math.sin(th);   // a vara gira em pé e passa pela mão (ponto de pegada)
        const gx = lerp(h1x, hbx, kS), gy = lerp(h1y, hby, kS), d = bd * kS;
        bx = gx - d * ux; by = gy - d * uy;
        ex = bx + L * ux + wig * 1.4 * kS; ey = by + L * uy;                            // wig: a vara balança de leve ao assentar
        fl = s < SL1 ? -0.4 * Math.sign(sv || 1) * Math.sin(Math.PI * (s - SL0) / (SL1 - SL0)) : 0;
      }
      const dx = ex - bx, dy = ey - by, L = Math.hypot(dx, dy) || 1;
      qx = (bx + ex) / 2 + fl * 6.6 * dy / L; qy = (by + ey) / 2 - fl * 6.6 * dx / L;
    }
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(qx, qy, ex, ey); ctx.stroke();
    if (s > 0) { tx = ex; ty = ey; }                                                  // ponta real da vara (para a linha e a boia)
    if (s > 0) {
      if (s < 0.74) rect("#b8b8b8", hx - 1.5, hy - 1.5, 3, 3);                         // mão segurando a vara
      if (kS > 0.05) rect("#b8b8b8", bx + (ex - bx) * 0.32 * kS - 0.5, by + (ey - by) * 0.32 * kS, 2.4, 2.4);   // carretilha desliza pela vara
    }
  }
  if (P.cheer !== undefined || s > 0) { /* braços pro alto / vara em transição ou nas costas */ }
  else if (P.crank === undefined) rect("#b8b8b8", hx - 1.5, hy - 1.5, 3, 3);
  else {                                                                              // carretilha de verdade: corpo, manivela girando e a mão da frente puxando
    const rdx = Math.cos(ra), rdy = Math.sin(ra);
    const rcx = hx + rdx * 3 - rdy * 3, rcy = hy + rdy * 3 + rdx * 3;                  // carretilha pendurada embaixo da vara, logo à frente da mão
    rect("#7d7d7d", rcx - 2.8, rcy - 2.8, 5.6, 5.6); rect("#c9c9c9", rcx - 2.1, rcy - 2.1, 4.2, 4.2);
    rect("#8a8a8a", rcx - 2.1, rcy + 0.6, 4.2, 1.5); rect("#4d4d4d", rcx - 0.7, rcy - 0.7, 1.4, 1.4);
    const kx = rcx + 2.6 * Math.cos(P.crank), ky = rcy + 2.6 * Math.sin(P.crank);       // ponta da manivela
    ctx.strokeStyle = "#dcdcdc"; ctx.lineWidth = 1; ctx.lineCap = "butt";
    ctx.beginPath(); ctx.moveTo(rcx, rcy); ctx.lineTo(kx, ky); ctx.stroke();
    const ax = SHX, ay = -20.5, vx = kx - ax, vy = ky - ay, L = Math.max(6, Math.hypot(vx, vy) - 1.5);
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(vy, vx));                // braço livre estica até a manivela
    rect(sleeve, 0, -1.7, L, 3.4); rect("rgba(0,0,0,.2)", 0, 1.25, L, 0.8); rect("#d9ab6f", L - 0.8, -1.7, 3, 3.4);
    ctx.restore();
    rect("#e8c34a", kx - 1, ky - 1, 2, 2);                                              // cabo da manivela
  }
  ctx.restore();
  const py = -11 + TORSOX, dy = ty - py, c = Math.cos(P.lean), sn = Math.sin(P.lean);   // ponta da vara no mundo (com a inclinação)
  return { x: x + dir * (tx * c - dy * sn), y: PIER_Y - (LEGX + TORSOX) + (tx * sn + dy * c) + py + bob };
}
// ---------- Malto: marinheiro andarilho de pé na frente das caixas (NPC só do seu navegador) ----------
// Chegue perto e aperte E (ou toque nele) para conversar. Para mexer nas falas, edite MALTO_LINES.
const MALTO_LINES = [
  "Ei, pescador. Senta aí... ah, não tem banco. Fica em pé mesmo.",
  "Fronteira é uma linha que alguém riscou na água. A maré nunca leu.",
  "Sento aqui e deixo o mundo passar. Sai mais barato do que correr atrás dele.",
  "Nasci em lugar nenhum. É o único endereço que nunca me cobrou aluguel.",
  "Cada um tem a sua linha da sorte. A minha eu mesmo cravei na mão.",
  "Herói? Não, amigo. Só um sujeito que nunca aprendeu a ficar parado.",
  "O mar devolve tudo, cedo ou tarde. Às vezes é um peixe, às vezes é uma ideia.",
  "Cigarro apagado é só papel. Fumaça é conversa com o vento.",
  "Pesque devagar. O mar não tem pressa e ninguém ganha dele.",
  "Já dei a volta ao mundo e ainda me perco neste cais. Bonito, não?",
  "Bandeira, hino, passaporte... o peixe não pergunta nada disso.",
  "Estas caixas? Nunca abri. Mistério também é carga.",
];
const MX = 110, TYPE_CPS = 38;
let mt = 0, mTalk = null, mLine = -1;
const mNear = () => !CITY.on && state === "walk" && Math.abs(px - MX) < 40;

function maltoUpdate(dt) {
  mt += dt;
  if (mTalk) {
    const len = mTalk.text.length, a = Math.floor(mTalk.t * TYPE_CPS / 3);
    mTalk.t += dt;
    if (Math.floor(mTalk.t * TYPE_CPS / 3) > a && mTalk.t * TYPE_CPS < len)           // "voz" de máquina de escrever
      SND.play("step_wood_" + (1 + (Math.random() * 4 | 0)), { vol: 0.1, rate: 1.9, jitter: 0.25 });
    if (mTalk.t > len / TYPE_CPS + 6 || Math.abs(px - MX) > 80 || state !== "walk") mTalk = null;
  }
}
const maltoSay = text => { mTalk = { t: 0, text }; };
function talkLore() {                                                                            // uma fala de conversa do Malto
  let n;
  if (mLine < 0) n = 0;                                                                         // primeira fala é a saudação
  else do { n = 1 + (Math.random() * (MALTO_LINES.length - 1) | 0); } while (n === mLine);      // depois sorteia sem repetir
  mLine = n; maltoSay(MALTO_LINES[n]);
}
function talkMalto() {
  if (!mNear()) return false;
  if (px !== MX) dir = MX < px ? -1 : 1;                                                         // vira de lado para o Malto
  if (mTalk && mTalk.t * TYPE_CPS < mTalk.text.length) { mTalk.t = 99; return true; }           // 1º toque: termina de digitar
  if (invCount() > 0) { openBag("shop"); maltoSay(pickOf(SHOP_HELLO)); return true; }           // com peixe no inventário: o Malto compra
  if (mLine >= 0 && Math.random() < 0.35) maltoSay(pickOf(SHOP_EMPTY)); else talkLore();       // sem peixe: conversa (e às vezes lembra que compra peixe)
  return true;
}

const CRATE_TONES = [["#6e4620", "#a8743c"], ["#63401d", "#9b6a38"], ["#76492a", "#b07e46"]];
function drawCrate(x, y, w, h, v = 0) {                              // x,y = canto superior esquerdo
  const [dk, lt] = CRATE_TONES[v % 3];
  rect(dk, x, y, w, h); rect(lt, x + 1, y + 1, w - 2, h - 2);
  rect("#8a5a2b", x + 1, y + Math.round(h / 2), w - 2, 1);                                      // emenda da tábua
  ctx.strokeStyle = dk; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 1.5, y + 1.5); ctx.lineTo(x + w - 1.5, y + h - 1.5); ctx.stroke();   // travessa em X
  ctx.beginPath(); ctx.moveTo(x + w - 1.5, y + 1.5); ctx.lineTo(x + 1.5, y + h - 1.5); ctx.stroke();
  rect("rgba(255,222,170,.3)", x + 1, y + 1, w - 2, 1);                                         // luz em cima
  rect("rgba(255,200,150,.18)", x + w - 3, y + 1, 2, h - 2);                                    // luz do pôr do sol na lateral direita
  rect("rgba(20,8,36,.2)", x + 1, y + 1, Math.round((w - 2) * 0.3), h - 2);                     // lateral esquerda na sombra
  rect("rgba(20,8,36,.4)", x, y + h - 2, w, 2);                                                 // base escura (contato com o chão)
  rect("#3b2a1a", x + 2, y + 2, 1, 1); rect("#3b2a1a", x + w - 3, y + 2, 1, 1);                 // pregos
}
function drawMalto(now) {
  const t = now / 1000, by = Math.sin(t * 1.6) * 0.3;                 // respiração leve
  // caixas ao fundo
  const cb = PIER_Y - 0.5, dk = PIER_Y + 3.2;                                    // base das caixas: um pouco atrás dos pés do Malto, em cima das tábuas
  softShadow(MX - 40, PIER_Y + 1.2, 30, 3, 0.42, dk);                            // sombra das caixas caindo SÓ nas tábuas do deck (sol à direita)
  softShadow(MX - 6, PIER_Y + 0.9, 26, 2.2, 0.55, dk);                           // sombra de contato logo embaixo delas
  drawCrate(MX - 30, cb - 15, 16, 15, 0); drawCrate(MX - 14, cb - 15, 16, 15, 1); drawCrate(MX + 2, cb - 15, 16, 15, 2);
  drawCrate(MX - 22, cb - 30, 16, 15, 2); drawCrate(MX + 4, cb - 26, 12, 11, 0);
  rect("rgba(20,8,36,.22)", MX - 14, cb - 30, 2, 15);                            // sombra da caixa de cima na lateral da de baixo

  ctx.save(); ctx.translate(MX, PIER_Y);
  softShadow(-7, 1.4, 17, 2.6, 0.34, 3); softShadow(0, 1.1, 8, 1.7, 0.5, 3);              // sombra longa para a esquerda + sombra de contato nos pés

  // corpo na mesma estrutura do pescador (altura máxima: pernas +8, tronco +3), com o sobretudo mais largo e aberto na frente
  const S = -24 - 11 + by, CW = 6, COAT = "#8997ab";                                 // S: topo do tronco (linha dos ombros); CW: meia largura do sobretudo
  const lg = (lx, col) => { rect(col, lx, -19, 4, 17); rect("#0e0e12", lx - 0.5, -2.5, 5, 2.5); };
  lg(-4.6, "#1d2531"); lg(0.6, "#232c3a");
  const skirt = () => { ctx.beginPath(); ctx.moveTo(-CW - 0.2, S + 16); ctx.lineTo(CW + 0.2, S + 16); ctx.lineTo(8.6, S + 26); ctx.lineTo(-8.6, S + 26); ctx.closePath(); };
  skirt(); ctx.fillStyle = COAT; ctx.fill();                                                                         // saia do sobretudo: abre em A até o joelho
  ctx.beginPath(); ctx.moveTo(-CW - 0.2, S + 16); ctx.lineTo(-2.2, S + 16); ctx.lineTo(-3.2, S + 26); ctx.lineTo(-8.6, S + 26); ctx.closePath();
  ctx.fillStyle = "rgba(20,28,50,.32)"; ctx.fill();                                                                  // lado esquerdo na sombra
  ctx.beginPath(); ctx.moveTo(0, S + 14); ctx.lineTo(1.7, S + 26); ctx.lineTo(-1.7, S + 26); ctx.closePath(); ctx.fillStyle = "#1d2531"; ctx.fill();   // abertura da frente (aparece a calça)
  rect("rgba(20,28,50,.35)", -8.6, S + 25, 17.2, 1);                                                                 // barra
  rect(COAT, -CW, S, CW * 2, 17);
  rect("rgba(20,28,50,.32)", -CW, S, 3, 17); rect("rgba(255,255,255,.14)", CW - 2.5, S, 2.5, 17);                    // sombra à esquerda, luz à direita
  rect("rgba(20,28,50,.4)", -0.4, S + 8, 0.8, 7);                                                                    // abertura da frente
  [[-3.3, S + 4], [2, S + 4], [-3.3, S + 10], [2, S + 10]].forEach(([x, y]) => rect("#d9a441", x, y, 1.3, 1.3));     // botões dourados
  rect("#5a4631", -CW, S + 15, CW * 2, 2); rect("#d9a441", -1.1, S + 14.8, 2.2, 2.4); rect("#2a1d10", -0.4, S + 15.5, 0.8, 1);   // cinto com fivela

  // gola: camisa escura em V, lapelas do sobretudo bem visíveis e gola redonda clara em volta do pescoço
  const hy = by - 5;
  ctx.beginPath(); ctx.moveTo(-2.6, S - 1.5); ctx.lineTo(2.6, S - 1.5); ctx.lineTo(0, S + 9); ctx.closePath(); ctx.fillStyle = "#1f2733"; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-1.8, S - 2); ctx.lineTo(-5.8, S - 1.2); ctx.lineTo(-6, S + 3); ctx.lineTo(-3.8, S + 7); ctx.lineTo(-0.5, S + 9.5); ctx.lineTo(-2, S + 2); ctx.closePath();
  ctx.fillStyle = "#6f7d92"; ctx.fill();                                                                             // lapela esquerda (na sombra)
  ctx.beginPath(); ctx.moveTo(1.8, S - 2); ctx.lineTo(5.8, S - 1.2); ctx.lineTo(6, S + 3); ctx.lineTo(3.8, S + 7); ctx.lineTo(0.5, S + 9.5); ctx.lineTo(2, S + 2); ctx.closePath();
  ctx.fillStyle = "#a9b5c6"; ctx.fill();                                                                             // lapela direita (na luz)
  ctx.fillStyle = "#d8dee8"; roundPath(-2.9, S - 1, 5.8, 4.2, 2); ctx.fill();                                        // gola redonda da camisa
  ctx.fillStyle = "#e8b98f"; roundPath(-2, S - 1.2, 4, 2.8, 1.3); ctx.fill();                                        // pescoço no decote
  rect("rgba(0,0,0,.14)", -2, S - 0.4, 4, 0.6);

  // braços iguais aos do pescador (mesmo comprimento, manga, ombrinho e mão), colados no sobretudo
  const MAL = 8 + 3, MSH = CW + 1.75, SY = S + 2.5;
  ctx.save(); ctx.translate(-MSH, SY); ctx.rotate(Math.PI / 2 + 0.03);
  rect("#6f7d92", 0, -1.75, MAL, 3.5); rect("rgba(0,0,0,.2)", 0, 1.25, MAL, 0.8); rect("#f3c8a0", MAL - 0.5, -1.75, 3, 3.5);
  ctx.restore();
  shoulder(-MSH, SY, "#6f7d92");
  ctx.lineCap = "butt"; ctx.lineJoin = "round";

  // cabeça de frente
  rect("#1a120c", -5.4, -38.5 + hy, 2, 9); rect("#1a120c", 3.4, -38.5 + hy, 2, 9);          // costeletas
  rect("#1a120c", -6.6, -35 + hy, 1.8, 4); rect("#1a120c", 4.8, -35 + hy, 1.8, 4);          // cachos
  rect("#f3c8a0", -4.2, -38.5 + hy, 8.4, 9); rect("rgba(0,0,0,.1)", -4.2, -33 + hy, 8.4, 3.5);
  rect("rgba(0,0,0,.45)", -4.2, -38.2 + hy, 8.4, 2);                                        // sombra da aba nos olhos
  rect("#16110d", -3, -36 + hy, 2.2, 1); rect("#16110d", 0.8, -36 + hy, 2.2, 1);            // olhos
  rect("#e0a67a", -0.6, -35 + hy, 1.4, 2.8);                                                // nariz
  rect("#a86a4a", -1.6, -31.8 + hy, 2.6, 0.7);                                              // boca
  rect("#e0a63a", -6.2, -31.5 + hy, 1.2, 1.8);                                              // brinco
  // quepe
  rect("#f2f2f4", -5, -46 + hy, 10, 3.4); rect("rgba(0,0,0,.14)", -5, -43.6 + hy, 10, 0.8);
  rect("#101015", -5.4, -42.8 + hy, 10.8, 2.8);
  rect("#6f7a89", -4.4, -40.2 + hy, 8.8, 1.6); rect("#3b4350", -4.4, -39 + hy, 8.8, 0.5);
  rect("#d9a441", -1.5, -42.5 + hy, 3, 2.2);

  // braço direito com o cigarro na mão: ciclo de 8s = descansa -> leva à boca -> traga -> abaixa -> solta a fumaça
  const u = t % 8, ease = k => k * k * (3 - 2 * k);
  const k = u < 3 ? 0 : u < 3.8 ? ease((u - 3) / 0.8) : u < 5.2 ? 1 : u < 6 ? 1 - ease((u - 5.2) / 0.8) : 0;
  const drag = u >= 3.8 && u < 5.2 ? Math.min(1, (u - 3.8) / 0.3, (5.2 - u) / 0.3) : 0;           // intensidade do trago
  const L = (a, b) => a + (b - a) * k;
  const hx = L(MSH + 0.15, 3.7), hyy = L(SY + MAL + 1, -36.4 + hy + 5), ex = L(MSH + 0.15, 9.6), ey = L(SY + 5.5, -25 + by);   // mão e cotovelo
  ctx.strokeStyle = "#7b8aa0"; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(MSH, SY); ctx.lineTo(ex, ey); ctx.lineTo(hx, hyy); ctx.stroke();
  shoulder(MSH, SY, "#7b8aa0");
  const th = -Math.PI / 2 * (1 - k), ox = L(-0.5, -3.9), CL = 5.6, cc = Math.cos(th), ss = Math.sin(th);   // cigarro gira de "pra cima" até "pra boca"
  ctx.save(); ctx.translate(hx, hyy); ctx.rotate(th);
  rect("#f4f4f6", ox, -0.5, CL, 1); rect("#d9a441", ox, -0.5, 1.2, 1);                    // cigarro com filtro
  rect(`rgb(255,${110 + 90 * (1 - drag) | 0},${40 + 20 * (1 - drag) | 0})`, ox + CL - 1, -0.5, 1.1, 1);   // brasa (mais viva no trago)
  ctx.restore();
  rect("#f3c8a0", hx - 1.5, hyy - 1.5, 3, 3); rect("rgba(0,0,0,.18)", hx - 1.5, hyy + 0.6, 3, 0.9);   // mão por cima do cigarro
  const tipX = hx + cc * (ox + CL + 0.2), tipY = hyy + ss * (ox + CL + 0.2);              // ponta acesa no mundo local
  if (drag > 0) { ctx.fillStyle = `rgba(255,140,60,${0.35 * drag})`; ctx.beginPath(); ctx.arc(tipX, tipY, 2.6, 0, 7); ctx.fill(); }
  for (let j = 0; j < 2; j++) {                                                            // fiozinho de fumaça saindo da brasa
    const p = (t * 0.5 + j / 2) % 1;
    ctx.fillStyle = `rgba(210,215,225,${0.32 * (1 - p)})`; ctx.beginPath();
    ctx.arc(tipX + Math.sin(p * 7 + j * 3) * 1.6, tipY - 1 - p * 13, 0.7 + p * 1.5, 0, 7); ctx.fill();
  }
  if (u >= 6 && u < 7.8) {                                                                 // baforada saindo da boca depois do trago
    const q = (u - 6) / 1.8;
    for (let j = 0; j < 4; j++) {
      const p = Math.max(0, Math.min(1, q - j * 0.1));
      ctx.fillStyle = `rgba(225,228,236,${0.5 * (1 - p)})`; ctx.beginPath();
      ctx.arc(1 + p * 9 + j * 0.8, -36.6 + hy + 5 - p * 9 + Math.sin(p * 5 + j) * 1.2, 1.2 + p * 3.2, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
  drawTiao(now);                                                                         // o outro personagem do cais
}
function wrapLines(s, max) {
  const out = []; let cur = "";
  s.split(" ").forEach(w => { if ((cur + " " + w).trim().length > max) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); });
  if (cur) out.push(cur); return out;
}
// tecla "E" flutuando sobre a cabeça do personagem (aviso de que dá para interagir); a tecla balança e "aperta" de tempos em tempos
function keyHint(x, y, now, label) {
  const bob = Math.sin(now / 230) * 1.2, press = Math.floor(now / 550) % 3 === 0 ? 1 : 0, S0 = 13;
  const kw = label ? S0 + 4 + Math.ceil(label.length * UI_CH) : S0, kx = Math.round(x - kw / 2), ky = Math.round(y + bob);
  rect("#0f1624", kx - 1, ky - 1 + press, S0 + 2, S0 + 3);                                // contorno
  rect("#9aa3b2", kx, ky + 1 + press, S0, S0);                                           // lateral da tecla (sombra)
  rect("#ffffff", kx, ky + press, S0, S0 - 1);                                           // topo da tecla
  rect("#e4e9f2", kx + 1, ky + 1 + press, S0 - 2, 1);                                    // brilho
  ctx.font = UI_PX + "px " + UI_FONT; ctx.textAlign = "center"; ctx.fillStyle = "#1b2230";
  ctx.fillText("E", kx + S0 / 2, ky + S0 - 3 + press);
  if (label) text(label, kx + S0 + 4, ky + S0 - 2, "#ffd166");
}
function drawMaltoUI(now) {
  const nameY = PIER_Y - 58;
  text("Malto", MX, nameY, "#9fd3ff", "center");
  if (mTalk) {
    const full = mTalk.text, shown = Math.min(full.length, Math.floor(mTalk.t * TYPE_CPS));
    const lines = wrapLines(full, 24), lh = 11, w = Math.ceil(24 * UI_CH) + 14, hgt = lines.length * lh + 9;
    const bx = Math.round(MX - w / 2), byy = Math.round(nameY - 14 - hgt);
    rect("#9fd3ff", bx - 1, byy - 1, w + 2, hgt + 2); rect("#0f1624", bx, byy, w, hgt);
    ctx.fillStyle = "#9fd3ff"; ctx.beginPath(); ctx.moveTo(MX - 5, byy + hgt + 1); ctx.lineTo(MX + 5, byy + hgt + 1); ctx.lineTo(MX, byy + hgt + 7); ctx.fill();
    ctx.fillStyle = "#0f1624"; ctx.beginPath(); ctx.moveTo(MX - 4, byy + hgt); ctx.lineTo(MX + 4, byy + hgt); ctx.lineTo(MX, byy + hgt + 5); ctx.fill();
    let left = shown;
    lines.forEach((l, i) => { text(l.slice(0, Math.max(0, left)), bx + 7, byy + 11 + i * lh, "#fff"); left -= l.length + 1; });
    if (shown >= full.length && Math.floor(now / 400) % 2) text("E >", bx + w - 5, byy + hgt - 2, "#ffd166", "right");
  } else if (mNear() && !BAG.open) keyHint(MX, nameY - 28, now, invCount() > 0 ? "vender" : "");
  drawTiaoUI(now);
}
// ---------- Pedro: negro alto (a altura do Malto), cabelo curto, sem camiseta, graveto na boca. Cara de mau, mas é muito gente boa ----------
// Chegue perto e aperte E (ou toque nele) para conversar. De vez em quando, do nada, ele tira a flauta e toca "Wonder" (assets/songs/wonder.wav).
// Para mexer nas falas, edite TIAO_LINES; para mudar o nome, TIAO_NAME; a posição no cais é TX.
const TIAO_NAME = "Pedro"; let TX = 385;                               // TX muda quando ele sai andando
const TIAO_LINES = [
  "Opa, firmeza? Pode chegar, não mordo. Cara feia é de fábrica.",
  "Cara de bravo é só o rosto que Deus me deu. Por dentro sou manteiga.",
  "Pescou hoje? Se não pegou nada, relaxa: peixe também tem dia de folga.",
  "Esse graveto aqui? Ajuda a pensar. E espanta conversa fiada.",
  "Eu toco flauta quando ninguém tá olhando. Mas pode olhar, eu deixo.",
  "Se o peixe fugir, não leva a mal. Ele só tava de passagem.",
  "O Malto fala bonito, mas sou eu quem escuta de verdade.",
  "Já chorei vendo o pôr do sol neste cais. Não conta pra ninguém.",
  "Cais pequeno, vizinho é família. Qualquer coisa, grita.",
  "Sem camiseta mesmo. O sol aqui é de graça, aproveito tudo.",
  "Quer uma dica? Paciência. O resto o peixe resolve.",
];
const TIAO_SORRY = "Opa, perdão! Me empolguei na flauta. Chega mais, firmeza?";
let tt = 0, tTalk = null, tLine = -1, tFr = 0;                          // tFr: 0 = cara de mau ... 1 = sorrindo (sobe quando alguém conversa com ele)
const FLUTE = { st: "idle", t: 0, k: 0, k0: 0, h: null, next: 14 + Math.random() * 16 };   // idle | up (tira a flauta) | play | down (guarda)
const TWALK = 26, TW_MIN = 200, TW_MAX = 450;                          // TWALK: velocidade da caminhada (px/s); TW_MIN/TW_MAX: trecho do cais por onde ele passeia
const TWK = { on: false, face: 1, ph: 0, amp: 0, wait: 6 + Math.random() * 8, goal: 385 };   // wait: segundos até o próximo passeio
const tNear = () => !CITY.on && state === "walk" && Math.abs(px - TX) < 40;
const tVol = () => 0.9 * Math.max(0.12, 1 - Math.abs(px - TX) / 320);   // mais perto = mais alto
const ease01 = k => k * k * (3 - 2 * k);
function fluteStop() { if (FLUTE.h) FLUTE.h.stop(0.5); FLUTE.k0 = FLUTE.k; FLUTE.st = "down"; FLUTE.t = 0; }

function tiaoUpdate(dt) {
  tt += dt;
  tFr += ((tTalk ? 1 : 0) - tFr) * Math.min(1, dt * 5);
  if (tTalk) {
    const len = tTalk.text.length, a = Math.floor(tTalk.t * TYPE_CPS / 3);
    tTalk.t += dt;
    if (Math.floor(tTalk.t * TYPE_CPS / 3) > a && tTalk.t * TYPE_CPS < len)           // "voz" mais grave que a do Malto
      SND.play("step_wood_" + (1 + (Math.random() * 4 | 0)), { vol: 0.12, rate: 1.25, jitter: 0.2 });
    if (tTalk.t > len / TYPE_CPS + 6 || Math.abs(px - TX) > 80 || state !== "walk") tTalk = null;
  }
  const F = FLUTE; F.t += dt;
  const K = TWK;                                                                        // passeio: de vez em quando ele sai andando devagar até outro ponto do cais
  K.amp += ((K.on ? 1 : 0) - K.amp) * Math.min(1, dt * 8);
  if (K.on) {
    const step = TWALK * dt, left = K.goal - TX;
    if (Math.abs(left) <= step || F.st !== "idle" || tTalk) { if (Math.abs(left) <= step) TX = K.goal; K.on = false; K.wait = 8 + Math.random() * 18; K.ph = 0; }
    else { TX += Math.sign(left) * step; K.face = Math.sign(left); K.ph += step / 10; }
  } else if (F.st === "idle" && !tTalk) {
    K.wait -= dt;
    if (K.wait <= 0) {
      let g; do g = TW_MIN + Math.random() * (TW_MAX - TW_MIN); while (Math.abs(g - TX) < 50);
      K.goal = g; K.face = Math.sign(g - TX); K.on = true; K.ph = 0;
    }
  }
  if (!SND.ready("wonder")) SND.preload("wonder");
  if (F.st === "idle") {
    F.k = 0;
    if (F.t >= F.next && !tTalk && !TWK.on && SND.ready("wonder")) { F.st = "up"; F.t = 0; }       // do nada: pega a flauta
  } else if (F.st === "up") {
    F.k = ease01(Math.min(1, F.t / 0.9));
    if (F.t >= 0.9) {
      F.h = SND.playSong("wonder", { vol: tVol() });
      if (F.h) { F.st = "play"; F.t = 0; } else fluteStop();
    }
  } else if (F.st === "play") {
    F.k = 1; F.h.set(tVol());
    if (F.h.ended || F.t > F.h.dur + 1) fluteStop();
  } else {                                                                              // down
    F.k = F.k0 * (1 - ease01(Math.min(1, F.t / 0.8)));
    if (F.t >= 0.8) { F.st = "idle"; F.t = 0; F.k = 0; F.next = 35 + Math.random() * 55; }
  }
}
function talkTiao() {
  if (!tNear()) return false;
  if (TWK.on) { TWK.on = false; TWK.ph = 0; TWK.wait = 10 + Math.random() * 15; }          // parou para conversar
  if (px !== TX) dir = TX < px ? -1 : 1;                                                // vira de lado para ele
  if (tTalk && tTalk.t * TYPE_CPS < tTalk.text.length) { tTalk.t = 99; return true; }   // 1º toque: termina de digitar
  let text;
  if (FLUTE.st === "up" || FLUTE.st === "play") { fluteStop(); text = TIAO_SORRY; tLine = -2; }   // interrompeu a música: ele para e pede desculpa
  else {
    let n;
    if (tLine === -1) n = 0;
    else do { n = 1 + (Math.random() * (TIAO_LINES.length - 1) | 0); } while (n === tLine);
    tLine = n; text = TIAO_LINES[n];
  }
  tTalk = { t: 0, text };
  return true;
}
const TIAO_C = { skin: "#5c3a26", dk: "#412518", lt: "#7a4d33", hair: "#140c07", hair2: "#2b1b11" };
function drawTiao(now) {
  if (TWK.on) return drawTiaoSide(now);
  const t = now / 1000, F = FLUTE, k = F.k, fr = tFr, C = TIAO_C, L = (a, b, p) => a + (b - a) * p;
  const by = Math.sin(t * 1.5 + 1) * 0.3, S = -35 + by;                                // S: linha dos ombros (a mesma do Malto)
  const bob = k > 0.5 ? Math.sin(t * 5.2) * 0.45 * k : 0;                              // balança a cabeça ao tocar
  const hy = by - 5 + bob, mY = -31.2 + hy, mX = L(0, -1.1, k);                        // mY/mX: boca
  const blink = (t + 1.3) % 4.4 > 4.28, shut = k > 0.55 || blink;
  ctx.save(); ctx.translate(TX, PIER_Y);
  softShadow(-7, 1.4, 17, 2.6, 0.34, 3); softShadow(0, 1.1, 8, 1.7, 0.5, 3);           // sombra longa para a esquerda + contato nos pés

  // pernas, chinelos e bermuda
  [-4.6, 0.6].forEach(lx => {
    rect(C.skin, lx, -19, 4, 17); rect("rgba(0,0,0,.22)", lx, -19, 1.2, 17); rect("rgba(255,210,160,.1)", lx + 3, -19, 1, 17);
    rect(C.skin, lx - 0.5, -2.6, 5, 1.7); rect("#1a120c", lx - 0.7, -1.1, 5.4, 1.1); rect("#1a120c", lx + 0.9, -2.8, 2.2, 0.7);   // pé com a sola do chinelo
  });
  ctx.beginPath(); ctx.moveTo(-5.3, S + 14); ctx.lineTo(5.3, S + 14); ctx.lineTo(5.9, -9.5); ctx.lineTo(0.7, -9.5); ctx.lineTo(0, -13.5); ctx.lineTo(-0.7, -9.5); ctx.lineTo(-5.9, -9.5); ctx.closePath();
  ctx.fillStyle = "#2f627d"; ctx.fill();
  ctx.save(); ctx.clip(); rect("rgba(10,20,40,.3)", -7, S + 14, 3.4, 30); rect("rgba(255,255,255,.1)", 3.4, S + 14, 3, 30); rect("rgba(10,20,40,.35)", -7, -10.9, 14, 1.4); ctx.restore();
  rect("#1f4559", -5.3, S + 14, 10.6, 1.4); rect("rgba(10,20,40,.3)", -4.6, S + 16.6, 3, 0.6); rect("rgba(10,20,40,.3)", 1.6, S + 16.6, 3, 0.6); rect("#e6d9b8", -0.4, S + 15.2, 0.8, 3.2); rect("#e6d9b8", -1.1, S + 15, 2.2, 0.8);   // cós e cordinha

  // tronco sem camiseta
  const torso = () => { ctx.beginPath(); ctx.moveTo(-6.3, S); ctx.lineTo(6.3, S); ctx.lineTo(5.5, S + 15); ctx.lineTo(-5.5, S + 15); ctx.closePath(); };
  torso(); ctx.fillStyle = C.skin; ctx.fill();
  ctx.save(); torso(); ctx.clip();
  rect("rgba(0,0,0,.3)", -7, S, 3.6, 16); rect("rgba(255,210,160,.14)", 3.3, S, 3.2, 16);          // luz do pôr do sol à direita
  rect("rgba(255,210,160,.13)", -5, S + 2, 4.7, 3.6); rect("rgba(255,210,160,.13)", 0.3, S + 2, 4.7, 3.6);   // peitoral
  rect("rgba(0,0,0,.32)", -5, S + 5.6, 4.7, 0.8); rect("rgba(0,0,0,.32)", 0.3, S + 5.6, 4.7, 0.8);
  rect("rgba(0,0,0,.25)", -0.2, S + 2, 0.4, 3.8); rect("#35200f", -3.2, S + 4.2, 1, 1); rect("#35200f", 2.2, S + 4.2, 1, 1);
  rect("rgba(0,0,0,.22)", -0.2, S + 6.6, 0.4, 8.4); rect("rgba(0,0,0,.2)", -3.4, S + 9.2, 6.8, 0.5); rect("rgba(0,0,0,.2)", -3.4, S + 12, 6.8, 0.5);   // abdômen
  rect("rgba(0,0,0,.2)", -5, S + 1, 4, 0.5); rect("rgba(0,0,0,.2)", 1, S + 1, 4, 0.5);          // clavículas
  ctx.restore();
  rect(C.dk, -2.3, S - 3.5, 4.6, 4); rect("rgba(0,0,0,.18)", -2.3, S - 1, 4.6, 1.2);             // pescoço
  ctx.strokeStyle = "#e8d9a8"; ctx.lineWidth = 0.6;                                              // colar com um pingente dourado
  ctx.beginPath(); ctx.moveTo(-2.8, S - 0.6); ctx.quadraticCurveTo(0, S + 5.2, 2.8, S - 0.6); ctx.stroke();
  rect("#d9a441", -0.6, S + 3.1, 1.2, 1.6);


  // cabeça
  rect("#2c1a10", -5.1, -39 + hy, 1, 6); rect("#2c1a10", 4.1, -39 + hy, 1, 6);                      // costeletas
  rect(C.skin, -4.2, -38.5 + hy, 8.4, 9); rect(C.dk, -4.2, -38.5 + hy, 1.4, 9); rect("rgba(255,210,160,.12)", 2.6, -38.5 + hy, 1.6, 9);
  rect("rgba(0,0,0,.22)", -4.2, -32.4 + hy, 8.4, 3);                                                 // barba por fazer
  rect(C.hair, -2.2, -32.2 + hy, 4.4, 0.7);                                                          // bigode
  rect(C.hair, -1.3, -29.9 + hy, 2.6, 1.4);                                                          // cavanhaque
  rect("#3a2214", -0.8, -35 + hy, 1.6, 2.6); rect("#6b4430", -0.2, -35 + hy, 0.5, 2);               // nariz
  rect("#8a5a40", 2.7, -38 + hy, 0.5, 3.2);                                                          // cicatriz na sobrancelha direita
  if (shut) { rect(C.hair, -3.3, -35.8 + hy, 2.5, 0.55); rect(C.hair, 0.8, -35.8 + hy, 2.5, 0.55); }  // olhos fechados
  else {
    const lk = Math.sin(t * 0.37) > 0.8 ? 0.5 : 0;                                                   // às vezes olha de lado
    rect("#e9dfcf", -3.3, -36.2 + hy, 2.5, 1); rect("#e9dfcf", 0.8, -36.2 + hy, 2.5, 1);
    rect(C.hair, -2.6 + lk, -36.2 + hy, 1.2, 1); rect(C.hair, 1.5 + lk, -36.2 + hy, 1.2, 1);
    rect("rgba(0,0,0,.55)", -3.4, -36.6 + hy, 2.7, 0.55); rect("rgba(0,0,0,.55)", 0.8, -36.6 + hy, 2.7, 0.55);   // pálpebra pesada (olhar de poucos amigos)
  }
  const bi = L(-36.6, k > 0.55 ? -37.6 : -37.9, Math.max(fr, k > 0.55 ? 1 : 0));                    // sobrancelhas: franzidas -> relaxadas
  ctx.strokeStyle = C.hair; ctx.lineWidth = 1.15; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(-4, -37.9 + hy); ctx.lineTo(-0.7, bi + hy); ctx.moveTo(4, -37.9 + hy); ctx.lineTo(0.7, bi + hy); ctx.stroke();
  if (k > 0.45) { rect("#2a120e", mX - 0.8, mY - 0.1, 1.6, 1.3); rect("#8a5040", mX - 1.2, mY + 0.1, 0.5, 0.8); rect("#8a5040", mX + 0.7, mY + 0.1, 0.5, 0.8); }   // boquinha da flauta
  else if (fr > 0.5) { rect("#a05a48", -1.8, mY, 3.6, 0.8); rect("#f1e6d4", -1.2, mY + 0.1, 2.4, 0.5); rect("#a05a48", -2.3, mY - 0.6, 0.7, 0.7); rect("#a05a48", 1.6, mY - 0.6, 0.7, 0.7); }   // sorriso
  else { rect("#a05a48", -1.6, mY + 0.1, 3.2, 0.7); rect("#a05a48", -2.1, mY + 0.6, 0.7, 0.7); rect("#a05a48", 1.4, mY + 0.6, 0.7, 0.7); }   // boca emburrada
  if (k < 0.3) {                                                                                     // graveto mascado no canto da boca
    ctx.save(); ctx.translate(1.3, mY + 0.3 + Math.sin(t * 2.6) * 0.2); ctx.rotate(-0.3 + Math.sin(t * 1.3) * 0.05);
    rect("#b58e55", 0, -0.45, 6.6, 0.9); rect("#8a6a38", 0, 0.1, 6.6, 0.35); rect("#e0c690", 6, -0.45, 0.6, 0.9);
    ctx.restore();
  }
  // cabelo curto e baixinho (a cabeça chega na altura do Malto)
  ctx.fillStyle = C.hair; roundPath(-5.1, -46 + hy, 10.2, 6.4, 2.6); ctx.fill();
  rect(C.hair, -5.1, -42 + hy, 1.1, 3.6); rect(C.hair, 4, -42 + hy, 1.1, 3.6);                       // laterais descendo até as costeletas
  for (let i = 0; i < 6; i++) rect(C.hair2, -4.2 + i * 1.7, -45.3 + hy + (i % 2) * 0.6, 0.9, 0.9);   // cachinhos/textura
  rect(C.hair, -4.6, -41 + hy, 9.2, 2.7);                                                            // franja: preenche o vão entre o cabelo e o rosto (antes dava pra ver o fundo)
  rect("rgba(255,255,255,.07)", -3.5, -45.4 + hy, 5, 0.9);

  // braços: cruzados (cara de mau) -> soltos (conversando) -> segurando a flauta
  const MSH = 7.2, SY = S + 2.5, MAL = 11;
  const POSE = {
    rel: [[[-MSH - 0.5, SY + 6.5], [-MSH - 0.3, SY + MAL + 1]], [[MSH + 0.5, SY + 6.5], [MSH + 0.3, SY + MAL + 1]]],
    crs: [[[-MSH - 0.4, SY + 7], [1.0, SY + 7.8]], [[MSH + 0.4, SY + 6], [-1.8, SY + 5]]],   // braços cruzados mais curtos: cotovelo alto e mão só até o meio do peito
    flt: [[[-9.2, S + 8], [-12, mY + 3.8]], [[8.8, S + 10], [-3.9, mY + 2.8]]],
  };
  const fa = ease01(Math.max(0, (k - 0.55) / 0.45));                                                // a flauta só aparece quando já está perto da boca
  if (k > 0.5 || F.st === "down") {                                                                 // flauta (por baixo das mãos)
    const A = POSE.flt[1][1], B = POSE.flt[0][1], dx = B[0] - A[0], dy = B[1] - A[1];
    ctx.globalAlpha = fa; ctx.lineCap = "round";
    ctx.strokeStyle = "#5b6370"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(A[0] - dx * 0.5, A[1] - dy * 0.5); ctx.lineTo(B[0] + dx * 0.5, B[1] + dy * 0.5); ctx.stroke();
    ctx.strokeStyle = "#d6dbe3"; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(A[0] - dx * 0.5, A[1] - dy * 0.5); ctx.lineTo(B[0] + dx * 0.5, B[1] + dy * 0.5); ctx.stroke();
    for (let q = 0; q < 5; q++) rect("#4a5160", A[0] + dx * (0.05 + q * 0.22), A[1] + dy * (0.05 + q * 0.22) - 0.4, 0.8, 0.8);   // chaves
    ctx.globalAlpha = 1; ctx.lineCap = "butt";
  }
  if (fa < 1) { ctx.globalAlpha = 1 - fa; rect("#d6dbe3", 3.4, S + 13.4, 1.1, 4.2); rect("#5b6370", 3.4, S + 17.2, 1.1, 0.5); ctx.globalAlpha = 1; }   // flauta presa na bermuda
  [0, 1].forEach(i => {                                                                              // 0 = braço da esquerda da tela
    const base = [0, 1].map(j => [L(POSE.crs[i][j][0], POSE.rel[i][j][0], fr), L(POSE.crs[i][j][1], POSE.rel[i][j][1], fr)]);
    const E = [L(base[0][0], POSE.flt[i][0][0], k), L(base[0][1], POSE.flt[i][0][1], k)], Hd = [L(base[1][0], POSE.flt[i][1][0], k), L(base[1][1], POSE.flt[i][1][1], k)];
    const sx = i ? MSH : -MSH;
    ctx.fillStyle = C.skin; roundPath(sx - 1.4, SY - 2.3, 2.8, 4.2, 1.3); ctx.fill();               // ombro
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = C.dk; ctx.lineWidth = 3.1; ctx.beginPath(); ctx.moveTo(sx, SY); ctx.lineTo(E[0] + 0.3, E[1] + 0.4); ctx.lineTo(Hd[0] + 0.3, Hd[1] + 0.4); ctx.stroke();
    ctx.strokeStyle = C.skin; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(sx, SY); ctx.lineTo(E[0], E[1]); ctx.lineTo(Hd[0], Hd[1]); ctx.stroke();
    ctx.strokeStyle = "rgba(255,210,160,.16)"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(sx - 0.5, SY - 0.4); ctx.lineTo(E[0] - 0.6, E[1] - 0.5); ctx.stroke();   // luz no bíceps
    ctx.fillStyle = C.lt; ctx.beginPath(); ctx.arc(Hd[0], Hd[1], 1.35, 0, 7); ctx.fill();            // mão
    ctx.lineCap = "butt"; ctx.lineJoin = "miter";
  });

  // notinhas saindo da flauta
  if (F.st === "play") for (let j = 0; j < 4; j++) {
    const p = (t * 0.6 + j * 0.25) % 1, nx = -19 - p * 11 + Math.sin(p * 8 + j * 2) * 2.5, ny = mY + 3 - p * 28, a = (1 - p) * Math.min(1, p * 6);
    ctx.globalAlpha = a; ctx.fillStyle = ["#ffd166", "#9fd3ff", "#ff9ecb", "#b6f5a8"][j];
    ctx.beginPath(); ctx.ellipse(nx, ny, 1.5, 1.1, -0.4, 0, 7); ctx.fill();
    rect(ctx.fillStyle, nx + 1.0, ny - 5, 0.7, 5); rect(ctx.fillStyle, nx + 1.6, ny - 5, 1.7, 0.8); rect(ctx.fillStyle, nx + 2.3, ny - 4.1, 0.9, 1);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
function drawTiaoSide(now) {                                                            // Pedro andando: de perfil, com a mesma estrutura de corpo do pescador na altura máxima (a do Malto)
  const t = now / 1000, K = TWK, C = TIAO_C, gs = Math.sin(K.ph), gc = Math.cos(K.ph);
  const GA = 0.5 * K.amp, KB = 0.34 * K.amp, LT = 9.5;                                  // GA: abertura das coxas; KB: dobra do joelho; LT: coxa e canela (9,5 cada = 19)
  const dy = 19 * (1 - Math.cos(GA * gs));                                              // o quadril desce quando as pernas abrem (o pé fica no chão)
  const by = Math.sin(t * 1.5 + 1) * 0.3 * (1 - K.amp), S = -35 + by + dy, hipY = -19 + dy;   // S: linha dos ombros (a mesma do Malto)
  const hy0 = S - 8.5 - 0.35 * Math.abs(gc) * K.amp;                                    // topo do rosto (a cabeça quica de leve a cada passo)
  const SH = "#2f627d", SHD = "#27526a", SHH = "#1f4559";                               // bermuda: frente, trás e barra/cós
  ctx.save(); ctx.translate(TX, PIER_Y); ctx.scale(K.face, 1);
  softShadow(-7 * K.face, 1.4, 17, 2.6, 0.34, 3); softShadow(0, 1.1, 8, 1.7, 0.5, 3);
  const leg = (th, kn, col, sh, front) => {                                             // coxa gira no quadril (com a perna da bermuda), canela gira no joelho
    ctx.save(); ctx.translate(0, hipY); ctx.rotate(th);
    rect(col, -2.3, 0, 4.6, LT + 0.4);
    rect(sh, -3.3, -0.6, 6.6, 8.6); rect(SHH, -3.3, 6.6, 6.6, 1.4);                     // perna da bermuda + barra
    rect("rgba(10,20,40,.28)", -3.3, -0.6, 1.8, 8.6);
    if (front) rect("rgba(255,255,255,.1)", 1.8, -0.6, 1.4, 6);
    ctx.translate(0, LT); ctx.rotate(kn);
    rect(col, -2.3, 0, 4.6, LT - 1); rect("rgba(0,0,0,.22)", -2.3, 0, 1.3, LT - 1);      // canela
    if (front) rect("rgba(255,210,160,.12)", 1.2, 0.5, 0.7, 5);                          // luz na canela
    rect(col, -2.3, LT - 2.2, 6.6, 1.4);                                                // pé apontando para a frente
    rect("#1a120c", -2.5, LT - 1, 7, 1);                                                // sola do chinelo
    rect("#1a120c", 1.0, LT - 2.7, 1.1, 1.7); rect("#1a120c", -1.8, LT - 2.0, 3.2, 0.5);   // tira do chinelo
    ctx.restore();
  };
  leg(-GA * gs, KB * Math.max(0, gc), C.dk, SHD, false); leg(GA * gs, KB * Math.max(0, -gc), C.skin, SH, true);   // perna de trás (escura) e da frente
  const wh = 5.4 - by;                                                                  // cós: cobre o quadril e esconde a junta das pernas
  rect(SH, -5.8, S + 13.8, 11.6, wh); rect("rgba(10,20,40,.3)", -5.8, S + 13.8, 3, wh); rect("rgba(255,255,255,.1)", 3.6, S + 13.8, 2.2, wh);
  rect(SHH, -5.8, S + 13.8, 11.6, 1.4); rect("#e6d9b8", 3.8, S + 15.2, 0.8, 3); rect("#e6d9b8", 3.1, S + 15, 2.2, 0.7);   // cós e cordinha
  ctx.save(); ctx.translate(0, hipY); ctx.rotate(0.05 * K.amp); ctx.translate(0, -hipY);   // tronco inclina de leve para a frente
  const arm = (th, col, hand, front) => {                                               // braço em duas partes, com o cotovelo dobrando para a frente
    ctx.save(); ctx.translate(0.3, S + 3); ctx.rotate(th);
    rect(col, -1.8, -1, 3.6, 7.4); if (front) rect("rgba(255,210,160,.18)", 0.2, 0.4, 0.8, 4.6); else rect("rgba(0,0,0,.2)", -1.8, -1, 1, 7.4);
    ctx.translate(0, 6.3); ctx.rotate(-0.1 - 0.32 * K.amp);
    rect(col, -1.6, 0, 3.2, 6.2); rect("rgba(0,0,0,.2)", -1.6, 0, 1, 6.2); rect(hand, -1.7, 5.6, 3.4, 3.1); rect("rgba(0,0,0,.18)", -1.7, 7.9, 3.4, 0.8);   // antebraço e punho
    ctx.restore();
  };
  arm(GA * gs * 1.1, C.dk, C.dk, false);                                                // braço de trás (atrás do tronco)
  const tor = () => { ctx.beginPath(); ctx.moveTo(-5.4, S); ctx.lineTo(6, S); ctx.lineTo(5.8, S + 5); ctx.lineTo(5.2, S + 10); ctx.lineTo(5, S + 15.5); ctx.lineTo(-5, S + 15.5); ctx.lineTo(-5.4, S + 6); ctx.closePath(); };
  tor(); ctx.fillStyle = C.skin; ctx.fill(); ctx.save(); tor(); ctx.clip();
  rect("rgba(0,0,0,.3)", -6, S, 3.2, 16); rect("rgba(255,210,160,.14)", 3.2, S, 3, 16);   // sombra nas costas, luz do pôr do sol na frente
  rect("rgba(255,210,160,.15)", 0.8, S + 2, 5, 3.4); rect("rgba(0,0,0,.3)", 0.8, S + 5.4, 5.2, 0.7); rect("#35200f", 3.9, S + 4.2, 1, 1);   // peitoral e mamilo
  rect("rgba(0,0,0,.2)", 2.2, S + 8.6, 3.4, 0.5); rect("rgba(0,0,0,.2)", 2.2, S + 11.2, 3.4, 0.5); rect("rgba(0,0,0,.16)", 2.2, S + 13.6, 3, 0.5);   // abdômen
  rect("rgba(0,0,0,.14)", -3.4, S + 3, 2.6, 0.6); rect("rgba(0,0,0,.14)", -3.4, S + 6, 2.6, 0.6);   // costelas
  ctx.restore();
  ctx.strokeStyle = "#e8d9a8"; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-0.6, S - 0.8); ctx.quadraticCurveTo(4.6, S - 0.2, 5.7, S + 3.6); ctx.stroke();   // colar com o pingente dourado
  rect("#d9a441", 5.2, S + 3.4, 1.1, 1.6);
  arm(-GA * gs * 1.1, C.skin, C.lt, true);                                              // braço da frente (por cima do tronco)
  ctx.fillStyle = C.skin; roundPath(-2.5, S - 0.7, 5.2, 5.4, 1.9); ctx.fill();          // ombro (deltoide) cobrindo a junta
  rect("rgba(255,210,160,.2)", 0.4, S - 0.1, 1.6, 0.7);
  rect(C.dk, -3, S - 3.4, 4.6, 4.2); rect("rgba(0,0,0,.2)", -3, S - 1.2, 4.6, 1.2);     // pescoço
  // cabeça de perfil: rosto + nuca inteiros (a nuca e o queixo antes ficavam sem preenchimento)
  const mY = hy0 + 7.1, blink = (t + 1.3) % 4.4 > 4.28;
  rect(C.skin, -4, hy0, 9.4, 9); rect(C.dk, -4, hy0, 1.5, 9);                           // rosto e sombra atrás
  rect("rgba(0,0,0,.22)", -2.6, hy0 + 6, 8, 3);                                          // barba por fazer na mandíbula
  rect("rgba(255,210,160,.12)", 3.6, hy0, 1.8, 9);                                       // luz na frente do rosto
  rect(C.dk, -1.7, hy0 + 3.2, 1.9, 2.8); rect("rgba(0,0,0,.35)", -1.1, hy0 + 3.9, 0.8, 1.2);   // orelha
  if (blink) rect(C.hair, 2.3, hy0 + 2.8, 2.6, 0.55);
  else { rect("#e9dfcf", 2.4, hy0 + 2.4, 2.4, 1); rect(C.hair, 3.6, hy0 + 2.4, 1.2, 1); rect("rgba(0,0,0,.55)", 2.2, hy0 + 2, 2.9, 0.55); }   // olho com pálpebra pesada
  ctx.strokeStyle = C.hair; ctx.lineWidth = 1.15; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(1.4, hy0 + 0.9); ctx.lineTo(5.2, hy0 + 1.8); ctx.stroke();   // sobrancelha franzida
  rect("#8a5a40", 5, hy0 + 1.2, 0.5, 2.2);                                               // cicatriz
  rect(C.skin, 5.2, hy0 + 3.9, 1.8, 2.6); rect(C.dk, 5.2, hy0 + 6, 1.8, 0.5); rect(C.lt, 5.4, hy0 + 4.1, 0.6, 1.4);   // nariz
  rect(C.hair, 3.2, hy0 + 6.2, 2.4, 0.6);                                                // bigode
  rect("#a05a48", 3.2, mY + 0.5, 2.3, 0.7); rect("#a05a48", 2.7, mY + 1.0, 0.6, 0.6);   // boca emburrada
  rect(C.hair, 3.8, hy0 + 8.4, 2.2, 1.5);                                                // cavanhaque
  ctx.save(); ctx.translate(4.6, mY + 0.7 + Math.sin(t * 2.6) * 0.2); ctx.rotate(0.15 + Math.sin(t * 1.3) * 0.05);   // graveto no canto da boca
  rect("#b58e55", 0, -0.45, 5, 0.9); rect("#8a6a38", 0, 0.1, 5, 0.35); rect("#e0c690", 4.5, -0.45, 0.5, 0.9);
  ctx.restore();
  ctx.fillStyle = C.hair; roundPath(-4.8, hy0 - 7.5, 10.6, 6.8, 2.8); ctx.fill();        // cabelo curto no topo
  roundPath(-4.8, hy0 - 2.5, 3.2, 8.2, 1.3); ctx.fill();                                 // e descendo pela nuca até atrás da orelha (cobre a parte que ficava cortada)
  rect(C.hair, -1.6, hy0 - 1, 1, 3.2);                                                   // costeleta na frente da orelha
  rect(C.hair, -3.4, hy0 - 0.9, 9.2, 0.7);                                               // linha da testa
  for (let i = 0; i < 5; i++) rect(C.hair2, -3.6 + i * 1.8, hy0 - 6.8 + (i % 2) * 0.6, 0.9, 0.9);   // textura
  rect("rgba(255,255,255,.07)", -3, hy0 - 6.8, 5, 0.9);
  ctx.restore(); ctx.restore();
}
function drawTiaoUI(now) {
  const nameY = PIER_Y - 58;
  text(TIAO_NAME, TX, nameY, "#ffb86b", "center");
  if (tTalk) {
    const full = tTalk.text, shown = Math.min(full.length, Math.floor(tTalk.t * TYPE_CPS));
    const lines = wrapLines(full, 24), lh = 11, w = Math.ceil(24 * UI_CH) + 14, hgt = lines.length * lh + 9;
    const bx = Math.round(TX - w / 2), byy = Math.round(nameY - 14 - hgt);
    rect("#ffb86b", bx - 1, byy - 1, w + 2, hgt + 2); rect("#1f1410", bx, byy, w, hgt);
    ctx.fillStyle = "#ffb86b"; ctx.beginPath(); ctx.moveTo(TX - 5, byy + hgt + 1); ctx.lineTo(TX + 5, byy + hgt + 1); ctx.lineTo(TX, byy + hgt + 7); ctx.fill();
    ctx.fillStyle = "#1f1410"; ctx.beginPath(); ctx.moveTo(TX - 4, byy + hgt); ctx.lineTo(TX + 4, byy + hgt); ctx.lineTo(TX, byy + hgt + 5); ctx.fill();
    let left = shown;
    lines.forEach((l, i) => { text(l.slice(0, Math.max(0, left)), bx + 7, byy + 11 + i * lh, "#fff"); left -= l.length + 1; });
    if (shown >= full.length && Math.floor(now / 400) % 2) text("E >", bx + w - 5, byy + hgt - 2, "#ffd166", "right");
  } else if (tNear()) keyHint(TX, nameY - 28, now);
}
// zoom: reaproveita o quadro pronto (assim o reflexo continua certo) e redesenha só um pedaço dele, ampliado
const zb = document.createElement("canvas"); let zctx = null;
function zoomView(z, fx, fy, side = 0.5) {                       // side: onde o personagem fica na tela (0 = esquerda, 0.5 = meio)
  if (!zctx || zb.width !== buf.width || zb.height !== buf.height) { zb.width = buf.width; zb.height = buf.height; zctx = zb.getContext("2d"); }
  zctx.setTransform(1, 0, 0, 1, 0, 0); zctx.drawImage(buf, 0, 0);
  const sw = W / z, sh = H / z, sx = Math.max(0, Math.min(W - sw, fx - side * sw)), sy = Math.max(0, Math.min(H - sh, fy - sh / 2));
  lastView = { z, sx, sy };
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(zb, sx * S, sy * S, sw * S, sh * S, 0, 0, W, H);
}
// ---------- Puxando o peixe: inclina para trás, vara envergada pela força do peixe e manivela girando ----------
let reelAng = 0, zs = 1, zfy = 144, zside = 0.3, lastView = { z: 1, sx: 0, sy: 0 };           // ângulo da manivela; zs: escala do zoom atual (1 = sem zoom); lastView: recorte usado no quadro
function reelPose(now, ang = reelAng, inside = fish && fp.y > bar.y && fp.y < bar.y + bar.h) {   // peixe dentro da barra = vara mais folgada; fora = peixe puxando forte
  const pull = (inside ? 0.55 : 0.95) + 0.2 * Math.sin(now / 95);
  const tipA = -1.0 + 0.2 * (pull - 0.5) + 0.03 * Math.sin(now / 130);   // ângulo da ponta: abaixa quando o peixe puxa forte
  return { rod: tipA + pull * 0.25, arm: -0.25, lean: -0.13 - 0.03 * Math.sin(now / 110), off: 0, flex: pull, crank: ang };
}
// ---------- Boia: uma bolinha vermelha e branca flutuando de verdade: sobe e desce devagar com a água, balança de leve ----------
// A água (copiada do próprio lago, como nos postes) cobre a parte de baixo. Quando o peixe morde, a boia é puxada para baixo em trancos.
const BOB_R = 3.6;
const surfY = (now, bx) => BOB_Y + 1 + 0.45 * Math.sin(now / 820 + bx * 0.2) + 0.22 * Math.sin(now / 470 + 1.3);   // altura da água ali, ondulando devagar
function bobPose(bx, now, st, land) {                                           // onde a boia está: cy = centro, wl = linha da água, ang = inclinação, pull = quanto está sendo puxada
  const wl = surfY(now, bx);
  let pull = 0;
  if (st === "bite") {                                                    // peixe puxando: tranco rápido para baixo, volta mais devagar, e de novo
    const a = (now / 1000 * 1.9) % 1, e = a < 0.22 ? 1 - Math.pow(1 - a / 0.22, 2) : Math.pow(1 - (a - 0.22) / 0.78, 2.2);
    pull = 1.4 + 4.6 * e * (0.8 + 0.2 * Math.sin(now / 260));
  } else if (st === "reel") pull = 1.2 + 0.9 * Math.abs(Math.sin(now / 150));   // peixe fisgado: a boia fica meio afundada, tremendo
  const u = land ? Math.max(0, (now - land) / 1000) : 9;                   // tempo desde que a boia caiu na água
  const spring = u < 2.2 ? 4.2 * Math.exp(-3.1 * u) * Math.sin(10.5 * u) : 0;   // elástico: afunda, quica para cima e vai amortecendo (não cai "durona")
  const cy = wl - 0.7 + 0.28 * Math.sin(now / 1150 + 2) + pull + spring;
  const ang = (u < 2.2 ? 0.5 * Math.exp(-2.6 * u) * Math.sin(9 * u + 1) : 0) + 0.16 * Math.sin(now / 1350 + bx) + 0.07 * Math.sin(now / 610) + (pull ? 0.18 * Math.sin(now / 90) : 0);   // balança de leve na água
  return { cy, wl, ang, pull, spring, x: bx + 0.3 * Math.sin(now / 1500 + bx) + (pull ? 0.5 * Math.sin(now / 70) : 0) };
}
function drawBall(bx, cy, ang = 0) {                                       // a bolinha inteira: metade de cima vermelha, de baixo branca, com brilho (sem contorno)
  const R = BOB_R;
  ctx.save(); ctx.beginPath(); ctx.arc(bx, cy, R, 0, Math.PI * 2); ctx.clip();
  ctx.translate(bx, cy); ctx.rotate(ang); ctx.translate(-bx, -cy);
  rect("#e63946", bx - R - 1, cy - R - 1, 2 * R + 2, R + 1);                // metade de cima
  rect("#f4f1ea", bx - R - 1, cy, 2 * R + 2, R + 1);                        // metade de baixo
  rect("#a82a36", bx - R - 1, cy - 1.1, 2 * R + 2, 1.1);                    // sombra da faixa vermelha, perto do meio
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(bx, cy, R, 0, Math.PI * 2); ctx.clip();
  rect("rgba(30,10,30,.2)", bx + 1.4, cy - R, R, 2 * R);                    // lado direito um pouco mais escuro (volume)
  rect("rgba(255,255,255,.85)", bx - 1.9, cy - 2.2, 1.3, 0.9);              // brilho
  ctx.restore();
}
function drawBobber(bx, now, st, land) {                                   // boia na água
  const P = bobPose(bx, now, st, land), R = BOB_R, cy = P.cy, wl = P.wl; bx = P.x;
  const wxp = (W - WORLD) / 2 + camX, x0 = bx - R - 1, x1 = bx + R + 1;
  drawBall(bx, cy, P.ang);
  const under = Math.max(0, cy + R - wl);                                  // quanto da bolinha está debaixo d'água
  if (under > 0) {
    const hh = under + 3;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, wl, x1 - x0, hh); ctx.clip();
    ctx.fillStyle = "rgba(60,120,205,.8)";                                 // a parte debaixo d'água fica azulada
    ctx.beginPath(); ctx.arc(bx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const T = ctx.getTransform(), sy = (Math.max(cy + R, wl) + 3) * T.d + T.f;   // (com zoom: usa a câmera atual) água de verdade, copiada de logo abaixo da boia (mesma cor, ondas e brilho)
    for (let x = Math.floor(x0); x < x1; x++) {                            // colunas de 1px: o topo da água ondula
      const top = wl + 0.5 * Math.sin(now / 420 + x * 1.35) + 0.2 * Math.sin(now / 230 + x * 2.3), h = Math.max(0.6, wl + hh - top);
      ctx.globalAlpha = 0.6;
      ctx.drawImage(buf, x * T.a + T.e, sy, T.a, h * T.d, x, top, 1, h);
      ctx.globalAlpha = 1;
      rect("rgba(225,240,250,.5)", x, top, 1, 0.8);                        // borda de cima mais clara (contraste)
    }
    rect("rgba(40,90,170,.22)", x0, wl + 0.6, x1 - x0, hh - 0.6);          // um toque de azul sobre tudo que está debaixo da água
  }
  ctx.lineWidth = 0.6;                                                     // ondinhas bem lentas saindo da boia (mais fortes quando o peixe puxa)
  const amp = 1 + P.pull * 0.35;
  ctx.strokeStyle = "rgba(255,255,255,.38)"; ctx.beginPath(); ctx.ellipse(bx, wl + 0.4, R + 1.5 + 0.6 * Math.sin(now / 700), 1.4, 0, 0, 7); ctx.stroke();
  for (let n = 0; n < 2; n++) {
    const k = (now / (st === "bite" ? 900 : 2600) + n * 0.5) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${(0.3 + 0.08 * P.pull) * (1 - k)})`;
    ctx.beginPath(); ctx.ellipse(bx, wl + 0.4, R + 2 + k * 9 * amp, 1.1 + k * 1.7 * amp, 0, 0, 7); ctx.stroke();
  }
}
function drawLine(tx, ty, bx, now, st, land) {
  const P = bobPose(bx, now, st, land);
  ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 0.7;
  const top = P.cy - BOB_R + 0.5, slack = (st === "bite" || st === "reel" ? 6 : 12) + (land ? 5 * Math.exp(-4 * Math.max(0, (now - land) / 1000)) : 0);   // linha mais esticada quando o peixe puxa
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + P.x) / 2, (ty + top) / 2 + slack, P.x, top); ctx.stroke();
  drawBobber(bx, now, st, land);
  if (st === "bite") text("!", bx, BOB_Y - 24, "#ffd166", "center");
}
function drawOther(p, now) {
  const dx = p.tx - p.x; p.x += dx * 0.25;
  p.amp = (p.amp || 0) + ((Math.abs(dx) > 0.4 && p.state === "walk" ? 1 : 0) - (p.amp || 0)) * 0.25;
  const dt = Math.min(0.1, (now - (p.lt || now)) / 1000); p.lt = now;
  if (p.pst !== p.state) {                                       // mudou de estado: começa a animação certa
    p.pst = p.state;
    if (p.state === "cast") { p.cs = { t: 0, rel: null, hang: null, k0: p.rd ? p.rd.k : 1 }; p.c0 = now; p.landed = false; }
    if (p.state === "reel") p.ra = 0;
    if (p.state === "wait" && !p.landed) { p.landed = true; p.land = now; fxs.push({ x: p.bx, t0: now }); }   // o servidor mudou de estado antes da animação terminar
  }
  let pose = null;
  const rd = p.rd || (p.rd = newRod(1));                       // quem não está pescando anda com a vara nas costas
  if (p.state !== "walk") { rd.k = 0; rd.v = 0; rd.st = 9; } else stepRod(rd, 1, dt);
  if (p.state === "walk") pose = rodPose(rd, { rod: REST, arm: 0, lean: 0, off: 0, flex: 0 });
  if (p.state === "cast" && p.cs) {
    p.cs.t = (now - p.c0) / 1000;
    pose = castPose(p.cs.t, p.cs.k0);
    if (!p.landed && p.cs.t >= CAST_RELEASE + CAST_FLIGHT) { p.landed = true; p.land = now; fxs.push({ x: p.bx, t0: now }); }   // respingo quando a boia dele cai
  } else if (p.state === "reel") {
    const inside = Math.sin(now / 900 + p.x) > -0.2;             // o servidor não manda a barra do minigame: simula o vai-e-vem
    p.ra += (inside ? 14 : -3) * dt;
    pose = reelPose(now, p.ra, inside);
  }
  p.tip = drawFisher(p.x, p.dir, p.shirt || p.color, "#2d6a4f", p.amp, pose, { pants: p.pants, hs: hScale(p.h) });   // o pescador entra no reflexo
}
function drawOtherLine(p, now) {                                 // linha e nome são desenhados por cima da água
  if (p.state === "cast" && p.cs && p.tip) drawCast(p.tip, p.cs, p.bx);
  else if (p.state !== "walk" && p.tip) drawLine(p.tip.x, p.tip.y, p.bx, now, p.state, p.land);
  text(p.name, p.x, PIER_Y - FISHER_TOP * hScale(p.h) - 6, "#cfe8ff", "center");
}

// ---------- Arremesso da vara: recuo -> chicote -> soltura; a boia voa em arco e cai com respingo ----------
const lerp = (a, b, k) => a + (b - a) * k, easeOut = k => 1 - (1 - k) * (1 - k), easeIn = k => k * k;
const easeInOut = k => k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
const CAST_DRAW = 0.42, CAST_WHIP = 0.17, CAST_SWING = 1.0, CAST_RELEASE = CAST_DRAW + CAST_WHIP, CAST_FLIGHT = 0.6;   // segundos: tira a vara das costas -> chicote -> (a soltura acontece no fim do chicote)
// O arremesso começa com a vara nas costas: a mão vai atrás, puxa a vara por cima do ombro (é o "recuo" do lançamento),
// segura um instante no alto e chicoteia para a frente sem parar. k0 = onde a vara estava (1 = nas costas).
function castPose(c, k0 = 1) {
  if (c < CAST_DRAW) {
    const u = c / CAST_DRAW, e = easeInOut(u), sv = (SL0 - k0) * (u < 0.5 ? 4 * u : 4 * (1 - u)) / CAST_DRAW;   // sv: velocidade (a vara envergando)
    return rodPose({ k: lerp(k0, SL0, e), v: sv, st: 9 }, { rod: REST, arm: 0, lean: 0, off: 0, flex: 0 });
  }
  const w = c - CAST_DRAW;
  if (w < CAST_WHIP) { const k = w / CAST_WHIP, e = easeIn(k);              // chicote rápido para a frente (a vara envergando)
    return { rod: lerp(-2.0, -0.3, e), arm: lerp(RA, 0.3, e), lean: lerp(spl(K_LEAN, SL0), 0.18, e), off: lerp(spl(K_OFF, SL0), 0.7, e), sb: lerp(spl(K_BOB, SL0), 0, e), flex: 1.2 * Math.sin(Math.PI * k) }; }
  const k = easeOut(Math.min(1, (w - CAST_WHIP) / (CAST_SWING - CAST_DRAW - CAST_WHIP)));   // follow-through: a vara baixa um pouco, volta e balança até parar
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
  drawBall(bx, by - 0.3);
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

// ---------- Tamanho dos peixes: cada espécie tem uma faixa em cm [mínimo, máximo]; cada peixe pescado sorteia um tamanho dentro dela ----------
// Peixe pequeno = zoom forte no pescador (para ver de perto); peixe grande = zoom leve. Para ajustar, mexa em FISH_SIZE (ou mande "size": [min, max] no servidor).
const FISH_SIZE = { "peixe-bandeira": [10, 20], "piranha-vermelha": [16, 30], "peixe-voador": [20, 34], "budiao-verde": [32, 52],
  "peixe-cofre": [10, 22], "peixe-listrado": [18, 34], "budiao-listrado": [22, 40], "peixe-zebra": [20, 38], "garoupa-pintada": [35, 70], "salmao": [50, 90], "peixe-tigre": [25, 45], "garoupa-azul": [40, 80], "peixe-dourado-dentuco": [40, 70], "lagosta": [20, 40] };
const sizeRange = f => (f && f.size) || FISH_SIZE[f && f.id] || (f ? [f.difficulty * 3 + 8, f.difficulty * 3 + 22] : [20, 30]);
const rollSize = f => { const [lo, hi] = sizeRange(f), u = (Math.random() + Math.random()) / 2; return Math.round((lo + (hi - lo) * u) * 10) / 10; };   // média de dois sorteios: o comum é perto do meio, os extremos são raros
const FISH_K = { "peixe-bandeira": 2.4e-5, "piranha-vermelha": 3.2e-5, "peixe-voador": 1.1e-5, "budiao-verde": 2.3e-5,
  "peixe-cofre": 6e-05, "peixe-listrado": 2.2e-05, "budiao-listrado": 2.3e-05, "peixe-zebra": 1.5e-05, "garoupa-pintada": 1.6e-05, "salmao": 1e-05, "peixe-tigre": 2.4e-05, "garoupa-azul": 1.6e-05, "peixe-dourado-dentuco": 1.3e-05, "lagosta": 2.4e-05 };   // kg = K * cm^3 (cada espécie tem o corpo mais fino ou mais gordinho)
const rollKg = (f, cm) => Math.round((FISH_K[f && f.id] || 2e-5) * Math.pow(cm, 3) * (0.9 + Math.random() * 0.2) * 100) / 100;   // peso pelo tamanho, com ±10% de variação entre peixes do mesmo tamanho
const fmtCm = v => v.toFixed(1).replace(".", ",") + " cm";
const fmtKg = v => v.toFixed(2).replace(".", ",") + " kg";
const PX_PER_CM = 1.9;                                                         // tamanho do peixe na tela (px do jogo por cm)
const ZOOM_SMALL = 2.05, ZOOM_BIG = 1.12, ZOOM_SMALL_CM = 12, ZOOM_BIG_CM = 50;   // zoom ao comemorar: 2,05x num peixe de 12 cm ... 1,12x num de 50 cm
const catchZoom = cm => ZOOM_SMALL + (ZOOM_BIG - ZOOM_SMALL) * Math.pow(Math.max(0, Math.min(1, (cm - ZOOM_SMALL_CM) / (ZOOM_BIG_CM - ZOOM_SMALL_CM))), 0.85);
let catchCm = 0, catchKg = 0;                                                  // tamanho e peso do peixe que acabou de ser pescado

// ---------- Dinheiro (F$), inventário de peixes e venda para o Malto ----------
// O dinheiro é guardado em CENTAVOS (inteiro). O preço de cada peixe vem da dificuldade dele (PRICE_BY_DIFF), ou de um "price" (em centavos) na lista de peixes do servidor.
// Tudo fica salvo no navegador (localStorage). [I] abre o inventário; perto do Malto, [E] abre a venda.
const PRICE_BY_DIFF = { 1: 650, 2: 1400, 3: 3250, 4: 6800, 5: 14500 };       // F$6,50 / 14,00 / 32,50 / 68,00 / 145,00
const priceOf = f => f ? (f.price != null ? f.price : PRICE_BY_DIFF[f.difficulty] || 500) : 0;
const fmtMoney = c => { c = Math.max(0, Math.round(c)); return "F$" + String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + String(c % 100).padStart(2, "0"); };
let money = 0, inv = {};
try { money = Math.max(0, parseInt(localStorage.getItem("money"), 10) || 0); const sv = JSON.parse(localStorage.getItem("inv") || "{}"); for (const k in sv) if (sv[k] > 0) inv[k] = sv[k] | 0; } catch (e) {}
const saveWallet = () => { try { localStorage.setItem("money", String(money)); localStorage.setItem("inv", JSON.stringify(inv)); } catch (e) {} };
const invCount = () => Object.values(inv).reduce((a, b) => a + b, 0);
const fishById = id => fishList.find(f => f.id === id);
const invValue = () => Object.keys(inv).reduce((a, id) => a + inv[id] * priceOf(fishById(id)), 0);
const pickOf = arr => arr[Math.random() * arr.length | 0];
const SHOP_HELLO = ["Mostra o que pescou. Pago na hora, em F$.", "Peixe fresco? Pode colocar no balcão... quer dizer, na caixa.", "Hum, cheiro de maré. Vamos ver o que você trouxe."];
const SHOP_EMPTY = ["Sem peixe, sem F$. Volta quando pescar alguma coisa.", "Eu compro peixe, sabia? Pesque um pouco e me procure."];
const SHOP_SOLD = ["Negócio fechado. Peixe bom, esse.", "Fresco mesmo. Aceito.", "Paguei justo, pescador. Cada escama conta.", "Boa pesca. Esse some rapidinho."];
const SHOP_BYE = ["Volte quando o mar render mais.", "Até a próxima maré, pescador."];
const BAG = { open: false, mode: "inv", sel: 0, geo: null };              // mode: "inv" (só ver) ou "shop" (vender ao Malto)
const bagRows = () => fishList.filter(f => inv[f.id] > 0);                 // inventário e venda: só os peixes que você tem
function openBag(mode) {
  if (BAG.open && BAG.mode === mode) return;
  BAG.open = true; BAG.mode = mode; BAG.sel = 0; BAG.geo = null;
  for (const k in keys) keys[k] = false;                                   // para de andar enquanto olha a mochila
  if (typeof PH !== "undefined") PH.open = false;
  SND.play("step_wood_1", { vol: 0.12, rate: 2.2, jitter: 0.1 });
}
function closeBag(bye) {
  if (!BAG.open) return;
  const wasShop = BAG.mode === "shop"; BAG.open = false; BAG.geo = null;
  if (bye && wasShop && mNear()) maltoSay(pickOf(SHOP_BYE));
}
function sellFish(f, n) {
  const have = inv[f.id] | 0; n = Math.min(n, have); if (n <= 0) return;
  const total = n * priceOf(f);
  inv[f.id] = have - n; if (inv[f.id] <= 0) delete inv[f.id];
  money += total; saveWallet();
  SND.play("catch_chime", { vol: 0.4, jitter: 0 }); kick(0.25);
  say("Vendeu " + n + "x " + f.name + " por " + fmtMoney(total));
  maltoSay(pickOf(SHOP_SOLD));
  const rows = bagRows();
  if (!rows.length) closeBag(false); else BAG.sel = Math.min(BAG.sel, rows.length - 1);
}
function bagKey(e) {                                                       // teclas enquanto a mochila/venda está aberta
  const rows = bagRows(), f = rows[BAG.sel];
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.code === "Escape" || (BAG.mode === "inv" && e.code === "KeyI")) { stop(); if (!e.repeat) closeBag(true); return; }
  if (e.code === "ArrowUp" || e.code === "KeyW") { stop(); if (rows.length) BAG.sel = (BAG.sel + rows.length - 1) % rows.length; return; }
  if (e.code === "ArrowDown" || e.code === "KeyS") { stop(); if (rows.length) BAG.sel = (BAG.sel + 1) % rows.length; return; }
  if (BAG.mode !== "shop") return;
  if ((e.code === "KeyE" || e.code === "Enter") && !e.repeat) { stop(); if (f) sellFish(f, 1); return; }
  if (e.code === "KeyQ" && !e.repeat) { stop(); if (f) sellFish(f, inv[f.id]); return; }                  // vende todos desse tipo
  if (e.code === "KeyR" && !e.repeat) { stop(); rows.slice().forEach(r => sellFish(r, inv[r.id] | 0)); return; }   // vende tudo
  if (e.code === "KeyC" && !e.repeat) { stop(); closeBag(false); talkLore(); return; }                 // volta a conversar
}
function bagPointer(lx, ly) {                                              // toque/clique: seleciona a linha; tocar na já selecionada vende 1; fora do painel fecha
  const g = BAG.geo; if (!g) return true;
  if (lx < g.x || lx > g.x + g.w || ly < g.y || ly > g.y + g.h) { closeBag(true); return true; }
  const i = Math.floor((ly - g.rowY) / g.rowH), rows = bagRows();
  if (i >= 0 && i < rows.length) { if (BAG.sel === i && BAG.mode === "shop") sellFish(rows[i], 1); else BAG.sel = i; }
  else if (BAG.mode === "shop" && ly >= g.y + g.h - 16) rows.slice().forEach(r => sellFish(r, inv[r.id] | 0));   // toque na linha de baixo: vende tudo
  return true;
}
function drawBag(now) {
  if (!BAG.open) return;
  const shop = BAG.mode === "shop", rows = bagRows(), RH = 32, pw = 256, top = 30;
  const ph = top + Math.max(1, rows.length) * RH + (shop ? 44 : 30), x = Math.round(shop ? W - pw - 10 : (W - pw) / 2), y = Math.round(shop ? 58 : (H - ph) / 2), acc = shop ? "#9fd3ff" : "#ffd166";
  BAG.geo = { x, y, w: pw, h: ph, rowY: y + top, rowH: RH };
  ctx.globalAlpha = 0.96; rect(acc, x - 1, y - 1, pw + 2, ph + 2); rect("#0f1624", x, y, pw, ph); ctx.globalAlpha = 1;
  text(shop ? "Malto compra peixe" : "Inventário", x + 8, y + 14, acc);
  text(fmtMoney(money), x + pw - 8, y + 14, "#8be28b", "right");
  rect("rgba(255,255,255,.18)", x + 6, y + 20, pw - 12, 1);
  if (!rows.length) text("Nenhum peixe ainda.", x + 8, y + top + 16, "#9aa6b8");
  rows.forEach((f, i) => {
    const ry = y + top + i * RH, n = inv[f.id] | 0, sel = i === BAG.sel, dim = n <= 0;
    if (sel) rect(shop ? "rgba(159,211,255,.22)" : "rgba(255,209,102,.16)", x + 4, ry, pw - 8, RH - 2);
    const fi = img(f.file);
    if (fi.complete && fi.naturalWidth) {                                                     // miniatura do peixe: recortada e reduzida em etapas (nítida, sem serrilhado)
      const cr = fishCrop(fi, f.file), cw = cr.naturalWidth || cr.width, ch = cr.naturalHeight || cr.height;
      const r = Math.min(44 / cw, 26 / ch), w = cw * r, h = ch * r;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = dim ? 0.3 : 1; ctx.drawImage(scaledFish(cr, w * S, h * S, f.file), x + 8 + (44 - w) / 2, ry + (RH - 2 - h) / 2, w, h); ctx.globalAlpha = 1;
    }
    text(f.name, x + 60, ry + 19, dim ? "#6d7889" : "#fff");
    text("x" + n, x + pw - 80, ry + 19, dim ? "#6d7889" : "#ffd166", "right");
    text(fmtMoney(priceOf(f)), x + pw - 8, ry + 19, dim ? "#6d7889" : "#8be28b", "right");
  });
  const by = y + top + Math.max(1, rows.length) * RH;
  rect("rgba(255,255,255,.18)", x + 6, by + 1, pw - 12, 1);
  if (shop) {
    text("Total: " + fmtMoney(invValue()), x + 8, by + 14, "#fff");
    text("E vende 1  Q todos  R tudo", x + 8, by + 26, "#9aa6b8");
    text("C conversar  ESC sair", x + 8, by + 37, "#9aa6b8");
  } else {
    text("Valem " + fmtMoney(invValue()) + " no Malto", x + 8, by + 14, "#fff");
    text("I ou ESC fechar", x + 8, by + 25, "#9aa6b8");
  }
}

// ---------- Telefish: celular que sobe ao apertar F (desenhado dentro do canvas, então recebe o mesmo filtro do jogo) ----------
// E interage com o menu. Ao lançar a vara, ou ao sair do modo andar, ele desce sozinho.
const PHONE_SRC = "assets/imgs/telefish.png";
const NOKIA_FONT = '8px "Nokia Cellphone FC", monospace';              // a fonte vem de assets/fonts (ver @font-face no index.html)
const PH_REF = 336, PH_H = 252, PH_VIS = 0.64, PH_MARGIN = 6, PH_SHIFT = 0.10;                          // altura do celular (px lógicos), quanto dele aparece e distância da borda direita
const PH_SCR = { x: 0.2845, y: 0.2436, w: 0.4237, h: 0.1763, r: 0.0228 };   // posição do vidro da tela dentro do PNG (medida na imagem)
const LCD_DX = -3, LCD_M = 4;                                           // LCD_DX: empurra o menu para a esquerda (mais negativo = mais à esquerda); LCD_M: margem de cada lado
const LCD_INK = "#1b2619", LCD_BG = "#97a888";                           // "pixel" escuro e fundo da tela acesa
const phoneImg = Object.assign(new Image(), { src: PHONE_SRC });
if (document.fonts) document.fonts.load(NOKIA_FONT).catch(() => {});
const PH = { open: false, pos: 0, vel: 0, lit: 0, delay: 0, blink: 0, hold: 0 };   // hold: 0 a 1, quanto o pescador já ergueu o celular e baixou a cabeça
let idleT = 0, frontK = 0;                                              // idleT: segundos parado; frontK: 0 = de lado ... 1 = de frente
const IDLE_FRONT = 2;                                                    // parado por 2s: o pescador vira de frente
const TURN_PART = 0.3, TURN_GATE = 0.4;                                  // TURN_PART: tempo que cada parte (cabeça, tronco, pernas) leva para virar; TURN_GATE: quando a próxima parte começa (0 a 1)
let turnH = 0, turnT = 0, turnL = 0;                                     // cabeça, tronco e pernas: 0 = de lado ... 1 = de frente
const PHONE_ARM = -0.12;                                                // ângulo do braço: mão baixa, na altura do peito
const PHONE_LIGHT = 0.15;                                               // força da luz do celular (0 a 1)                                                // ângulo do braço segurando o celular na frente do rosto
function openPhone() {
  if (PH.open || state !== "walk") return;
  PH.open = true; PH.delay = 0.45; mTalk = null;                         // sobe; a tela acende depois que ele chega
}
function closePhone() { PH.open = false; }
function togglePhone() { PH.open ? closePhone() : openPhone(); }
function phoneSelect() {                                                // E: seleciona a opção (ainda sem função, só o visual)
  if (!PH.open || PH.lit < 0.9) return;
  PH.blink = 0.22; SND.play("step_wood_1", { vol: 0.12, rate: 2.2, jitter: 0.1 });
  setTimeout(() => { closePhone(); openCustomizer(false); }, 260);          // "Personalizar personagem"
}
const nearOther = () => !CITY.on && Object.values(others).some(o => Math.abs(o.x - px) < 40);
const interacting = () => !!mTalk || mNear() || !!tTalk || tNear() || nearOther();             // conversando/perto do Malto ou de outro jogador: fica de lado
function updateIdle(dt) {
  const quiet = state === "walk" && !PH.open && !wantDraw && Math.abs(spd) < 1 && !(keys.ArrowLeft || keys.ArrowRight || keys.KeyA || keys.KeyD);
  idleT = quiet && !interacting() ? idleT + dt : 0;
  if (state !== "walk") { turnH = turnT = turnL = frontK = 0; return; }
  const goal = idleT >= IDLE_FRONT ? 1 : 0, mv = (v, g, d) => v + Math.sign(g - v) * Math.min(Math.abs(g - v), d);
  if (!goal && !quiet) { const d = dt / 0.12; turnH = mv(turnH, 0, d); turnT = mv(turnT, 0, d); turnL = mv(turnL, 0, d); }   // foi andar/agir: desvira rápido, tudo junto
  else {                                                                  // virando de verdade: cabeça primeiro, depois o tronco, depois as pernas (e na volta, na mesma ordem)
    const d = dt / TURN_PART;
    turnH = mv(turnH, goal, d);
    if (goal ? turnH > TURN_GATE : turnH < 1 - TURN_GATE) turnT = mv(turnT, goal, d);
    if (goal ? turnT > TURN_GATE : turnT < 1 - TURN_GATE) turnL = mv(turnL, goal, d);
  }
  frontK = (turnH + turnT + turnL) / 3;
}
function updatePhone(dt) {
  if (PH.open && state !== "walk") closePhone();
  if (PH.open) PH.delay -= dt;
  PH.vel += (((PH.open ? 1 : 0) - PH.pos) * 170 - PH.vel * 21) * dt;     // mola: sobe com uma folguinha e assenta
  PH.pos += PH.vel * dt;
  if (PH.pos < 0) { PH.pos = 0; PH.vel = 0; }
  PH.lit += (((PH.open && PH.delay <= 0) ? 1 : 0) - PH.lit) * Math.min(1, dt * (PH.open ? 6 : 14));
  PH.blink = Math.max(0, PH.blink - dt);
  PH.hold += ((PH.open ? 1 : 0) - PH.hold) * Math.min(1, dt * 7);
}
function drawHeldPhone(x, y, k) {                                                  // celular visto de lado: só um retângulo cinza (x,y = ponta da mão)
  const a = clamp01((k - 0.3) / 0.5); if (a <= 0) return;
  const fl = 0.9 + 0.1 * Math.sin(performance.now() / 90), x0 = Math.round(x) - 1, y0 = Math.round(y) - 7;
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(x0, 0, 5.6, 0);                               // luz fraquinha saindo da frente do celular até o rosto
  g.addColorStop(0, `rgba(205,245,160,${PHONE_LIGHT * fl})`); g.addColorStop(1, `rgba(205,245,160,${PHONE_LIGHT * 0.3})`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(5.6, -33); ctx.lineTo(5.6, -24.5); ctx.lineTo(x0, y0 + 8); ctx.closePath(); ctx.fill();
  rect("#9a9ea6", x0, y0, 2, 9);                                                   // o celular
  rect("#f1c27d", x0 - 1, y0 + 5, 3.5, 3.5);                                       // mão segurando
  ctx.restore();
}
function roundPath(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function nokiaScreen(sw, sh, inv) {                                      // layout do LCD (coordenadas em px lógicos a partir do canto da tela)
  sh = Math.round(sh);
  sw = Math.round(sw);                                                   // largura inteira: tudo alinhado em pixels
  ctx.font = NOKIA_FONT; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  const lx = LCD_M + LCD_DX, lw = sw - 2 * LCD_M;                        // área do conteúdo: mesma margem dos dois lados, deslocada para a esquerda
  ctx.fillStyle = LCD_INK; ctx.fillText("Menu", lx + 3, 11);
  ctx.textAlign = "right"; ctx.fillText(gameClock(), lx + lw - 2, 11); ctx.textAlign = "left";   // hora do jogo (igual para todos), no canto direito
  rect(LCD_INK, lx, 14, lw, 1);                                          // linha abaixo de "Menu": largura total, 1px de espessura
  if (inv) rect(LCD_INK, lx, 17, lw, 19);                                 // opção selecionada em vídeo invertido (mesma largura da linha)
  ctx.fillStyle = inv ? LCD_BG : LCD_INK;
  const fit = (str, x, y, maxW) => {                                      // se a fonte for mais larga que a tela, comprime só esse texto (nunca corta)
    const w = ctx.measureText(str).width;
    if (w <= maxW) return ctx.fillText(str, x, y);
    ctx.save(); ctx.translate(x, y); ctx.scale(maxW / w, 1); ctx.fillText(str, 0, 0); ctx.restore();
  };
  fit("Personalizar", lx + 3, 26, lw - 6); fit("personagem", lx + 3, 34, lw - 6);
  const m = ctx.measureText("Selec."), tw = Math.round(m.width), asc = Math.ceil(m.actualBoundingBoxAscent || 6);   // botão de baixo: caixa se ajusta ao texto
  let bw = tw + 8; if ((bw - lw) % 2) bw++;                                                                        // mesma paridade da linha: os centros coincidem
  const bh = asc + 6, bx = lx + (lw - bw) / 2, by = sh - bh - 2;                                                  // botão centralizado com a linha de baixo do "Menu"
  rect(LCD_INK, bx + 1, by, bw - 2, 1); rect(LCD_INK, bx + 1, by + bh - 1, bw - 2, 1);                            // contorno arredondado feito em pixels inteiros
  rect(LCD_INK, bx, by + 1, 1, bh - 2); rect(LCD_INK, bx + bw - 1, by + 1, 1, bh - 2);
  ctx.fillStyle = LCD_INK; ctx.fillText("Selec.", bx + 4, by + 3 + asc);
}
function drawPhone() {
  if (PH.pos <= 0.003 || !phoneImg.complete || !phoneImg.naturalWidth) return;
  const ph = PH_H, pw = ph * phoneImg.naturalWidth / phoneImg.naturalHeight;
  const x = Math.round(W - pw - PH_MARGIN + pw * PH_SHIFT), y = Math.round(H - ph * PH_VIS * Math.min(PH.pos, 1.08));
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 12 * S;
  ctx.drawImage(phoneImg, x, y, pw, ph);
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
  const sx = Math.round(x + pw * PH_SCR.x), sy = Math.round(y + ph * PH_SCR.y), sw = pw * PH_SCR.w, sh = ph * PH_SCR.h;
  if (PH.lit > 0.003) {
    roundPath(sx, sy, sw, sh, pw * PH_SCR.r); ctx.clip();
    const g = ctx.createLinearGradient(0, sy, 0, sy + sh); g.addColorStop(0, LCD_BG); g.addColorStop(1, "#8a9b7c");
    ctx.globalAlpha = PH.lit; ctx.fillStyle = g; ctx.fillRect(sx, sy, sw, sh);              // a tela fica mais clara (sem sombra nas bordas)
    const ca = Math.floor(clamp01((PH.lit - 0.35) / 0.5) * 3) / 3;                          // as opções aparecem em 3 "quadros", como num LCD
    if (ca > 0) {
      const k = ph / PH_REF;                                                              // o layout da tela é desenhado em 84 px e escalado junto com o celular
      ctx.globalAlpha = ca; ctx.translate(sx, sy); ctx.scale(k, k);
      nokiaScreen(sw / k, sh / k, !(PH.blink > 0 && ((PH.blink * 20) | 0) % 2 === 0));
    }
  }
  ctx.restore();
}

addEventListener("keydown", e => {
  if (PAUSED) return;                                   // pausado (ou nas Configurações da pausa): as teclas não são do jogo
  if (UI.open) return;                                  // digitando o apelido: as teclas não são do jogo
  if (INTRO.active) return;                             // abertura (título / zoom / queda): ainda sem controles
  SND.unlock();                                         // o navegador só libera o som depois de uma tecla/toque
  if (BAG.open) { bagKey(e); return; }                  // inventário/venda aberta: as teclas são dela
  keys[e.code] = true;
  if (e.code === "KeyI" && !e.repeat && state === "walk") openBag("inv");
  if (e.code === "KeyM" && !e.repeat) say(SND.toggleMute() ? "Som desligado" : "Som ligado");
  if (e.code === "KeyF" && !e.repeat) togglePhone();
  if (e.code === "Escape" && PH.open) closePhone();
  if (e.code === "KeyE" && !e.repeat) { if (PH.open) phoneSelect(); else if (CITY.on) cityUse(); else if (!talkMalto()) talkTiao(); }   // com o celular aberto, E é do celular
  if (e.code === "Space") { e.preventDefault(); if (!e.repeat) press(); }
});
addEventListener("keyup", e => keys[e.code] = false);
addEventListener("blur", () => { for (const k in keys) keys[k] = false; });   // perdeu o foco: solta todas as teclas (evita ficar correndo sozinho)
cv.addEventListener("pointerdown", e => {
  if (INTRO.active) return;
  if (state === "walk" && e.clientX) { /* toque: metade esquerda/direita move, centro lança */ }
  SND.unlock();
  const r = cv.getBoundingClientRect(), wxp = (e.clientX - r.left) / r.width * W - ((W - WORLD) / 2 + camX);
  if (BAG.open) { bagPointer((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H); return; }   // toque na venda/inventário
  if (mNear() && Math.abs(wxp - MX) < 22 && talkMalto()) return;      // toque no Malto = conversar (não lança a linha)
  if (tNear() && Math.abs(wxp - TX) < 22 && talkTiao()) return;        // toque no Tião também
  keys.Space = true; press();
});
addEventListener("pointerup", () => keys.Space = false);

function say(m) { msg = m; msgT = 2.5; }

function press() {
  if (CITY.on || TR.lock) return;                                         // sem água na cidade (e sem lançar durante a transição)
  if (state === "walk") {
    closePhone();                                                       // vai lançar a vara: o celular desce
    if (Math.abs(spd) > WALK + 1) wantDraw = true;                     // correndo: freia primeiro (o arremesso começa ao frear)
    else startCast();                                                   // senão já saca a vara das costas lançando
  } else if (state === "wait") { state = "walk"; SND.retract(); say("Você recolheu a linha"); }
  else if (state === "bite") startReel();
  else if (state === "show" && showT > 0.8) state = "walk";          // pode pular a comemoração
}

function startCast() {
  state = "cast"; cs = { t: 0, rel: null, hang: null, k0: rodL.k };
  bobber = { x: clearOfPosts(px + dir * 70), y: BOB_Y };
  fish = null; SND.cast();
  post("/api/bite").then(f => fish = f).catch(() => fish = fishList[Math.random() * fishList.length | 0]);
}

function startReel() {
  if (!fish) fish = fishList[0];
  state = "reel"; prog = 25; reelT = 0; reelAng = 0; SND.hook(); kick(0.7);
  bar.y = TRACK.h - bar.h; bar.v = 0;
  fp.y = TRACK.h / 2; fp.target = fp.y; fp.timer = 0;
}

function finish(win) {
  if (win) { state = "show"; showT = 0; inv[fish.id] = (inv[fish.id] | 0) + 1;
    catchCm = rollSize(fish); catchKg = rollKg(fish, catchCm);
    saveWallet(); SND.win(); kick(0.9); post("/api/catch", { id: fish.id }).catch(() => {}); }
  else { state = "walk"; SND.lose(); kick(0.4); say("O peixe escapou..."); }
}
// ---------- Comemoração: braços pra cima e o peixe pescado aparece grande, flutuando sobre eles ----------
let showT = 0;
const cheerPose = now => { const s = Math.sin(now / 140); return { rod: REST, arm: -1.3 + 0.12 * s, lean: 0.04, off: Math.PI - 0.3 - 0.12 * s, flex: 0, cheer: 1, wv: s, hop: Math.abs(s) * 1.8 }; };
const easeOutBack = k => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
const fishCache = new Map();
function scaledFish(fi, tw, th, id) {                                              // reduz a imagem aos poucos (metade por vez) até o tamanho da tela: sem serrilhado nem "pixels comidos" quando o PNG é bem maior que o peixe
  tw = Math.max(2, Math.round(tw / 4) * 4); th = Math.max(2, Math.round(th / 4) * 4);
  const fw = fi.naturalWidth || fi.width, fh = fi.naturalHeight || fi.height;
  if (fw <= tw * 1.25) return fi;                                 // PNG pequeno: só amplia (suave) direto na tela
  const key = id + "|" + tw; let c = fishCache.get(key); if (c) return c;
  let cur = fi, cw = fw, ch = fh;
  while (cw / 2 > tw) {
    const n = document.createElement("canvas"); n.width = Math.ceil(cw / 2); n.height = Math.ceil(ch / 2);
    const x = n.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, n.width, n.height);
    cur = n; cw = n.width; ch = n.height;
  }
  c = document.createElement("canvas"); c.width = tw; c.height = Math.max(2, Math.round(tw * fh / fw));
  const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, c.width, c.height);
  if (fishCache.size > 40) fishCache.clear();
  fishCache.set(key, c); return c;
}
const cropCache = new Map();
function fishCrop(fi, id) {                                                    // recorta as margens transparentes do PNG: o tamanho e a posição passam a valer para o peixe de verdade (e não para a imagem com folga em volta)
  if (cropCache.has(id)) return cropCache.get(id);
  let out = fi;
  try {
    const w = fi.naturalWidth, h = fi.naturalHeight, c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(fi, 0, 0);
    const d = x.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (d[(j * w + i) * 4 + 3] > 24) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    if (x1 >= x0 && y1 >= y0 && (x1 - x0 + 1 < w || y1 - y0 + 1 < h)) {
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1, n = document.createElement("canvas"); n.width = cw; n.height = ch;
      n.getContext("2d").drawImage(fi, x0, y0, cw, ch, 0, 0, cw, ch); out = n;
    }
  } catch (e) {}                                                               // sem acesso aos pixels: usa a imagem inteira
  cropCache.set(id, out); return out;
}
let CU = null;                                                                 // onde o texto da pescaria vai aparecer (calculado no mundo, desenhado na tela depois do zoom)
function catchDims() {                                                         // tamanho do peixe na tela (proporcional aos cm) e altura da cabeça do pescador
  const f0 = img(fish.file), ok = f0.complete && f0.naturalWidth, fi = ok ? fishCrop(f0, fish.file) : f0, iw = ok ? fi.naturalWidth || fi.width : 4, ih = ok ? fi.naturalHeight || fi.height : 3;
  const above = FISHER_TOP * hScale(me.h) + 10;                                // cabeça (com chapéu) + folga: o peixe fica acima da cabeça e das mãos levantadas
  let r = Math.max(14, catchCm * PX_PER_CM) / Math.max(iw, ih);
  if (ih * r > PIER_Y - above - 30) r = (PIER_Y - above - 30) / ih;           // peixe enorme: nunca passa do topo da tela
  return { fi, ok, w: iw * r, h: ih * r, above };
}
const catchFocusY = () => { const d = catchDims(); return (PIER_Y - d.above - d.h + PIER_Y) / 2; };   // centro do zoom: bem no meio entre o topo do peixe e os pés do pescador (o texto cabe acima)
function drawCatch(now, wx) {
  CU = null;
  if (state !== "show" || !fish) return;
  const { fi, ok, w, h, above } = catchDims();
  const sc = easeOutBack(Math.min(1, showT / 0.45)), fade = Math.min(1, (3.2 - showT) / 0.4);
  const cx = px, cy = PIER_Y - above - h / 2 - Math.abs(Math.sin(now / 140)) * 1.8 + Math.sin(now / 260) * 3;
  ctx.globalAlpha = Math.max(0, fade);
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, Math.max(w, h) * 0.85);       // brilho dourado atrás do peixe
  g.addColorStop(0, "rgba(255,232,150,.55)"); g.addColorStop(1, "rgba(255,232,150,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, Math.max(w, h) * 0.85 * sc, 0, 7); ctx.fill();
  for (let i = 0; i < 6; i++) {                                                       // brilhinhos girando em volta
    const a = now / 700 + i * 1.047, s = 1 + (Math.sin(now / 120 + i * 2) > 0.3 ? 1 : 0);
    rect("#fff6c2", cx + Math.cos(a) * (w * 0.62) * sc - s / 2, cy + Math.sin(a) * (h * 0.62) * sc - s / 2, s + 1, s + 1);
  }
  CU = { x: wx + cx, cy, y: cy - Math.max(h, 16) / 2 * sc, a: Math.max(0, fade), fi, ok, w, h, sc, rot: Math.sin(now / 340) * 0.06 };   // o desenho do peixe em si é feito depois do zoom (nítido)
  ctx.globalAlpha = 1;
}
function drawCatchUI() {                                                       // nome, tamanho e valor: na tela, por cima do zoom (sem ampliar nem borrar o texto)
  if (!CU || state !== "show" || !fish) return;
  const v = lastView, X = (CU.x - v.sx) * v.z, Y = (CU.y - v.sy) * v.z;
  const y1 = Math.max(26, Math.min(H - 50, Y - 24));
  ctx.globalAlpha = CU.a;
  {                                                                              // o peixe é desenhado AQUI, já no tamanho final da tela (antes ele era ampliado do quadro pronto e ficava borrado)
    const w = CU.w * CU.sc * v.z, h = CU.h * CU.sc * v.z;
    ctx.save(); ctx.translate(X, (CU.cy - v.sy) * v.z); ctx.rotate(CU.rot);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    if (CU.ok) ctx.drawImage(scaledFish(CU.fi, w * S, h * S, fish.file), -w / 2, -h / 2, w, h); else rect("#ffd166", -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  text(fish.name, X, y1, "#ffd166", "center");
  text(fmtCm(catchCm) + " · " + fmtKg(catchKg), X, y1 + 11, "#fff", "center");
  ctx.globalAlpha = 1;
}


function spawnDust(n, sgn) {                                                    // nuvenzinhas junto aos pés
  for (let i = 0; i < n; i++) dust.push({ x: px + (Math.random() - 0.5) * 6, y: PIER_Y + 0.5 + Math.random() * 1.8, vx: sgn * (-6 + Math.random() * 22), vy: -(6 + Math.random() * 16), t: 0, life: 0.4 + Math.random() * 0.3, r: 1.4 + Math.random() * 1.6 });
}
function drawDust() {
  dust.forEach(d => { const k = d.t / d.life; ctx.fillStyle = `rgba(238,224,214,${0.6 * (1 - k)})`; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * (1 + k * 1.6), 0, 7); ctx.fill(); });
}
function movePose() {                                                           // pose de corrida (inclinado), de freada (corpo pra trás) ou parado; a animação da vara é somada por cima
  if (state !== "walk") return null;
  let base = null;
  if (brake > 0.08) base = { rod: REST, arm: -0.4, lean: -0.24 * brake, off: 2.5, flex: 0, run: 0, brake };
  else if (runK > 0.05) base = { rod: REST, arm: 0, lean: 0.22 * runK, off: 0, flex: 0, run: runK };
  const b = base || { rod: REST, arm: 0, lean: 0, off: 0, flex: 0 };
  if (frontK > 0.001) { b.front = frontK; b.turn = [turnH, turnT, turnL]; }
  b.gait = gaitPh;
  if (PH.hold > 0.001) { b.phone = PH.hold; b.lean = (b.lean || 0) + 0.05 * PH.hold; }   // celular na mão: braço erguido, cabeça baixa, tronco levemente inclinado
  return rodPose(rodL, b);   // (sempre com a animação da vara: nas costas, guardando ou sacando)
}
function update(dt) {
  if (PAUSED) {                                          // pausado: o jogo (pesca, jogador, falas) congela, mas o cenário continua vivo atrás do menu
    mt += dt;                                            // respiração e movimentos do Malto
    const tk = tTalk; tTalk = null; tiaoUpdate(dt); tTalk = tk;   // Pedro continua andando/tocando flauta (a fala dele só fica parada)
    return;
  }
  msgT = Math.max(0, msgT - dt);
  updateTrans(dt);
  if (INTRO.phase === "go") introUpdate(dt); else if (INTRO.phase === "up" || INTRO.phase === "down") introMove(dt);
  updatePhone(dt); updateIdle(dt);
  maltoUpdate(dt); tiaoUpdate(dt);
  if (BAG.open && (state !== "walk" || (BAG.mode === "shop" && !mNear()))) closeBag(false);   // começou a pescar / afastou do Malto: fecha
  GSHAKE *= Math.exp(-dt * 6);
  const cu = Math.max(0, Math.min(1, (px - CAM_FAR) / (PX_MAX - CAM_FAR)));
  camX += (-(px - WORLD / 2) * CAM_K - CAM_EXTRA * cu * cu * (3 - 2 * cu) - camX) * Math.min(1, dt * 4);   // câmera suave atrás do pescador   // câmera suave atrás do pescador
  zside += ((state === "show" && fish ? 0.5 : 0.3) - zside) * Math.min(1, dt * 4);   // ao comemorar, o pescador (e o peixe em cima dele) fica no meio da tela; puxando, fica mais à esquerda
  zfy += ((state === "show" && fish ? catchFocusY() : PIER_Y - 6) - zfy) * Math.min(1, dt * 4);   // o centro do zoom também desliza (sem tranco ao entrar e sair)
  zs += ((state === "reel" ? 1.45 : state === "show" ? catchZoom(catchCm) : 1) - zs) * Math.min(1, dt * 4);   // puxando: 1,45x; comemorando: depende do tamanho do peixe (pequeno = mais perto)
  vigK += ((state === "show" ? 1 : 0) - vigK) * Math.min(1, dt * 5);   // vinheta suave ao pescar      // zoom entra e sai suavemente
  walkAmp += ((moving ? 1 : 0) - walkAmp) * Math.min(1, dt * 14); moving = false;
  if (state !== "walk") { spd = 0; runK = 0; brake = 0; wasBraking = false; rodL.k = state === "show" ? 1 : 0; rodL.v = 0; rodL.st = 9; wantDraw = false; }   // pescando: vara na mão; comemorando: já guardada
  else {                                                                       // andando: a vara fica nas costas; ao fim da pescaria ela é guardada de novo
    stepRod(rodL, 1, dt);                                                       // andando/correndo: a vara fica nas costas
    if (wantDraw && Math.abs(spd) <= WALK + 1) { wantDraw = false; startCast(); return; }   // terminou de frear: lança
  }
  for (let i = dust.length - 1; i >= 0; i--) {                                  // fumacinha da freada sobe e some
    const d = dust[i]; d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy *= 0.95; d.vx *= 0.97;
    if (d.t > d.life) dust.splice(i, 1);
  }
  if (state === "walk") {
    const m = wantDraw || TR.lock ? 0 : (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);   // sacando a vara: para de andar
    const ox = px, run = keys.ShiftLeft || keys.ShiftRight;
    const aim = m ? (run ? RUN : WALK) * m : 0;                   // velocidade desejada
    if (Math.abs(spd) <= WALK + 1 && Math.abs(aim) <= WALK) spd = aim;                       // andar normal: resposta imediata
    else { const r = Math.abs(aim) > Math.abs(spd) ? 700 : 430; spd += Math.max(-r * dt, Math.min(r * dt, aim - spd)); }   // correr: acelera e freia com inércia
    if (m) dir = m;
    const PXM = pxMax();
    px = Math.max(16, Math.min(PXM, px + spd * dt * (CITY.on ? CITY_CHAR : 1)));   // na cidade o pescador é menor, então anda proporcionalmente
    if ((px <= 16 && spd < 0) || (px >= PXM && spd > 0)) spd = 0;
    {                                                                            // empurrar a ponta do cais (esquerda) ou da cidade (direita) por um instante troca de cenário
      const atEdge = !CITY.on ? px <= 16 && m < 0 : px >= CITY.MAX && m > 0;
      TR.edge = atEdge && !INTRO.active && !INTRO.on && !BAG.open && TR.ph !== "out" && TR.ph !== "hold" ? TR.edge + dt : 0;
      if (TR.edge > 0.3) { TR.edge = 0; startTrans(CITY.on ? "pier" : "city"); }
    }
    moving = Math.abs(spd) > 1;
    gaitPh += Math.abs(px - ox) / (CITY.on ? CITY_CHAR : 1) / (11 + 3 * (runK > 0.05 ? runK : 0) + (hScale(me.h) - 1) * FISHER_TOP * LEG_SHARE * 0.5);   // mesma conta do desenho das pernas
    const si = Math.floor((gaitPh - Math.PI / 2) / Math.PI);          // o pé toca o chão quando as pernas estão mais abertas (a cada meia volta da fase)
    if (si > stepIdx) { stepIdx = si; SND.step(); }
    const braking = Math.abs(spd) > WALK + 20 && Math.abs(aim) < Math.abs(spd) - 20;   // vinha correndo e soltou: está freando
    if (braking && !wasBraking) { SND.play("pier_creak_1", { vol: 0.3, rate: 1.25 }); spawnDust(6, Math.sign(spd)); dustT = 0; }
    wasBraking = braking;
    if (braking && (dustT -= dt) <= 0) { dustT = 0.045; spawnDust(2, Math.sign(spd)); }
    brake += ((braking ? 1 : 0) - brake) * Math.min(1, dt * 14);
    runK += (Math.max(0, Math.min(1, (Math.abs(spd) - WALK) / (RUN - WALK))) - runK) * Math.min(1, dt * 10);
  } else if (state === "show") {
    showT += dt; if (showT > 3.2) state = "walk";
  } else if (state === "cast") {
    cs.t += dt;
    if (cs.t >= CAST_RELEASE + CAST_FLIGHT) { state = "wait"; t = 2 + Math.random() * 3; landT0 = performance.now(); fxs.push({ x: bobber.x, t0: landT0 }); SND.splash(); }
  } else if (state === "wait") {
    t -= dt; if (t <= 0) { state = "bite"; bite = 1.4; SND.bite(); kick(0.5); }
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
const text = (s, x, y, c = "#fff", a = "left") => { ctx.font = UI_PX + "px " + UI_FONT; ctx.textAlign = a; ctx.fillStyle = "#000"; ctx.fillText(s, x + 1, y + 1); ctx.fillStyle = c; ctx.fillText(s, x, y); };

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
function drawLakeGlints(now, sx) {          // brilho do sol (ou da lua) cintilando no lago distante (some e volta devagar)
  if (DAY.lightA < 0.02) return;
  const t = now / 1000, gc = DAY.lc.map(v => Math.round(v + (255 - v) * 0.45)).join(",");
  for (let i = 0; i < 14; i++) {
    const y = HZ + 1 + i * 1.6, w = 5 + i * 3.2, a = Math.max(0, (0.45 + 0.3 * Math.sin(t * 1.3 + i * 1.7)) * (1 - i * 0.04)) * DAY.lightA, j = Math.sin(t * 0.7 + i) * 2;
    rect(`rgba(${gc},${a})`, sx - w / 2 + j, y, w * 0.42, 0.9);
    rect(`rgba(${gc},${a})`, sx + w * 0.08 + j, y, w * 0.42, 0.9);
  }
}
function drawGulls(now) {
  const t = now / 1000, P = 70, CROSS = 30, k = Math.floor(t / P), u0 = (t - k * P) / CROSS;   // a cada 70s sorteia se passa um bando; atravessa a tela em ~30s
  if (u0 > 1.2) return;
  let r = k * 7919 + 13; const rnd = () => (r = r * 16807 % 2147483647) / 2147483647; rnd(); rnd();
  if (rnd() > 0.6) return;                                                   // ~40% das vezes não passa ninguém
  const n = 1 + (rnd() * 3 | 0), dir = rnd() < 0.5 ? -1 : 1, y0 = 40 + rnd() * 55, off = camX * 0.08;
  const sleepA = Math.max(0, 1 - DAY.starA * 1.6);                           // à noite as gaivotas somem aos poucos
  if (sleepA < 0.02) return;
  ctx.globalAlpha = sleepA; ctx.lineCap = "round"; ctx.lineJoin = "round";
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
  ctx.globalAlpha = 1;
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
  ctx.globalAlpha = 1 - 0.8 * DAY.starA;                   // à noite a névoa quase some (senão fica tudo lavado)
  ctx.drawImage(layers.fogs[i], x0 + d - LW, f.y0, LW, f.bh);
  ctx.drawImage(layers.fogs[i], x0 + d, f.y0, LW, f.bh);
  ctx.globalAlpha = 1;
}
function buildLayers(now) {
  // todas as camadas usam coordenadas do mundo (0..480) e têm EXT px de sobra de cada lado
  const sky = layer(() => { DAY.update(gameMinutes()); DAY.paintSky(ctx, now); });   // céu do ciclo de dia (daycycle.js); depois é repintado por DAY.repaintSky
  DAY.lastSky = now;
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
  const deck = layer(() => {                                           // cais: topo iluminado pelo sol, tábuas de tons variados, frente em viga sombreada
    ctx.translate(EXT, 0);
    let rr = 31; const rn = () => (rr = rr * 16807 % 2147483647) / 2147483647;
    const g = ctx.createLinearGradient(0, PIER_Y + 3, 0, PIER_Y + 8);   // frente (viga): de madeira morna para sombra roxa embaixo
    g.addColorStop(0, "#8f5d3c"); g.addColorStop(0.5, "#73482f"); g.addColorStop(1, "#47293a");
    ctx.fillStyle = g; ctx.fillRect(-EXT, PIER_Y + 3, DECK_END + EXT, 5);
    const TONES = ["#d29a64", "#c58b57", "#dca56e", "#b97f4f"];
    for (let x = -EXT; x < DECK_END;) {                                  // tábuas do topo, cada uma com seu tom, veio e pregos
      const w = Math.min(16 + rn() * 16, DECK_END - x), tone = TONES[rn() * 4 | 0];   // a última tábua é cortada na ponta do cais
      rect(tone, x, PIER_Y, w - 0.8, 3);
      rect("rgba(255,226,180,.3)", x + rn() * w * 0.4, PIER_Y + 0.9, w * (0.2 + rn() * 0.3), 0.6);
      rect("rgba(90,50,30,.35)", x + rn() * w * 0.5, PIER_Y + 2, w * (0.2 + rn() * 0.3), 0.6);
      rect("#6b3f28", x + w - 0.8, PIER_Y, 0.8, 8);                      // fresta entre tábuas (desce pela frente)
      rect("rgba(60,34,22,.6)", x + 1.8, PIER_Y + 1.2, 0.8, 0.8); rect("rgba(60,34,22,.6)", x + w - 3, PIER_Y + 1.2, 0.8, 0.8);
      x += w;
    }
    rect("rgba(255,214,160,.65)", -EXT, PIER_Y, DECK_END + EXT, 0.8);               // fio de luz na quina de cima
    rect("rgba(40,22,30,.5)", -EXT, PIER_Y + 3, DECK_END + EXT, 0.8);               // sombra logo abaixo da quina
    rect("rgba(255,200,150,.18)", -EXT, PIER_Y + 4.2, DECK_END + EXT, 0.6);         // reflexo rosado do céu na viga
    rect("rgba(20,10,36,.6)", -EXT, PIER_Y + 7, DECK_END + EXT, 1);     // sombra da borda de baixo
    rect("#3a2230", DECK_END - 1.8, PIER_Y + 3, 1.8, 5);                // ponta da viga (fim do cais)
    rect("rgba(255,214,160,.5)", DECK_END - 1.8, PIER_Y, 1.8, 0.8);     // quina iluminada da última tábua
  });
  const posts = layer(() => {                                          // postes: sombra à esquerda, luz do sol à direita, faixas, e escurecem na água
    ctx.translate(EXT, 0);
    for (let i = 6 - 48 * 4; i < DECK_END; i += 48) {
      rect("#3a2230", i, PIER_Y + 8, 3, 32); rect("#6b4329", i + 3, PIER_Y + 8, 3, 32); rect("#b8704c", i + 6, PIER_Y + 8, 2, 32);
      for (let y = PIER_Y + 14; y < PIER_Y + 38; y += 6.5) rect("rgba(20,10,30,.22)", i, y, 8, 0.8);
      rect("rgba(255,210,170,.25)", i + 6, PIER_Y + 8, 0.8, 32);
      const g = ctx.createLinearGradient(0, PIER_Y + 8, 0, PIER_Y + 40);
      g.addColorStop(0, "rgba(20,8,34,.5)"); g.addColorStop(0.2, "rgba(20,8,34,0)"); g.addColorStop(0.6, "rgba(20,8,34,0)"); g.addColorStop(1, "rgba(30,20,58,.5)");
      ctx.fillStyle = g; ctx.fillRect(i, PIER_Y + 8, 8, 32);             // sombra do deck no topo e umidade na base
    }
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
  lampSprite();                                                        // o sprite da luz dos postes nasce junto com o resto do cenário
}

// ---------- Parallax: cada camada acompanha a câmera numa fração diferente (0 = parada no fundo, 1 = mesma do cais) ----------
const PAR = { sky: 0.04, cloud: 0.12, far: 0.25, mid: 0.37, near: 0.5, hills: 0.75, lake: 0.75, pier: 1 };
const rctx = refl.getContext("2d");

function reflect() {                       // copia o que está acima da água para o canvas do reflexo (já na ampliação da câmera atual)
  const t = ctx.getTransform(), d = t.d, Hd = Math.min(refl.height, Math.ceil(RD * d)), yw = WATER_Y * d + t.f;
  rctx.setTransform(1, 0, 0, 1, 0, 0);
  rctx.clearRect(0, 0, refl.width, refl.height);
  const top = Math.max(0, yw - Hd), bot = Math.min(buf.height, yw), hh = bot - top;
  if (hh > 0.5) rctx.drawImage(buf, 0, top, buf.width, hh, 0, Hd - (yw - top), buf.width, hh);   // a base fica alinhada com a linha da água
}
function drawReflection(now) {             // desenha o reflexo espelhado, em faixas que ondulam (mais forte longe da margem)
  const t = ctx.getTransform(), d = t.d, z = d / S, Hd = Math.min(refl.height, Math.ceil(RD * d)), ys = (WATER_Y * d + t.f) / S;
  ctx.save(); ctx.setTransform(S, 0, 0, S, 0, 0);                      // o reflexo já está em pixels de tela: desenha sem a câmera, só espaçando as faixas pelo zoom
  for (let r = 0; r < RD; r++) {
    const k = r / RD;
    const off = Math.sin(r / 5 + now / 900) * (0.3 + k * 1.6) + Math.sin(r / 2.6 - now / 650) * 0.35;
    ctx.globalAlpha = 0.6 * (1 - k * 0.8);
    ctx.drawImage(refl, 0, Hd - (r + 1) * d, refl.width, d, off * z - 4, ys + r * z, W + 8, z);
  }
  ctx.restore();
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
  const t = now / 1000, sunX = ox + camX * PAR.sky + DAY.lightX, LA = DAY.lightA, lc = DAY.lc, d = WV.im.data, cols = WV.cols, rows = WV.rows, HT = rows * WV.ch;
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
      const g = Math.pow(cl((-sy + 0.25 * sx - 0.5) * 1.8, 0, 1), 1.4) * mask * (1 - 0.4 * s) * LA;   // só as ondas inclinadas para o sol cintilam
      const aL = Math.min(1, Math.max(shade, 0) * 0.5 * (0.3 + 0.7 * LA) + mask * 0.08 * (1 - 0.5 * s) * LA + g);
      const aD = Math.max(-shade, 0) * 0.7 * (1 - aL);
      const kk = g / (aL + 1e-3), a = aL + aD, o = (j * cols + i) * 4;
      const Lg = lc[1] + 33 * kk, Lb = lc[2] + 40 * kk;                        // luz quente -> branco-dourado nos pontos fortes
      d[o] = a > 0 ? (lc[0] * aL + 6 * aD) / a : 0; d[o + 1] = a > 0 ? (Lg * aL + 24 * aD) / a : 0; d[o + 2] = a > 0 ? (Lb * aL + 44 * aD) / a : 0;
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
function pierShadow(now, wxp) {            // sombra do cais caindo na água logo abaixo: forte junto do deck, some suave para a frente e na ponta
  const base = 0.35 + 0.65 * DAY.lightA;                                       // sem sol forte, sombra mais fraca
  ctx.globalAlpha = base;
  const t = now / 1000, SH = 42, g = ctx.createLinearGradient(0, WATER_Y, 0, WATER_Y + SH);   // começa na linha da água (não cobre o lago/céu atrás do cais)
  for (let k = 0; k <= 12; k++) { const u = k / 12; g.addColorStop(u, `rgba(22,10,44,${(0.44 * Math.pow(1 - u, 2.4)).toFixed(3)})`); }   // queda suave (curva), sem degraus
  ctx.fillStyle = g;
  const FEATHER = 40, endX = Math.min(W, wxp + DECK_END + 6), solid = Math.floor(endX - FEATHER);   // na ponta do cais a sombra esmaece em ~40px em vez de cortar seco
  if (solid > 0) ctx.fillRect(0, WATER_Y, Math.min(W, solid), SH);
  for (let x = Math.max(0, solid); x < endX && x < W; x += 2) {
    const u = Math.min(1, Math.max(0, (x - solid) / FEATHER)), f = 1 - u * u * (3 - 2 * u);   // smoothstep: 1 -> 0
    ctx.globalAlpha = base * f; ctx.fillRect(x, WATER_Y, 2, SH);
  }
  ctx.globalAlpha = base;
  for (let i = 6 - 48 * 4; i < DECK_END; i += 48) {                   // sombra de cada poste, balançando de leve com a água
    const x = wxp + i; if (x < -20 || x > W + 20) continue;
    const sw = Math.sin(t * 1.4 + i * 0.37) * 1.2, pg = ctx.createLinearGradient(0, WATER_Y, 0, WATER_Y + 26);
    for (let k = 0; k <= 6; k++) { const u = k / 6; pg.addColorStop(u, `rgba(14,6,30,${(0.36 * Math.pow(1 - u, 2)).toFixed(3)})`); }
    ctx.fillStyle = pg; ctx.fillRect(x - 1 + sw, WATER_Y, 11, 26);
  }
  ctx.globalAlpha = 1;
}
function postWaves(now, wxp) {
  const t = now / 1000, BOTTOM = PIER_Y + 8 + 32;                       // base dos postes (onde encostam na água)
  for (let i = 6 - 48 * 4; i < DECK_END; i += 48) {
    const x0 = Math.max(0, wxp + i), x1 = Math.min(W, wxp + i + 8);
    if (x1 - x0 < 1) continue;
    const ph = i * 0.37;
    const h = Math.max(0.6, 1.3 + 1.0 * Math.sin(t * 1.6 + ph) + 0.6 * Math.sin(t * 2.7 + ph * 1.7));   // quanto a água sobe no poste (0 a ~3px)
    rect("rgba(0,0,0,.18)", x0, BOTTOM - 4, x1 - x0, 4 - h + 0.01);              // madeira úmida logo acima da água
    ctx.globalAlpha = 0.93;
    const T = ctx.getTransform();
    ctx.drawImage(buf, x0 * T.a + T.e, (BOTTOM + 1) * T.d + T.f, (x1 - x0) * T.a, h * T.d, x0, BOTTOM - h, x1 - x0, h);   // água de verdade cobrindo o pé do poste
    ctx.globalAlpha = 1;
    rect(`rgba(225,240,250,${0.3 + 0.12 * h})`, x0, BOTTOM - h, x1 - x0, 0.9);   // borda de cima mais clara (contraste)
  }
}

// ---------- Barrinha do minigame: moldura de madeira, água com bolhas, barra verde reluzente e brilhos ----------
const hs = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };   // número "aleatório" fixo (0 a 1) para cada n
function spark(x, y, r, a, c = "#fff") {                                    // estrelinha de 4 pontas
  if (a <= 0.03) return;
  ctx.globalAlpha = Math.min(1, a);
  rect(c, x - r, y - 0.4, 2 * r, 0.8); rect(c, x - 0.4, y - r, 0.8, 2 * r);
  rect("#fff", x - 0.6, y - 0.6, 1.2, 1.2);
  ctx.globalAlpha = 1;
}
function drawReelUI(now) {
  const X = TRACK.x, Y = TRACK.y, H = TRACK.h, t = now / 1000;
  const inside = !!fish && fp.y > bar.y && fp.y < bar.y + bar.h, pulse = 0.5 + 0.5 * Math.sin(t * 5);
  // moldura de madeira com luz em cima/esquerda e sombra embaixo/direita
  rect("#24170d", X - 15, Y - 9, 46, H + 18); rect("#3b2a1a", X - 14, Y - 8, 44, H + 16);
  rect("#7a5632", X - 14, Y - 8, 44, 1); rect("#7a5632", X - 14, Y - 8, 1, H + 16);
  rect("#1f140b", X - 14, Y + H + 7, 44, 1); rect("#1f140b", X + 29, Y - 8, 1, H + 16);
  [[-12, -6], [27, -6], [-12, H + 4], [27, H + 4]].forEach(([dx, dy], i) => {           // pininhos dourados que piscam
    rect("#7f858d", X + dx, Y + dy, 2, 2); rect("#c9ced4", X + dx, Y + dy, 1, 1);
  });
  // água do trilho: degradê, riscos de luz subindo e bolhinhas
  ctx.save(); ctx.beginPath(); ctx.rect(X, Y, 16, H); ctx.clip();
  let g = ctx.createLinearGradient(0, Y, 0, Y + H); g.addColorStop(0, "#27607c"); g.addColorStop(0.5, "#1b3a4b"); g.addColorStop(1, "#0f2536");
  ctx.fillStyle = g; ctx.fillRect(X, Y, 16, H);
  for (let i = 0; i < 6; i++) {
    const yy = Y + (((hs(i) * H - t * (5 + i * 2.2)) % H) + H) % H;
    rect("rgba(170,225,255,.10)", X + 1 + hs(i + 9) * 8, yy, 4 + hs(i + 3) * 5, 0.8);
  }
  for (let i = 0; i < 8; i++) {
    const by = Y + H - ((t * (9 + hs(i + 30) * 9) + hs(i) * H) % H), bx = X + 2 + hs(i + 20) * 12 + Math.sin(t * 2 + i) * 0.8;
    rect("rgba(205,238,255,.5)", bx, by, 1, 1); rect("rgba(255,255,255,.35)", bx, by, 0.5, 0.5);
  }
  rect("rgba(0,0,0,.35)", X, Y, 16, 1); rect("rgba(0,0,0,.25)", X, Y, 1, H);          // sombrinha interna
  ctx.restore();
  // barra verde: brilho em volta, degradê, gloss, reflexo passando e glitter
  const y0 = Y + bar.y, bh = bar.h;
  for (let k = 3; k >= 1; k--) rect(`rgba(120,255,150,${(inside ? 0.09 + 0.06 * pulse : 0.04) * (4 - k) / 2})`, X + 1 - k, y0 - k, 14 + 2 * k, bh + 2 * k);
  g = ctx.createLinearGradient(X, 0, X + 16, 0); g.addColorStop(0, "#9bf59b"); g.addColorStop(0.45, "#5fd36a"); g.addColorStop(1, "#38a64d");
  ctx.fillStyle = g; ctx.fillRect(X + 1, y0, 14, bh);
  ctx.save(); ctx.beginPath(); ctx.rect(X + 1, y0, 14, bh); ctx.clip();
  rect("rgba(255,255,255,.32)", X + 2, y0 + 1, 2, bh - 2);                              // gloss na lateral
  const sw = (t * 38) % (bh + 50) - 25;                                                  // reflexo diagonal que desce pela barra
  for (let d = 0; d < 4; d++) rect(`rgba(255,255,255,${0.26 - d * 0.05})`, X + 1, y0 + sw + d * 2 - 6, 14, 1.4);
  ctx.restore();
  rect("#d6ffd6", X + 1, y0, 14, 1); rect("#2b8541", X + 1, y0 + bh - 1, 14, 1);        // borda de cima clara e de baixo escura
  if (inside) { ctx.strokeStyle = `rgba(255,255,210,${0.35 + 0.35 * pulse})`; ctx.lineWidth = 0.8; ctx.strokeRect(X + 1.4, y0 + 0.4, 13.2, bh - 0.8); }
  // peixe: halo dourado e estrelinhas girando quando está dentro da barra
  const fx = X + 8, fy = Y + fp.y;
  drawMystery(fx, fy, 30, 22);                                                           // sempre o peixe misterioso; o de verdade só aparece depois de pescar
  // progresso: calha escura, enchimento com degradê, reflexo subindo e brilho na pontinha
  const px0 = X + 22, fh = TRACK.h * prog / 100, top = Y + TRACK.h - fh;
  rect("#0e0e0e", px0, Y, 6, H); rect("#2a2a2a", px0, Y, 6, 1); rect("#1b1b1b", px0 + 1, Y + 1, 4, H - 1);
  const col = prog > 66 ? ["#b9ffb9", "#6bd66b", "#3aa84f"] : prog > 33 ? ["#fff0b0", "#ffd166", "#d99a2b"] : ["#ff9aa2", "#e63946", "#a82432"];
  if (fh > 0.5) {
    g = ctx.createLinearGradient(px0 + 1, 0, px0 + 5, 0); g.addColorStop(0, col[0]); g.addColorStop(0.5, col[1]); g.addColorStop(1, col[2]);
    ctx.fillStyle = g; ctx.fillRect(px0 + 1, top, 4, fh);
    rect("rgba(255,255,255,.5)", px0 + 1, top, 4, 0.8);
    ctx.save(); ctx.beginPath(); ctx.rect(px0 + 1, top, 4, fh); ctx.clip();
    const sh = (t * 55) % (fh + 14); rect("rgba(255,255,255,.45)", px0 + 1, Y + H - sh, 4, 2); rect("rgba(255,255,255,.2)", px0 + 1, Y + H - sh + 2, 4, 2);
    ctx.restore();
  }
  rect("rgba(255,255,255,.18)", px0 + 1, Y + H * 0.34, 4, 0.7); rect("rgba(255,255,255,.18)", px0 + 1, Y + H * 0.67, 4, 0.7);   // marcas de 33% e 66%
}

// ---------- Postes de luz do cais: acendem à noite com luz amarela quente ----------
const LAMPS = [-110, 30, 170, 310, 450, 560];            // x de cada poste no mundo (mude aqui para mover/adicionar)
const LAMP_H = 80;                                       // altura do fuste; a lanterna fica no topo
const LAMP_WARM = [255, 190, 70];                        // cor da luz (amarelo quente)
let lampWide = false;                                    // true na tela inicial: a câmera está longe e mostra bem mais largura que a tela do jogo
const lampOn = x => DAY.lamp > 0.01 && (lampWide || (x + ox0() > -100 && x + ox0() < W + 100));
const ox0 = () => (W - WORLD) / 2 + camX;                // deslocamento do mundo na tela
function lampFlick(x, now) { return 1 + 0.025 * Math.sin(now / 230 + x) + 0.015 * Math.sin(now / 97 + x * 3); }

function drawLamps(now) {                                // corpo do poste (recebe a lavagem de cor da hora, como o resto do cenário)
  const y0 = PIER_Y + 1, yt = y0 - LAMP_H;               // yt = topo do fuste
  LAMPS.forEach(x => {
    if (!lampWide && (x + ox0() < -30 || x + ox0() > W + 30)) return;
    softShadow(x, PIER_Y + 1.2, 7, 1.4, 0.35, PIER_Y + 3.2);
    rect("#2b2230", x - 3.5, y0 - 2, 7, 2);              // base
    rect("#3a2e3c", x - 2, y0 - 16, 4, 14);              // pé mais grosso
    rect("#2b2230", x - 2.6, y0 - 17.5, 5.2, 1.5);
    rect("#3a2e3c", x - 1, yt, 2, LAMP_H - 17);          // fuste
    rect("#6b5a63", x, yt, 0.6, LAMP_H - 17);            // brilho do ferro
    rect("#2b2230", x - 2.5, yt - 2, 5, 2);              // colar
    rect("#9a7440", x - 3, yt - 9, 6, 7);                // vidro (apagado)
    rect("#2b2230", x - 3.6, yt - 9, 0.8, 7); rect("#2b2230", x + 2.8, yt - 9, 0.8, 7);   // armação
    rect("#2b2230", x - 6, yt - 11, 12, 2);              // chapéu largo: a luz sai só para baixo
    rect("#3a2e3c", x - 4, yt - 13, 8, 2);
    rect("#3a2e3c", x - 2, yt - 15, 4, 2);
    rect("#2b2230", x - 0.5, yt - 17, 1, 2);             // pontinha
  });
}

// sprite da luz: calculado pixel a pixel (sem camadas, sem faixas). Física simples de um spot de luz:
//  - perfil angular suave (gaussiana) = a luz sai da lanterna num feixe que se dissolve nas bordas, sem linha marcada
//  - queda com a distância (aprox. 1/d²) = forte perto da lanterna, fraca longe
//  - cor por intensidade: núcleo amarelo-claro e bordas/pontas mais alaranjadas (como uma lâmpada incandescente)
let lampSpr = null;
function lampSprite() {
  if (lampSpr && lampSpr.S === S) return lampSpr.cv;
  const LW2 = 180, h = LAMP_H + 4, c = document.createElement("canvas");
  c.width = LW2 * S; c.height = h * S;
  const x = c.getContext("2d"), im = x.createImageData(c.width, c.height), d = im.data, cx = c.width / 2;
  const T0 = 0.62, GAIN = 1.9, D0 = 20;                 // T0: abertura do feixe (rad) | GAIN: força | D0: distância em que a luz cai pela metade
  for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) {
    const dx = (px - cx) / S, dy = py / S + 3, r = Math.hypot(dx, dy);
    const th = Math.atan2(Math.abs(dx), dy);
    const beam = Math.exp(-Math.pow(th / T0, 2.4));                     // perfil do feixe
    const fall = 1 / (1 + (r / D0) * (r / D0));                         // queda com a distância
    const edge = Math.min(1, Math.max(0, (LW2 / 2 - Math.abs(dx)) / 14));   // some antes da borda do sprite (sem corte)
    const A = Math.min(1, beam * fall * GAIN) * edge;
    const m = Math.min(1, A * 1.6), i = (py * c.width + px) * 4;
    d[i] = 255; d[i + 1] = 160 + 70 * m; d[i + 2] = 55 + 100 * m * m;   // laranja (fraco) -> amarelo-claro (forte)
    d[i + 3] = A * 255;
  }
  x.putImageData(im, 0, 0);
  lampSpr = { S, cv: c };
  return c;
}

function drawLampGlow(now) {                             // luz: vidro aceso, feixe suave para baixo, poeira no ar, bloom e poça nas tábuas
  const L = DAY.lamp, [r, g, b] = LAMP_WARM, y0 = PIER_Y + 1, yt = y0 - LAMP_H, cy = yt - 5.5, yb = yt - 2, spr = lampSprite(), t = now / 1000;
  LAMPS.forEach(x => {
    if (!lampOn(x)) return;
    const k = L * lampFlick(x, now);
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 1.1);              // vidro aceso: miolo quase branco, bordas amarelas
    rect("#f2b13c", x - 3, cy - 3.5, 6, 7); rect("#ffd36a", x - 2.3, cy - 2.8, 4.6, 5.6); rect("#fff6d6", x - 1.3, cy - 1.8, 2.6, 3.6);
    ctx.globalCompositeOperation = "lighter";            // somar luz: o que está atrás clareia e esquenta
    ctx.globalAlpha = Math.min(1, 0.7 * k);
    ctx.drawImage(spr, x - 90, yb, 180, LAMP_H + 4);     // feixe de luz
    // poeira/insetos flutuando no feixe: pontinhos que brilham e apagam devagar
    for (let i = 0; i < 9; i++) {
      const u = (t * (0.025 + 0.012 * (i % 3)) + i * 0.173 + x * 0.0071) % 1, dy = 6 + u * (LAMP_H - 12);
      const px = x + Math.sin(t * 0.45 + i * 2.3 + x) * 0.5 * dy * (0.4 + 0.6 * ((i * 37) % 10) / 10), tw = 0.5 + 0.5 * Math.sin(t * 1.7 + i * 5.1);
      ctx.globalAlpha = Math.min(1, k * tw * 0.55 * Math.sin(u * 3.1416));
      rect("#ffe2a0", px, yb + dy, 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.beginPath(); ctx.rect(x - 40, yt - 11, 80, 200); ctx.clip();   // o chapéu bloqueia a luz para cima
    let gr = ctx.createRadialGradient(x, cy, 1, x, cy, 30);                          // bloom: núcleo + brilho largo (queda tipo 1/d²)
    gr.addColorStop(0, `rgba(255,236,180,${0.85 * k})`); gr.addColorStop(0.1, `rgba(255,214,130,${0.5 * k})`); gr.addColorStop(0.28, `rgba(${r},${g + 5},${b},${0.2 * k})`);
    gr.addColorStop(0.6, `rgba(${r},${g - 10},${b - 10},${0.06 * k})`); gr.addColorStop(1, `rgba(${r},${g - 20},${b - 20},0)`);
    ctx.fillStyle = gr; ctx.fillRect(x - 30, cy - 30, 60, 60);
    ctx.restore();
    ctx.beginPath(); ctx.rect(x - 110, PIER_Y, 220, 3.4); ctx.clip();                 // poça de luz só nas tábuas do deck
    ctx.translate(x, PIER_Y + 1); ctx.scale(1, 0.07);
    gr = ctx.createRadialGradient(0, 0, 1, 0, 0, 100);   // miolo forte + espalhado largo (curva tipo 1/d²)
    gr.addColorStop(0, `rgba(255,228,160,${0.95 * k})`); gr.addColorStop(0.08, `rgba(255,214,130,${0.7 * k})`); gr.addColorStop(0.2, `rgba(255,192,95,${0.4 * k})`);
    gr.addColorStop(0.4, `rgba(${r},${g},${b},${0.17 * k})`); gr.addColorStop(0.7, `rgba(${r},${g - 10},${b},${0.05 * k})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gr; ctx.fillRect(-100, -100, 200, 200);
    ctx.restore();
  });
}

function drawLampWater(now) {                            // brilho amarelo na água embaixo de cada poste (o reflexo do poste já vem do cenário)
  const t = now / 1000, [r, g, b] = LAMP_WARM;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  LAMPS.forEach(lx0 => {
    const x = lx0 + ox0();
    if (!lampOn(lx0)) return;
    const k = DAY.lamp * lampFlick(lx0, now);
    ctx.save(); ctx.translate(x, WATER_Y + 3); ctx.scale(1, 0.22);
    const gr = ctx.createRadialGradient(0, 0, 2, 0, 0, 52);
    gr.addColorStop(0, `rgba(${r},${g},${b},${0.32 * k})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gr; ctx.fillRect(-52, -52, 104, 104); ctx.restore();
    for (let i = 0; i < 6; i++) {                        // faíscas de luz ondulando
      const y = WATER_Y + 6 + i * 4.5, w = 10 - i * 1.2 + Math.sin(t * 1.6 + i * 1.9 + lx0) * 2.5, j = Math.sin(t * 0.9 + i * 2.3 + lx0) * 3;
      ctx.fillStyle = `rgba(${r},${g + 20},${b + 40},${(0.22 - i * 0.03) * k})`; ctx.fillRect(x - w / 2 + j, y, w, 0.9);
    }
  });
  ctx.restore();
}

// ---------- Optical flare do sol (bem sutil): raia horizontal, halo e "fantasmas" de lente ao longo da linha sol -> centro da tela ----------
// Soma luz por cima da cena (nada de escurecer). Para mexer na força: FLARE_K (1 = como está, 0 = desligado).
const FLARE_K = 1;
const FLARE_GHOSTS = [[0.55, 5, [255, 214, 150], 0.075], [1.0, 9, [150, 205, 255], 0.05], [1.45, 4, [255, 165, 205], 0.065], [1.95, 13, [175, 255, 215], 0.04]];   // [posição na linha, raio, cor, força]
function drawSunFlare(now, X, Y) {
  const e = DAY.sunE, k = DAY.sunA * Math.min(1, 0.2 + e * 1.2) * FLARE_K;       // some junto com o sol (e fica fraco com ele baixo, perto das montanhas)
  if (k < 0.02 || X < -80 || X > W + 80 || Y < -80 || Y > H) return;
  const A = k * (1 + 0.05 * Math.sin(now / 1300) + 0.03 * Math.sin(now / 410 + 1)), [r, g, b] = DAY.lc.map(Math.round);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  let gr = ctx.createLinearGradient(X - 100, 0, X + 100, 0);                        // raia horizontal fininha atravessando o sol
  gr.addColorStop(0, `rgba(${r},${g},${b},0)`); gr.addColorStop(0.5, `rgba(255,248,225,${0.16 * A})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gr; ctx.fillRect(X - 100, Y - 0.7, 200, 1.4);
  gr = ctx.createRadialGradient(X, Y, 12, X, Y, 32);                                // anel suave em volta do sol
  gr.addColorStop(0, `rgba(${r},${g},${b},0)`); gr.addColorStop(0.55, `rgba(${r},${g},${b},${0.05 * A})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gr; ctx.fillRect(X - 32, Y - 32, 64, 64);
  const dx = W / 2 - X, dy = H / 2 - Y;
  FLARE_GHOSTS.forEach(([p, R, c, a]) => {                                          // reflexos da lente: discos suaves, em cores diferentes, do lado oposto ao sol
    const x = X + dx * p, y = Y + dy * p;
    gr = ctx.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, `rgba(${c.join(",")},${a * 0.35 * A})`);
    gr.addColorStop(0.75, `rgba(${c.join(",")},${a * A})`); gr.addColorStop(1, `rgba(${c.join(",")},0)`);
    ctx.fillStyle = gr; ctx.fillRect(x - R, y - R, R * 2, R * 2);
  });
  ctx.restore();
}

function draw(now) {
  DAY.update(gameMinutes());
  if (!layers) buildLayers(now);
  if (CITY.on) { drawCity(now); return; }
  DAY.repaintSky(now);
  const ox = (W - WORLD) / 2, wx = ox + camX;              // wx = deslocamento do mundo na tela
  const lx = f => ox + camX * f - EXT;                     // posição de uma camada com fator de parallax f
  // câmera: com zoom, a cena INTEIRA é redesenhada já ampliada (nada de esticar o quadro pronto): personagens, linha, ondas e reflexo ficam nítidos
  const zk = !INTRO.on && zs > 1.003 ? zs : 1, vw = W / zk, vh = H / zk;
  const vx = zk > 1 ? Math.max(0, Math.min(W - vw, wx + px - zside * vw)) : 0, vy = zk > 1 ? Math.max(0, Math.min(H - vh, zfy - vh / 2)) : 0;
  lastView = { z: zk, sx: vx, sy: vy };
  ctx.save(); if (zk > 1) { ctx.scale(zk, zk); ctx.translate(-vx, -vy); }

  // 1) acima da água: céu, nuvens, montanhas, cais e pescadores
  ctx.drawImage(layers.sky, lx(PAR.sky), 0, LW, H);
  let tip = null;
  DAY.scene(() => {                                        // cenário (nuvens até os pescadores): desenhado à parte e recebe a lavagem de cor da hora
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
  drawLakeGlints(now, ox + camX * PAR.sky + DAY.lightX);
  ctx.drawImage(layers.deck, lx(PAR.pier), 0, LW, H);
  ctx.save(); ctx.translate(wx, 0);
  drawLamps(now);
  drawMalto(now);
  Object.values(others).forEach(o => drawOther(o, now));
  const ip = INTRO.on ? introPose(now) : undefined;                     // abertura: null = ainda não apareceu, objeto = caindo, undefined = normal
  const fPose = ip !== undefined ? ip : state === "cast" ? castPose(cs.t, cs.k0) : state === "reel" ? reelPose(now) : state === "show" ? cheerPose(now) : movePose();
  const sq = INTRO.on && ip !== null ? introSquash() : 0;
  if (sq) { ctx.save(); ctx.translate(px, PIER_Y); ctx.scale(1 + sq * 0.5, 1 - sq); ctx.translate(-px, -PIER_Y); }   // amortece a queda: agacha ao pousar
  tip = ip === null ? null : drawFisher(px, dir, me.shirt, "#d98e04", walkAmp * (1 + 0.45 * runK), fPose, { pants: me.pants, hs: hScale(me.h) });
  if (sq) ctx.restore();
  ctx.restore();
  }, [0, WATER_Y]);
  if (DAY.lamp > 0.01) { ctx.save(); ctx.translate(wx, 0); drawLampGlow(now); ctx.restore(); }   // luz dos postes (antes do reflexo, para refletir na água)

  // 2) água com reflexo
  reflect();
  ctx.drawImage(layers.water, 0, 0, W, H);
  DAY.washWater();                                         // cor da hora no fundo d'água (o reflexo já vem do cenário lavado)
  drawReflection(now);
  drawWaves(now, ox);                                      // ondas, sombras e o brilho do sol na água
  pierShadow(now, ox + camX);
  if (DAY.lamp > 0.01) drawLampWater(now);
  DAY.scene(() => ctx.drawImage(layers.posts, lx(PAR.pier), 0, LW, H), [PIER_Y + 8, PIER_Y + 42]);
  postWaves(now, ox + camX);

  // 3) linhas, boias e nomes por cima
  ctx.save(); ctx.translate(wx, 0);
  Object.values(others).forEach(o => drawOtherLine(o, now));
  if (state !== "show" && (!INTRO.on || INTRO.landed)) text(myName, px, PIER_Y - FISHER_TOP * hScale(me.h) - 6, "#ffd166", "center");
  drawMaltoUI(now);
  drawFx(now);
  drawCatch(now, wx);
  drawDust();
  if (state === "cast") drawCast(tip, cs, bobber.x);
  else if (state === "wait" || state === "bite" || state === "reel") drawLine(tip.x, tip.y, bobber.x, now, state, landT0);
  ctx.restore();

  ctx.restore();                                           // fim da câmera: a interface abaixo não é ampliada
  if (!INTRO.on) drawSunFlare(now, (ox + camX * PAR.sky + DAY.sunX - lastView.sx) * lastView.z, (DAY.sunY - lastView.sy) * lastView.z);   // flare do sol (em tela, por cima da cena)
  if (INTRO.on) introView(now);

  if (!INTRO.on) shakeView(now);                                       // tremor levinho (só o cenário; a interface abaixo não treme)

  // minigame estilo Stardew
  if (state === "reel") {
    drawReelUI(now);
  }

  if (vigK > 0.004) {                                                  // vinheta escura bem fraquinha enquanto comemora
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(8,4,20,${0.38 * vigK})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // HUD
  if (!INTRO.active) {
  text(fmtMoney(money), 10, 16, "#8be28b");
  if (invCount() > 0) text("Peixes: " + invCount(), 10, 28, "#ffd166");
  const SP = { key: "space" };
  const hint = { walk: PH.open ? "E selecionar   F ou ESC guardar o celular" : BAG.open ? "" : "I inventário", cast: "", wait: "", bite: [SP, " agora!"], reel: ["Segure ", SP, " para subir a barra"], show: "" }[state];
  hintLine(Array.isArray(hint) ? hint : [hint], 10, H - 10);
  if (msgT > 0) text(msg, W / 2, 40, "#ffd166", "center");
  }
  drawCatchUI();
  drawBag(now);
  drawPhone();                                         // por último, antes do filtro: o celular também leva o dithering
  drawTrans();
  present();
}



// ---------- Cidade (pequena, por enquanto) ----------
// Ao empurrar a ponta ESQUERDA do cais por um instante: a tela escurece, troca o cenário e clareia na cidade.
// Para voltar, empurre a ponta DIREITA da cidade (mesma transição). O pescador usa o mesmo px/dir/andar do cais; na cidade não se pesca.
const TR_OUT = 0.7, TR_HOLD = 0.35, TR_IN = 0.9;                         // segundos: escurecendo, tela preta (troca o cenário), clareando
function startTrans(to) {
  if (TR.ph === "out" || TR.ph === "hold") return;
  TR.ph = "out"; TR.t = 0; TR.to = to; TR.lock = true; spd = 0; keys.Space = false;
}
function swapScene() {
  if (TR.to === "city") { CITY.on = true; px = CITY.MAX - 24; dir = -1; cityCamX = null; cityT0 = 0; if (CITY_HD && S >= 2 && S < CITY_S) { cityPierS = S; setScale(CITY_S); } cityEnsure(); }   // monta a cidade enquanto a tela está preta
  else {
    CITY.on = false; px = 24; dir = 1;
    if (cityPierS) { setScale(Math.min(cityPierS, S)); cityPierS = 0; }
    const cu = Math.max(0, Math.min(1, (px - CAM_FAR) / (PX_MAX - CAM_FAR)));
    camX = -(px - WORLD / 2) * CAM_K - CAM_EXTRA * cu * cu * (3 - 2 * cu);   // câmera já no lugar (sem deslizar durante o fade)
  }
  spd = 0; runK = 0; brake = 0; wasBraking = false; wantDraw = false; PH.open = false; mTalk = null; tTalk = null; stepIdx = Math.floor((gaitPh - Math.PI / 2) / Math.PI);
}
function updateTrans(dt) {
  if (TR.ph === "none") return;
  TR.t += dt;
  if (TR.ph === "out" && TR.t >= TR_OUT) { TR.ph = "hold"; TR.t = 0; swapScene(); }
  else if (TR.ph === "hold" && TR.t >= TR_HOLD) { TR.ph = "in"; TR.t = 0; TR.lock = false; if (CITY.on) say("Cidade"); }
  else if (TR.ph === "in" && TR.t >= TR_IN) TR.ph = "none";
}
function trAlpha() {
  const e = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
  return TR.ph === "out" ? e(TR.t / TR_OUT) : TR.ph === "hold" ? 1 : TR.ph === "in" ? 1 - e(TR.t / TR_IN) : 0;
}
function drawTrans() {
  const a = trAlpha(); if (a <= 0.002) return;
  ctx.globalAlpha = 1; ctx.fillStyle = `rgba(4,6,14,${a.toFixed(3)})`; ctx.fillRect(0, 0, W, H);
}

// ---------- Cidade: vielas italianas (vicoli) ----------
// A cidade é comprida (CITY.MAX px): a câmera segue o pescador com zoom (CITY_Z), então cada trecho só aparece quando ele chega perto.
// Da direita (entrada, vindo do cais) para a esquerda: ruelas, cruzamentos, túneis, cafés e lojas, até a praça com fonte e a igreja.
// Fachadas e chão são pintados UMA vez num canvas (cityCache) e só o pedaço visível é copiado a cada quadro; o que se mexe (varais, gatos, fonte, portas abrindo) é desenhado por cima.
// Portas: perto de uma porta aparece o "E"; ao apertar ela abre/ou está trancada (veja cityUse). Para ligar uma porta a algo (ex.: um interior), use window.onCityDoor = d => {...}.
let cityData = null, cityCache = null, cityCamX = null, cityT0 = 0;
const CITY_HD = true;                                                    // true = cenário pintado em alta resolução e suavizado (o efeito bitmap/dithering continua ligado por cima); false = cenário na resolução normal
const CITY_S = 2, CITY_CS = 4;                                           // resolução interna na cidade (S) e do cenário pintado (pixels por unidade do mundo)
let cityPierS = 0;                                                       // resolução que o cais tinha antes de entrar na cidade
const CITY_Z = 1.5;                                                      // zoom da câmera da cidade (1 = cenário inteiro na tela)
const CITY_B = PIER_Y - 14;                                              // chão das fachadas: agora recuado, com calçada entre elas e o pescador (que anda em PIER_Y)
const CITY_CHAR = 0.82;                                                  // tamanho do pescador na cidade (1 = igual ao cais): menor = prédios e portas parecem maiores
const CITY_FARF = [0.18, 0.38, 0.62];                                    // parallax das camadas do fundo (0 = parada no céu, 1 = anda junto com o cenário): colinas, prédios longe, prédios do meio
const CITY_FRONT_F = 1.55, CITY_FRONT_GAP = 430;                         // primeiro plano (postes e vasos na frente do pescador): anda mais rápido que o cenário
const CITY_FW = -200, CITY_FX1 = CITY.MAX + 260;                         // trecho do mundo que é desenhado
const CITY_CAM_MIN = -50, CITY_CAM_PAD = 90;                             // até onde a câmera pode ir (esquerda / depois do fim da cidade)
const CITY_CH = 200;                                                     // altura (px do mundo) do que a câmera chega a ver
const CITY_GF = 54, CITY_FH = 28;                                        // altura do térreo e de cada andar de cima
const CITY_WALLS = [                                                     // [parede, sombra, destaque]
  ["#e0a85a", "#b9843f", "#efc27c"], ["#d2704a", "#a9502f", "#e48a62"], ["#ecd9a4", "#c4ad78", "#f6e8c0"], ["#dd8f7a", "#b66a58", "#eba48f"],
  ["#efcf6e", "#c8a447", "#f8e08f"], ["#c97b86", "#a05963", "#dd949d"], ["#9cb7a3", "#76927f", "#b4cdb9"], ["#8fb0c4", "#6c8ea4", "#a9c6d8"],
];
const CITY_SHUT = ["#4e7d5b", "#3c6a4c", "#4a6e96", "#7a4a2e", "#8e3b2e", "#5a7a8a", "#6b5a3a"];   // persianas
const CITY_DOOR = ["#6b4426", "#3f5a48", "#7a3b2e", "#2f4a6a", "#5a4a3a", "#8a6a3a"];
const CITY_SHOPS = ["TRATTORIA", "PESCE FRESCO", "GELATERIA", "PANETTERIA", "OSTERIA", "ENOTECA", "SALUMERIA", "PIZZERIA"];
const CITY_FLOWER = ["#d6334a", "#e86aa0", "#f2c94c", "#f08a3c", "#f4efe0"];
const CITY_STONES = ["#9a8f84", "#8c8177", "#a39889", "#85796f", "#978b7c", "#a08c78"];
const CITY_GREENS = ["#5fa04a", "#468a3c", "#2f6a34"];
const CITY_FARC = [[222, 170, 120], [214, 130, 98], [232, 206, 160], [210, 150, 140], [190, 160, 150], [225, 190, 110]];   // prédios lá longe (recebem névoa da hora)
const cityFontOK = () => !document.fonts || document.fonts.check(UI_PX + "px DigitalDisco");

function cityArch(c, x, y, w, h) {                                       // retângulo com topo em arco (x, y = canto de cima à esquerda)
  const rr = w / 2, R = Math.ceil(rr);
  for (let i = 0; i < R; i++) {
    const d = rr - i - 0.5, hf = Math.sqrt(Math.max(0, rr * rr - d * d)), x0 = Math.round(x + rr - hf), x1 = Math.round(x + rr + hf);
    rect(c, x0, y + i, x1 - x0, 1);
  }
  rect(c, x, y + R, w, h - R);
}
function cityBlob(cx, cy, rr, cols) {                                    // folhagem redondinha com 3 tons
  for (let dy = -rr; dy <= rr; dy++) { const hf = Math.round(Math.sqrt(rr * rr - dy * dy)); rect(cols[dy < -rr / 3 ? 0 : dy < rr / 3 ? 1 : 2], cx - hf, cy + dy, hf * 2, 1); }
}
function cityEll(cx, cy, rx, ry, c) {                                    // elipse cheia (de pixels)
  for (let dy = -ry; dy <= ry; dy++) { const hf = Math.round(rx * Math.sqrt(1 - (dy / (ry + .5)) * (dy / (ry + .5)))); rect(c, cx - hf, cy + dy, hf * 2, 1); }
}
const cityWireY = (x1, y1, x2, y2, sag, x) => { const u = (x - x1) / (x2 - x1); return Math.round(y1 + (y2 - y1) * u + sag * 4 * u * (1 - u)); };

function cityInit() {                                                    // o traçado da cidade (mesmo para todo mundo): sorteado com semente fixa
  const B = CITY_B;
  let s = 4242; const r = () => (s = s * 16807 % 2147483647) / 2147483647, ri = (a, b) => a + (r() * (b - a + 1) | 0);
  const blds = [], gaps = []; let x = CITY_FW, p = 0, shopI = 0;
  const addB = (w, n, g) => { p = (p + ri(2, 4)) % CITY_WALLS.length; const b = { x, w, n, g, p, top: B - CITY_GF - n * CITY_FH }; if (g === "shop") b.name = CITY_SHOPS[shopI++ % CITY_SHOPS.length]; blds.push(b); x += w; return b; };
  const addG = w => { gaps.push({ x, w, p: ri(0, CITY_WALLS.length - 1), hh: ri(60, 80) }); x += w; };
  addB(90, 2, "door");                                                   // lado esquerdo: igreja e praça com a fonte
  const ch = addB(140, 0, "church"); ch.top = B - 128;
  const piazza = { x, w: 170 }; x += piazza.w;
  const xs = CITY.MAX - 84, WMIN = { cafe: 76, shop: 66, arch: 66, shrine: 58, door: 50 };      // xs: onde começa o prédio da placa do cais
  let sinceGap = 0, sinceArch = 3, sinceCafe = 2, sinceShrine = 4, gapEvery = 3;
  while (xs - x > 0) {
    const rem = xs - x;
    if (rem > 130 && sinceGap >= gapEvery) { addG(22 + 2 * ri(0, 2)); sinceGap = 0; gapEvery = ri(3, 4); continue; }
    const wmax = Math.min(88, rem - 50);
    let w = rem <= 104 ? rem : ri(Math.min(58, wmax), wmax), g = "door";
    if (sinceArch >= 6) g = "arch"; else if (sinceCafe >= 5) g = "cafe"; else if (sinceShrine >= 7) g = "shrine"; else if (r() < .4) g = "shop";
    if (w < WMIN[g]) g = "door";
    if (g === "arch") sinceArch = 0; if (g === "cafe") sinceCafe = 0; if (g === "shrine") sinceShrine = 0;
    const n = ri(0, 4) === 0 ? 1 : ri(2, 3);
    addB(w, g === "cafe" || g === "arch" ? Math.max(2, n) : n, g);
    sinceGap++; sinceArch++; sinceCafe++; sinceShrine++;
  }
  addB(116, 2, "sign");                                                  // prédio da placa "CAIS >" (a saída da cidade)
  while (x < CITY_FX1 + 40) addB(ri(70, 90), ri(2, 3), r() < .4 ? "shop" : "door");
  const far = [];
  for (let fx = CITY_FW; fx < CITY_FX1; ) { const w = ri(20, 36), h = ri(44, 100); far.push({ x: fx, w, h, c: ri(0, CITY_FARC.length - 1) }); fx += w + ri(0, 2); }
  const towers = []; for (let tx = 60; tx < CITY_FX1; tx += ri(430, 560)) towers.push(tx);
  const far2 = [];                                                       // prédios bem longe: mais altos, mais largos e mais enevoados
  for (let fx = CITY_FW; fx < CITY_FX1; ) { const w = ri(26, 46), h = ri(78, 140); far2.push({ x: fx, w, h, c: ri(0, CITY_FARC.length - 1) }); fx += w + ri(0, 6); }
  cityData = { blds, gaps, piazza, fountain: { x: piazza.x + 85 }, far, far2, towers, wins: [], lamps: [], bulbs: [], lines: [], doors: [], cats: [] };
  gaps.forEach((gp, i) => { if (i % 3 === 1) cityData.cats.push(gp.x + (gp.w >> 1)); });
}

// ==================== Cidade em ilustração vetorial (formas suaves, degradês, sombras) ====================
// Tudo aqui é pintado UMA vez no cache (cityCache) em alta resolução. Nada de pixel art: curvas, cantos arredondados, vidro com reflexo, madeira com veios etc.
const vHex = c => c[0] === "#" ? [1, 3, 5].map(i => parseInt(c.substr(i, 2), 16)) : c.match(/[\d.]+/g).slice(0, 3).map(Number);
const vMix = (a, b, f) => { const A = vHex(a), Bb = vHex(b); return "rgb(" + A.map((v, i) => Math.round(v + (Bb[i] - v) * f)).join(",") + ")"; };
const vDark = (c, f) => vMix(c, "#140a1e", f), vLight = (c, f) => vMix(c, "#fff4dc", f);
function vRR(x, y, w, h, rd, fill) {                                      // retângulo de cantos arredondados (só caminho; pinta se passar a cor)
  const q = Math.max(0, Math.min(rd, w / 2, h / 2)); ctx.beginPath();
  ctx.moveTo(x + q, y); ctx.lineTo(x + w - q, y); ctx.arcTo(x + w, y, x + w, y + q, q); ctx.lineTo(x + w, y + h - q); ctx.arcTo(x + w, y + h, x + w - q, y + h, q);
  ctx.lineTo(x + q, y + h); ctx.arcTo(x, y + h, x, y + h - q, q); ctx.lineTo(x, y + q); ctx.arcTo(x, y, x + q, y, q); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}
function vArchP(x, y, w, h) { const q = w / 2; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + q); ctx.arc(x + q, y + q, q, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath(); }
function vArch(x, y, w, h, fill) { vArchP(x, y, w, h); ctx.fillStyle = fill; ctx.fill(); }
function vLG(x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function vRG(x, y, r0, r1, stops) { const g = ctx.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function vCirc(x, y, q, fill) { ctx.beginPath(); ctx.arc(x, y, q, 0, 6.2832); ctx.fillStyle = fill; ctx.fill(); }
function vEll(x, y, rx, ry, fill) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832); ctx.fillStyle = fill; ctx.fill(); }
function vLine(x1, y1, x2, y2, w, col) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineCap = "round"; ctx.stroke(); }
function vWire(x1, y1, x2, y2, sag, w, col) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + sag * 2, x2, y2); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineCap = "round"; ctx.stroke(); }
function vPoly(pts, fill) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
function vSoft(x, y, w, h, a = .3, col = "20,8,26") { ctx.fillStyle = vLG(0, y, 0, y + h, [[0, "rgba(" + col + "," + a + ")"], [1, "rgba(" + col + ",0)"]]); ctx.fillRect(x, y, w, h); }   // sombra que some para baixo
function vText(s, x, y, col, size, maxW, shadow) {
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.font = "bold " + size + "px Georgia, 'Times New Roman', serif";
  if (maxW) { const wd = ctx.measureText(s).width; if (wd > maxW) { size *= maxW / wd; ctx.font = "bold " + size + "px Georgia, 'Times New Roman', serif"; } }
  if (shadow) { ctx.fillStyle = shadow; ctx.fillText(s, x + .3, y + .4); }
  ctx.fillStyle = col; ctx.fillText(s, x, y); ctx.restore();
}
function vBlot(cx, cy, q, col, a) { ctx.fillStyle = vRG(cx, cy, 0, q, [[0, "rgba(" + col + "," + a + ")"], [1, "rgba(" + col + ",0)"]]); ctx.fillRect(cx - q, cy - q, q * 2, q * 2); }
function vBush(cx, cy, q, pk, r) {                                         // moita: círculos sobrepostos em 3 tons
  const g = [vMix(pk(CITY_GREENS), "#0a2010", .25), pk(CITY_GREENS), vLight(pk(CITY_GREENS), .15)];
  for (let i = 0; i < 5; i++) { const a = i * 1.26 + r(), dx = Math.cos(a) * q * .55, dy = Math.sin(a) * q * .4; vCirc(cx + dx, cy + dy + q * .15, q * (.55 + r() * .2), g[0]); }
  for (let i = 0; i < 5; i++) { const a = i * 1.26 + 1 + r(), dx = Math.cos(a) * q * .5, dy = Math.sin(a) * q * .35 - q * .1; vCirc(cx + dx, cy + dy, q * (.48 + r() * .15), g[1]); }
  vCirc(cx - q * .15, cy - q * .3, q * .42, g[2]);
}

function vShutter(x, y, w, h, col) {                                       // veneziana de madeira
  vRR(x + .4, y + .7, w, h, .7, "rgba(20,8,26,.2)");
  vRR(x, y, w, h, .7, vLG(x, 0, x + w, 0, [[0, vLight(col, .2)], [1, vDark(col, .22)]]));
  ctx.fillStyle = "rgba(0,0,0,.24)"; for (let q = 1.3; q < h - .6; q += 1.7) ctx.fillRect(x + .5, y + q, w - 1, .5);
  ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.fillRect(x + .35, y + .4, .6, h - .8);
}
function vGlass(x, y, w, h, arch, cross) {
  const p = () => arch ? vArchP(x, y, w, h) : vRR(x, y, w, h, .7);
  p(); ctx.fillStyle = vLG(x, y, x, y + h, [[0, "#b4d6ec"], [.5, "#7aa3c6"], [1, "#46688f"]]); ctx.fill();
  ctx.save(); p(); ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,.24)"; ctx.beginPath(); ctx.moveTo(x + w * .05, y + h); ctx.lineTo(x + w * .55, y); ctx.lineTo(x + w * .85, y); ctx.lineTo(x + w * .35, y + h); ctx.closePath(); ctx.fill();
  vSoft(x, y, w, Math.min(3.5, h * .35), .5, "10,20,40");
  ctx.restore();
  if (cross) { ctx.fillStyle = "#f0e8d2"; ctx.fillRect(x + w / 2 - .42, y, .84, h); ctx.fillRect(x, y + h * .5 - .42, w, .84); }
}
function vWin(x, y, w, h, o) {                                              // janela: moldura de pedra, vidro com reflexo, caixilho e peitoril
  const arch = !!o.arch, fr = o.frame || "#ebe1c8";
  if (arch) vArchP(x - 1.4, y - 1.4, w + 2.8, h + 1.4); else vRR(x - 1.4, y - 1.4, w + 2.8, h + 2.8, 1.1);
  ctx.fillStyle = vLG(x, 0, x + w, 0, [[0, vLight(fr, .15)], [1, vDark(fr, .12)]]); ctx.fill();
  vGlass(x, y, w, h, arch, o.cross !== false);
  if (o.sill !== false) { vRR(x - 2, y + h + .8, w + 4, 1.7, .8, vLG(0, y + h, 0, y + h + 2.5, [[0, "#f0e7d0"], [1, "#cdc0a4"]])); vSoft(x - 1.5, y + h + 2.5, w + 3, 3.4, .3); }
}
function vFlowerBox(x, y, w, r, pk) {
  vRR(x, y, w, 3.2, .8, vLG(0, y, 0, y + 3.2, [[0, "#9a6240"], [1, "#6a3e26"]]));
  for (let q = x + 1; q < x + w - .5; q += 1.7) { vCirc(q, y - .4 - r() * 1.1, 1.3, pk(CITY_GREENS)); if (r() < .8) vCirc(q + .2, y - 1.7 - r() * 1.2, .85, pk(CITY_FLOWER)); }
}
function vLantern(lx, ly, D) {                                              // lampião de parede (o brilho de noite vem do cityLit)
  vLine(lx + 1.5, ly - 4, lx + 1.5, ly, .7, "#2a2d35");
  vPoly([[lx - .8, ly], [lx + 3.8, ly], [lx + 2.9, ly - 1.4], [lx + .1, ly - 1.4]], "#2a2d35");
  vRR(lx - .1, ly + .2, 3.2, 4.8, .9, vLG(0, ly, 0, ly + 5, [[0, "#fff0b8"], [1, "#e8b052"]]));
  vRR(lx - .9, ly + 4.9, 4.8, 1, .5, "#2a2d35");
  D.lamps.push({ x: lx + 1.5, y: ly + 3, r: 34 });
}
function vPot(px0, big, B, r, pk) {
  const hh = big ? 7 : 6, cx = px0 + 2.5;
  vBush(cx, B - hh - 2.5, big ? 4.2 : 3.4, pk, r);
  vPoly([[px0 - .4, B - hh], [px0 + 5.4, B - hh], [px0 + 4.5, B], [px0 + .5, B]], vLG(px0, 0, px0 + 5, 0, [[0, "#d37a46"], [.6, "#b4532f"], [1, "#84381f"]]));
  vRR(px0 - 1, B - hh - .3, 7, 1.5, .6, "#dc8450");
  if (r() < .8) vCirc(cx + (r() - .5) * 3, B - hh - 4.5 - r() * 2, .85, pk(CITY_FLOWER));
  vEll(cx + 1, B + .2, 4.2, .9, "rgba(20,8,26,.28)");
}
function vDoor(dx, dcol, B) {                                               // porta em arco: moldura de pedra, tábuas, almofadas, bandeira de vidro, maçaneta e degrau
  vArch(dx - 2.2, B - 46.2, 18.4, 46, vLG(dx, 0, dx + 14, 0, [[0, "#f0e6cc"], [1, "#cdbf9f"]]));
  vArch(dx - .5, B - 44.5, 15, 42.5, "#241820");
  vArch(dx, B - 44, 14, 42, vLG(dx, 0, dx + 14, 0, [[0, vLight(dcol, .12)], [.5, dcol], [1, vDark(dcol, .3)]]));
  ctx.save(); vArchP(dx, B - 44, 14, 42); ctx.clip();
  ctx.fillStyle = "rgba(0,0,0,.2)"; for (let xx = dx + 2.3; xx < dx + 14; xx += 2.3) ctx.fillRect(xx, B - 30, .45, 30);
  ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = .6; vRR(dx + 2.2, B - 27, 9.6, 12, 1); ctx.stroke(); vRR(dx + 2.2, B - 12.5, 9.6, 9, 1); ctx.stroke();
  ctx.strokeStyle = "rgba(255,230,190,.22)"; ctx.lineWidth = .4; vRR(dx + 2.5, B - 26.6, 9.6, 12, 1); ctx.stroke();
  ctx.restore();
  vGlass(dx + 3.8, B - 40, 6.4, 8.4, true, true);
  vCirc(dx + 11.2, B - 17.5, 1, "#e6bc6a"); vCirc(dx + 10.9, B - 17.8, .35, "#fff0c0");
  vRR(dx - 3, B - 2.3, 20, 2.6, .9, vLG(0, B - 2.3, 0, B + .3, [[0, "#e2d6bc"], [1, "#b2a68e"]])); vSoft(dx - 3, B + .3, 20, 2.6, .25);
}
function vRoofTiles(bl, br, y0, hh, ins, bi) {                              // telhado de barro: degradê, fileiras de telhas e brilho na cumeeira
  const p = () => { ctx.beginPath(); ctx.moveTo(bl, y0); ctx.lineTo(br, y0); ctx.lineTo(br - ins, y0 - hh); ctx.lineTo(bl + ins, y0 - hh); ctx.closePath(); };
  p(); ctx.fillStyle = vLG(0, y0 - hh, 0, y0, [[0, "#d98558"], [.55, "#bd5c36"], [1, "#9a4228"]]); ctx.fill();
  ctx.save(); p(); ctx.clip();
  for (let yy = y0 - hh + 2.2, row = 0; yy < y0; yy += 2.3, row++) {
    ctx.fillStyle = "rgba(70,25,15,.32)"; ctx.fillRect(bl, yy, br - bl, .5); ctx.fillStyle = "rgba(255,205,160,.2)"; ctx.fillRect(bl, yy + .5, br - bl, .4);
    ctx.fillStyle = "rgba(70,25,15,.2)"; for (let tx = bl + (row % 2) * 1.5; tx < br; tx += 3) ctx.fillRect(tx, yy + .8, .4, 1.5);
  }
  vSoft(bl, y0 - 3.5, br - bl, 3.5, .22, "50,16,12");
  ctx.restore();
  vRR(bl + ins - 1, y0 - hh - .9, br - bl - ins * 2 + 2, 1.7, .8, vLG(0, y0 - hh - .9, 0, y0 - hh + .8, [[0, "#f0a070"], [1, "#c8663c"]]));
  vRR(bl - .8, y0 - .5, br - bl + 1.6, 2.6, .9, vLG(0, y0 - .5, 0, y0 + 2.1, [[0, "#7a3a26"], [1, "#4a2418"]]));
}

// ---- chão: calçada de lajotas, meio-fio e rua de paralelepípedos em perspectiva
function vGround(D, B, FW, CWD, r, ri, pk) {
  const X1 = FW + CWD, bot = CITY_CH;
  ctx.fillStyle = vLG(0, B + 18, 0, bot, [[0, "#6c615b"], [.45, "#786c63"], [1, "#4e4540"]]); ctx.fillRect(FW, B + 14, CWD, bot - B - 14);
  for (let y = B + 22; y < bot;) {
    const h = 3.4 + (y - B) / 24, sw0 = 8 + h * 1.5, k = (y - B) / (bot - B);
    for (let sx = FW - r() * 10; sx < X1;) {
      const sw = sw0 + r() * 5;
      vRR(sx + .35, y + .3, sw - .7, h - .6, 1.3, vMix(pk(CITY_STONES), "#3a3038", .22 + .2 * k));
      vRR(sx + .8, y + .45, sw - 1.6, .8, .4, "rgba(255,240,215,.13)");
      sx += sw;
    }
    y += h;
  }
  for (let gx0 = FW + 40; gx0 < X1; gx0 += 130 + ri(0, 60)) {               // bueiros
    vEll(gx0 + 8, B + 36, 9, 2.4, "#2c2622"); vEll(gx0 + 8, B + 36, 8, 1.9, "#3a332e");
    for (let q = -6; q <= 6; q += 3) vLine(gx0 + 8 + q, B + 35.2, gx0 + 8 + q, B + 37, .5, "#5a5048");
  }
  ctx.fillStyle = vLG(0, B, 0, B + 18, [[0, "#b8ad9c"], [1, "#a29787"]]); ctx.fillRect(FW, B, CWD, 18);   // calçada
  for (let row = 0; row < 2; row++) for (let x = FW - (row ? 7 : 0); x < X1; x += 14) {
    vRR(x + .35, B + row * 9 + .35, 13.3, 8.3, .9, vMix("#b6ab9a", "#8a8070", r() * .5));
    vRR(x + .7, B + row * 9 + .5, 12.6, .8, .4, "rgba(255,248,230,.25)");
  }
  ctx.fillStyle = vLG(0, B + 18, 0, B + 22, [[0, "#e6dcc8"], [.22, "#cfc4b0"], [.3, "#80756a"], [1, "#40372f"]]); ctx.fillRect(FW, B + 18, CWD, 4);   // meio-fio
  vSoft(FW, B + 22, CWD, 9, .38, "12,6,18");
  vSoft(FW, B, CWD, 11, .5, "28,16,40");                                    // sombra das paredes na calçada
}

// ---- praça: balaústres, ciprestes, pinheiro-manso, fonte, bancos e postes
function vPiazza(D, B, r, pk) {
  const P = D.piazza, fx = D.fountain.x;
  const cypress = (cx, hh) => {
    const top = B - 10 - hh, wd = 5.2;
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.bezierCurveTo(cx + wd * 1.1, top + hh * .35, cx + wd * 1.15, top + hh * .8, cx + 1, B - 9); ctx.lineTo(cx - 1, B - 9);
    ctx.bezierCurveTo(cx - wd * 1.15, top + hh * .8, cx - wd * 1.1, top + hh * .35, cx, top); ctx.closePath();
    ctx.fillStyle = vLG(cx - wd, 0, cx + wd, 0, [[0, "#1f4a2c"], [.45, "#336a3e"], [1, "#183a22"]]); ctx.fill();
    ctx.save(); ctx.clip(); ctx.strokeStyle = "rgba(10,40,20,.35)"; ctx.lineWidth = .5;
    for (let i = 0; i < hh; i += 2.6) { ctx.beginPath(); ctx.moveTo(cx - wd, top + i + 3); ctx.quadraticCurveTo(cx, top + i - 1, cx + wd, top + i + 3); ctx.stroke(); }
    ctx.restore(); vRR(cx - 1, B - 12, 2, 4, .5, "#2a1c14");
  };
  [P.x + 14, P.x + 52, P.x + 118, P.x + 158].forEach((cx, i) => { vEll(cx, B - 9, 7, 1.4, "rgba(20,8,26,.22)"); cypress(cx, 54 + (i % 2) * 14); });
  const pn = P.x + 86;                                                      // pinheiro-manso
  ctx.beginPath(); ctx.moveTo(pn - 1.2, B - 9); ctx.bezierCurveTo(pn - 2.5, B - 28, pn + 2, B - 36, pn + .5, B - 47); ctx.lineTo(pn + 3, B - 47); ctx.bezierCurveTo(pn + 4.5, B - 36, pn + 1.5, B - 28, pn + 2.6, B - 9); ctx.closePath(); ctx.fillStyle = vLG(pn - 2, 0, pn + 3, 0, [[0, "#6a4630"], [1, "#3c2618"]]); ctx.fill();
  [[0, 6, 25, "#25562d"], [-13, 9, 11, "#2f6a34"], [14, 10, 12, "#245026"], [0, 4, 20, "#3b8040"], [-6, 1, 12, "#4a9448"], [8, 3, 11, "#3d8442"]].forEach(([dx, dy, q, c]) => { ctx.save(); ctx.translate(pn + 1 + dx, B - 50 + dy); ctx.scale(1, .36); vCirc(0, 0, q, c); ctx.restore(); });
  vRR(P.x - 2, B - 12.5, P.w + 4, 3, 1.2, vLG(0, B - 12.5, 0, B - 9.5, [[0, "#ece2c8"], [1, "#c4b79a"]]));        // muretinha
  vRR(P.x, B - 9.5, P.w, 1, .4, "#b8aa98");
  for (let bx = P.x + 1; bx < P.x + P.w - 2; bx += 6) {                      // balaústres
    ctx.beginPath(); ctx.moveTo(bx + .8, B - 9); ctx.quadraticCurveTo(bx + 2.4, B - 7.8, bx + 1.4, B - 6.4); ctx.quadraticCurveTo(bx + 3.2, B - 4.6, bx + 1.3, B - 3.2); ctx.lineTo(bx + 2.9, B - .6); ctx.lineTo(bx - .5, B - .6); ctx.lineTo(bx + 1.1, B - 3.2);
    ctx.quadraticCurveTo(bx - .7, B - 4.6, bx + 1.1, B - 6.4); ctx.quadraticCurveTo(bx + .1, B - 7.8, bx + .8, B - 9); ctx.closePath();
    ctx.fillStyle = vLG(bx - 1, 0, bx + 3.2, 0, [[0, "#f0e6cc"], [1, "#b8aa90"]]); ctx.fill();
  }
  vRR(P.x - 1, B - .8, P.w + 2, 1.2, .5, "#a89a82");
  for (let bx = P.x; bx < P.x + P.w; bx += 42) { vRR(bx - 1.2, B - 14, 5.6, 14, 1, vLG(bx - 1, 0, bx + 4, 0, [[0, "#ece2c8"], [1, "#b8aa90"]])); vRR(bx - 1.8, B - 15.4, 6.8, 2, .9, "#f2e9d2"); }
  // fonte
  vEll(fx, B + 3, 31, 3.6, "rgba(20,8,26,.28)");
  vRR(fx - 27, B - 4, 54, 7, 3.2, vLG(0, B - 4, 0, B + 3, [[0, "#d8ccb0"], [1, "#9a8c76"]]));
  vEll(fx, B - 4, 27, 5.4, "#e6dbc0"); vEll(fx, B - 3.6, 24, 4.4, vLG(0, B - 8, 0, B, [[0, "#7ec0dc"], [1, "#4f93b6"]]));
  ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = .4; for (let q = 0; q < 3; q++) { ctx.beginPath(); ctx.ellipse(fx, B - 3.6, 10 + q * 5, 1.8 + q * .8, 0, 3.3, 6); ctx.stroke(); }
  vRR(fx - 3.4, B - 32, 6.8, 29, 2.4, vLG(fx - 3, 0, fx + 3, 0, [[0, "#ece2c8"], [1, "#a89a82"]]));
  vRR(fx - 6, B - 20, 12, 3, 1.4, "#d8ccb0");
  vEll(fx, B - 31, 13, 3.6, "#e6dbc0"); vEll(fx, B - 31.2, 10.6, 2.6, vLG(0, B - 34, 0, B - 29, [[0, "#8fcce4"], [1, "#5aa0c0"]]));
  vRR(fx - 1.2, B - 41, 2.4, 10, 1.2, "#e6dcc2"); vCirc(fx, B - 42.4, 2.2, "#f2e9d2");
  [fx - 62, fx + 40].forEach(bx => {                                         // bancos
    vEll(bx + 12, B + 5, 14, 1.6, "rgba(20,8,26,.28)");
    ctx.strokeStyle = "#2a2d35"; ctx.lineWidth = .9; ctx.lineCap = "round";
    [bx + 2, bx + 22].forEach(lx => { ctx.beginPath(); ctx.moveTo(lx, B - 13); ctx.lineTo(lx, B - 4); ctx.quadraticCurveTo(lx, B + 4, lx + (lx < bx + 10 ? -2.2 : 2.2), B + 4); ctx.stroke(); });
    vRR(bx, B - 6, 24, 2.8, 1, vLG(0, B - 6, 0, B - 3.2, [[0, "#b07a3e"], [1, "#7c4e26"]]));
    [B - 13.5, B - 10.2].forEach(yy => vRR(bx + .5, yy, 23, 2, .9, vLG(0, yy, 0, yy + 2, [[0, "#a06c38"], [1, "#6e4424"]])));
  });
  [P.x + 20, P.x + P.w - 22].forEach(lx => {                                 // postes antigos
    vEll(lx + 1, B, 4.2, 1, "rgba(20,8,26,.28)");
    ctx.beginPath(); ctx.moveTo(lx - 2.6, B); ctx.quadraticCurveTo(lx, B - 3, lx - .4, B - 8); ctx.lineTo(lx + 2.4, B - 8); ctx.quadraticCurveTo(lx + 2, B - 3, lx + 4.6, B); ctx.closePath(); ctx.fillStyle = "#2a2d35"; ctx.fill();
    vRR(lx - .1, B - 46, 2.2, 38, 1, "#2a2d35");
    ctx.strokeStyle = "#2a2d35"; ctx.lineWidth = .7; ctx.beginPath(); ctx.arc(lx - 2.4, B - 41, 2.4, 0, 3.6); ctx.stroke();
    vPoly([[lx - 3.4, B - 47], [lx + 5.4, B - 47], [lx + 3.6, B - 50.4], [lx - 1.6, B - 50.4]], "#2a2d35");
    vRR(lx - 2.2, B - 47, 6.4, 6.6, 1.4, vLG(0, B - 47, 0, B - 40, [[0, "#fff0b8"], [1, "#e8b052"]]));
    ctx.strokeStyle = "#2a2d35"; ctx.lineWidth = .4; ctx.beginPath(); ctx.moveTo(lx + 1, B - 47); ctx.lineTo(lx + 1, B - 40.4); ctx.stroke();
    vRR(lx - 2.6, B - 40.6, 7.2, 1.2, .5, "#2a2d35"); vCirc(lx + 1, B - 51.4, 1, "#2a2d35");
    D.lamps.push({ x: lx + 1, y: B - 44, r: 42 });
  });
}

// ---- vielas que cortam a rua (ao fundo: escadinha, parede, portinha, lanterna)
function vGap(D, gp, B, r, pk) {
  const wc = CITY_WALLS[gp.p], x = gp.x, w = gp.w, top = B - 12 - gp.hh;
  ctx.fillStyle = vLG(0, top, 0, B, [[0, vMix(wc[1], "#2a1840", .35)], [1, vMix(wc[1], "#2a1840", .62)]]); ctx.fillRect(x, top, w, gp.hh + 12);
  vBlot(x + w / 2, B - 20, 26, "255,214,150", .22);
  vRoofTiles(x - 1.5, x + w + 1.5, top, 5, 2, 0);
  const dw = 8, dx = x + (w - dw) / 2;
  vArch(dx - 1.2, B - 35.2, dw + 2.4, 23.2, "#d8ccb0"); vArch(dx, B - 34, dw, 22, "#241820"); vArch(dx + 1.6, B - 25, dw - 3.2, 13, vLG(0, B - 25, 0, B - 12, [[0, "#f6d28a"], [1, "#e3a050"]]));
  for (let q = 0; q < 2; q++) { const wx = x + 2.5 + q * (w - 11); vShutter(wx - 2.4, top + 7, 2.2, 10, CITY_SHUT[(gp.p + q) % 7]); vShutter(wx + 6.2, top + 7, 2.2, 10, CITY_SHUT[(gp.p + q) % 7]); vGlass(wx, top + 7, 6, 10, false, true); }
  for (let q = 0; q < 4; q++) {                                              // degraus
    const yy = B - 12 + q * 3; vRR(x - .5, yy, w + 1, 3, .6, vLG(0, yy, 0, yy + 3, [[0, "#c2b49c"], [.35, "#9a8c76"], [1, "#6a5e52"]]));
  }
  const lx = x + w / 2;
  vLine(lx, top + 2, lx, B - 46, .6, "#2a2d35"); vLine(lx, B - 46, lx, B - 48, .6, "#2a2d35");
  vPoly([[lx - 2.4, B - 48], [lx + 2.4, B - 48], [lx + 1.4, B - 49.6], [lx - 1.4, B - 49.6]], "#2a2d35");
  vRR(lx - 1.6, B - 48, 3.2, 4.6, .9, vLG(0, B - 48, 0, B - 43, [[0, "#fff0b8"], [1, "#e8b052"]])); vRR(lx - 2.4, B - 43.4, 4.8, .9, .4, "#2a2d35");
  D.lamps.push({ x: lx, y: B - 45, r: 26 });
}

// ---- igreja
function vChurch(D, b, B, r, ri, pk) {
  const x = b.x, w = b.w, top = b.top, ht = B - top, cx = x + w / 2, dh = 52, ry = top + 34;
  ctx.fillStyle = vLG(0, top, 0, B, [[0, "#f1e6c4"], [.5, "#e6d6a8"], [1, "#cdb98c"]]); ctx.fillRect(x, top, w, ht);
  for (let i = 0, nn = w * ht / 220 | 0; i < nn; i++) vBlot(x + r() * w, top + r() * ht, 4 + r() * 8, r() < .5 ? "120,70,40" : "255,248,225", .07 + r() * .05);
  for (const px0 of [x + 2, x + w - 11]) {                                   // pilastras com capitel e base
    vRR(px0, top, 9, ht, 1, vLG(px0, 0, px0 + 9, 0, [[0, "#ece2c8"], [.55, "#d8ccb0"], [1, "#b2a384"]]));
    vRR(px0 - 1, top + 2, 11, 3.4, 1.2, "#f2e9d2"); vRR(px0 - 1, B - 6, 11, 4.4, 1.2, "#c9bc9e");
  }
  vRR(x - 3, top - 3.6, w + 6, 5, 1.6, vLG(0, top - 4, 0, top + 1, [[0, "#f2e9d2"], [1, "#b8aa90"]]));
  ctx.beginPath(); ctx.moveTo(x - 2, top - 3); ctx.lineTo(x + w + 2, top - 3); ctx.lineTo(cx, top - 3 - (w + 4) / 2 / 2.2); ctx.closePath(); ctx.fillStyle = vLG(0, top - 36, 0, top - 3, [[0, "#f2e9d2"], [1, "#d2c5a6"]]); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 9, top - 5); ctx.lineTo(x + w - 9, top - 5); ctx.lineTo(cx, top - 5 - (w - 18) / 2 / 2.2); ctx.closePath(); ctx.fillStyle = vLG(0, top - 30, 0, top - 5, [[0, "#ecdfba"], [1, "#e0cf9c"]]); ctx.fill();
  vSoft(x, top + 1.4, w, 8, .26, "40,24,20");
  vRR(x, B - 79, w, 3.4, 1.2, vLG(0, B - 79, 0, B - 75.6, [[0, "#ece2c8"], [1, "#b8aa90"]])); vSoft(x, B - 75.6, w, 4, .22);
  vCirc(cx, ry, 14.2, vLG(0, ry - 14, 0, ry + 14, [[0, "#f2e9d2"], [1, "#b8aa90"]]));      // rosácea
  vCirc(cx, ry, 11, "#1f2f50");
  const cols = ["#c0392b", "#2d5a8a", "#e8b838", "#2f8a5f"];
  for (let a = 0; a < 8; a++) { ctx.beginPath(); ctx.moveTo(cx, ry); ctx.arc(cx, ry, 10.2, a * .7854 + .05, (a + 1) * .7854 - .05); ctx.closePath(); ctx.fillStyle = cols[a % 4]; ctx.fill(); }
  vCirc(cx, ry, 10.2, vRG(cx, ry, 0, 10.2, [[0, "rgba(255,240,200,.5)"], [1, "rgba(255,240,200,0)"]]));
  ctx.strokeStyle = "#e6dcc0"; ctx.lineWidth = .7; for (let a = 0; a < 8; a++) { ctx.beginPath(); ctx.moveTo(cx, ry); ctx.lineTo(cx + Math.cos(a * .7854) * 10.4, ry + Math.sin(a * .7854) * 10.4); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(cx, ry, 5.5, 0, 6.3); ctx.stroke(); vCirc(cx, ry, 2.4, "#f0d890");
  D.wins.push({ x: cx - 10, y: ry - 10, w: 20, h: 20, lit: true, soft: true, round: true });
  for (const sx of [cx - 50, cx + 40]) {                                     // nichos com estátuas
    vArch(sx - 1.4, B - 75.4, 13, 34, "#e2d8bc"); vArch(sx, B - 74, 10, 32, vLG(0, B - 74, 0, B - 42, [[0, "#2e2220"], [1, "#4a3830"]]));
    ctx.beginPath(); ctx.moveTo(sx + 5, B - 66); ctx.bezierCurveTo(sx + 9.6, B - 62, sx + 9.6, B - 52, sx + 8.6, B - 46); ctx.lineTo(sx + 1.4, B - 46); ctx.bezierCurveTo(sx + .4, B - 52, sx + .4, B - 62, sx + 5, B - 66); ctx.fillStyle = vLG(sx, 0, sx + 10, 0, [[0, "#f4eee0"], [1, "#b8b0a0"]]); ctx.fill();
    vCirc(sx + 5, B - 68.4, 2.2, "#f4eee0"); vRR(sx - 1.4, B - 44.4, 13, 2.4, 1, "#d8ccb0");
  }
  vArch(dx0(cx, -17), B - dh - 4.2, 34, dh + 4.2, vLG(cx - 17, 0, cx + 17, 0, [[0, "#f0e6cc"], [1, "#b8aa90"]]));
  vArch(cx - 13.4, B - dh - 2, 26.8, dh, "#241820");
  vArch(cx - 12, B - dh, 24, dh - 2, vLG(cx - 12, 0, cx + 12, 0, [[0, "#7a5034"], [.5, "#5a3a24"], [1, "#3e2616"]]));
  ctx.save(); vArchP(cx - 12, B - dh, 24, dh - 2); ctx.clip();
  ctx.fillStyle = "rgba(0,0,0,.26)"; for (let xx = cx - 9.5; xx < cx + 12; xx += 3.6) ctx.fillRect(xx, B - dh + 9, .5, dh - 11);
  ctx.fillStyle = "#2a2d35"; ctx.fillRect(cx - 12, B - 36, 24, 1.2); ctx.fillRect(cx - 12, B - 18, 24, 1.2); ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(cx - .3, B - dh + 9, .6, dh);
  ctx.restore();
  vCirc(cx - 3, B - 26, 1.3, "#e6bc6a"); vCirc(cx + 3, B - 26, 1.3, "#e6bc6a");
  vRR(cx - 20, B - 4, 40, 2.6, 1, "#d8ccb0"); vRR(cx - 23, B - 2, 46, 2.4, 1, vLG(0, B - 2, 0, B + .4, [[0, "#e2d6bc"], [1, "#a89c84"]])); vSoft(cx - 23, B + .4, 46, 3, .25);
  vLantern(cx - 27, B - 40, D); vLantern(cx + 25, B - 40, D);
  D.doors.push({ cx, x: cx - 12, y: B - dh, w: 24, h: dh - 2, arch: true, col: "#5a3a24", kind: "church", o: 0, t: 0 });
  vSoft(x, top, w, ht, 0);
}
const dx0 = (cx, o) => cx + o;

// ---- prédios comuns (fachada, janelas, térreo, telhado)
function vBuilding(D, b, bi, B, r, ri, pk) {
  const GF = CITY_GF, FH = CITY_FH;
  const wc = CITY_WALLS[b.p], x = b.x, w = b.w, top = b.top, ht = B - top, shc = CITY_SHUT[(b.p * 3 + bi) % CITY_SHUT.length];
  // parede: degradê vertical, volume nas laterais e manchas de reboco
  ctx.fillStyle = vLG(0, top, 0, B, [[0, vLight(wc[0], .1)], [.35, wc[0]], [1, vMix(wc[0], wc[1], .55)]]); ctx.fillRect(x, top, w, ht);
  for (let i = 0, nn = w * ht / 150 | 0; i < nn; i++) vBlot(x + r() * w, top + r() * ht, 3 + r() * 7, r() < .5 ? "110,60,40" : "255,246,225", .06 + r() * .06);
  for (let q = 0, np = ri(1, 2); q < np; q++) {                              // reboco caído, aparecendo o tijolo
    const bw = ri(7, 12), bh = ri(6, 10), bx = x + ri(3, w - 15), by = top + ri(8, Math.max(9, ht - 34));
    ctx.save(); ctx.beginPath(); for (let a = 0; a < 9; a++) { const an = a / 9 * 6.2832, rr = .8 + r() * .35; ctx.lineTo(bx + bw / 2 + Math.cos(an) * bw / 2 * rr, by + bh / 2 + Math.sin(an) * bh / 2 * rr); } ctx.closePath(); ctx.clip();
    ctx.fillStyle = "#b0603f"; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4); ctx.fillStyle = "rgba(60,20,12,.35)"; for (let yy = 1.4; yy < bh + 2; yy += 2.4) ctx.fillRect(bx - 2, by + yy, bw + 4, .45);
    ctx.restore();
  }
  ctx.fillStyle = vLG(x, 0, x + w, 0, [[0, "rgba(255,246,225,.22)"], [.04, "rgba(255,246,225,0)"], [.84, "rgba(30,14,44,0)"], [1, "rgba(30,14,44,.34)"]]); ctx.fillRect(x, top, w, ht);
  if (bi % 3 === 1) {                                                        // calha
    vRR(x + w - 5.5, top + 2, 1.9, ht - 6, .9, vLG(x + w - 6, 0, x + w - 3, 0, [[0, "#8a7a68"], [1, "#4e4338"]]));
    for (let yy = top + 8; yy < B - 6; yy += 14) vRR(x + w - 6.2, yy, 3.3, 1, .4, "#a89886");
    vRR(x + w - 8, B - 5.5, 4.2, 2, .9, "#5a4e42");
  }
  if (bi % 4 === 2 && w > 56) {                                              // trepadeira com flores
    const vx = x + w - 28, vh = ri(46, 66);
    for (let i = 0; i < 70; i++) { const vy = B - 4 - vh * Math.pow(r(), 1.5), vxx = vx + r() * 24, q = 1.2 + r() * 1.4; vCirc(vxx, vy, q, vMix(pk(CITY_GREENS), "#0a2010", r() * .3)); if (r() < .28) vCirc(vxx + .4, vy - .3, .65, pk(["#d6477f", "#e868a0", "#b8326a"])); }
  }
  for (let k = 0; k <= b.n; k++) {                                           // frisos entre os andares
    const ly = B - GF - k * FH; vRR(x, ly - .9, w, 1.8, .7, vLG(0, ly - 1, 0, ly + 1, [[0, wc[2]], [1, vDark(wc[1], .1)]])); vSoft(x, ly + .9, w, 2.6, .2);
  }
  vRR(x - 1.2, top - .8, w + 2.4, 2.4, .9, vLG(0, top - .8, 0, top + 1.6, [[0, vLight(wc[2], .2)], [1, wc[1]]])); vSoft(x, top + 1.6, w, 5, .3);

  // janelas dos andares de cima
  const nc = Math.max(1, w / 24 | 0), gx = (w - nc * 18) / (nc + 1), wxAt = i => x + gx * (i + 1) + 18 * i + 4;
  for (let k = 0; k < b.n; k++) {
    const ty = B - GF - (k + 1) * FH;
    for (let i = 0; i < nc; i++) {
      const wx = wxAt(i), ww = 10;
      let st = pk([0, 0, 1, 1, 2, 3]); if (st === 3 && !(k === 0 || (k === 1 && r() < .4))) st = 0;
      if (st === 3) {                                                        // porta de sacada com grade de ferro
        const by = ty + 4, bh = 18;
        vShutter(wx - 4.2, by, 3.6, bh, shc); vShutter(wx + ww + .6, by, 3.6, bh, shc);
        vRR(wx - 1.3, by - 1.3, ww + 2.6, bh + 1.3, 1.1, wc[2]); vGlass(wx, by, ww, bh, false, true);
        vRR(wx - 3.6, ty + 22, ww + 7.2, 2.3, 1, vLG(0, ty + 22, 0, ty + 24.3, [[0, "#f0e7d0"], [1, "#b8ab90"]])); vSoft(wx - 3, ty + 24.4, ww + 6, 4, .3);
        [wx - 2, wx + ww].forEach(cx => vCirc(cx + 1, ty + 26, 1, wc[1]));
        ctx.strokeStyle = "#2a2d35"; ctx.lineCap = "round"; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(wx - 3, ty + 15.8); ctx.lineTo(wx + ww + 3, ty + 15.8); ctx.stroke();
        ctx.lineWidth = .4; for (let q = wx - 3; q <= wx + ww + 3; q += 1.9) { ctx.beginPath(); ctx.moveTo(q, ty + 16.2); ctx.lineTo(q, ty + 22); ctx.stroke(); }
        ctx.lineWidth = .45; for (let q = wx - 2; q < wx + ww + 2; q += 3.8) { ctx.beginPath(); ctx.arc(q + 1, ty + 19.2, 1, 0, 6.3); ctx.stroke(); }
        if (r() < .6) vBush(wx + 8, ty + 17, 2.4, pk, r);
        D.wins.push({ x: wx, y: by, w: ww, h: bh, lit: r() < .5 });
        continue;
      }
      const wy = ty + 8, wh = 14;
      if (st === 2) {                                                        // persiana fechada
        vShutter(wx - 1, wy, ww + 2, wh, shc); vRR(wx - 1, wy + 2, ww + 2, .7, .3, "rgba(30,30,40,.7)"); ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(wx + ww / 2 - .2, wy, .4, wh);
        vRR(wx - 2, wy + wh + .6, ww + 4, 1.6, .8, "#e2d8c0"); vSoft(wx - 1.5, wy + wh + 2.2, ww + 3, 3.4, .3);
      } else {
        vShutter(wx - 4.2, wy, 3.6, wh, shc); vShutter(wx + ww + .6, wy, 3.6, wh, shc);
        vWin(wx, wy, ww, wh, { arch: st === 1, frame: wc[2] });
        D.wins.push({ x: wx, y: wy, w: ww, h: wh, lit: r() < .5, arch: st === 1 });
      }
      if (r() < .38) vFlowerBox(wx - 1, wy + wh - 3, ww + 2, r, pk);
    }
  }
  // térreo
  vRR(x, B - 4.5, w, 4.5, 1, vLG(0, B - 4.5, 0, B, [[0, "#b0a28e"], [1, "#82766a"]]));
  const doorAt = (dx, withLamp, kind) => {
    const dcol = pk(CITY_DOOR); vDoor(dx, dcol, B);
    D.wins.push({ x: dx + 3.8, y: B - 40, w: 6.4, h: 8.4, lit: r() < .6, arch: true });
    D.doors.push({ cx: dx + 7, x: dx, y: B - 44, w: 14, h: 42, arch: true, col: dcol, kind: kind || "house", locked: r() < .5, o: 0, t: 0 });
    if (withLamp) vLantern(dx + 19, B - 38, D);
  };
  const awning = (ax, aw, col, y0, hh) => {                                  // toldo listrado com a barra recortada em ondas
    const sw = 4;
    for (let i = 0; i < aw; i += sw) {
      const c = (i / sw | 0) % 2 ? "#f4ead2" : col, x0 = ax + i, x1 = Math.min(ax + aw, x0 + sw);
      ctx.beginPath(); ctx.moveTo(x0 + .6, y0); ctx.lineTo(x1 - .6, y0); ctx.lineTo(x1, y0 + hh); ctx.quadraticCurveTo((x0 + x1) / 2, y0 + hh + 2.4, x0, y0 + hh); ctx.closePath();
      ctx.fillStyle = vLG(0, y0, 0, y0 + hh + 2, [[0, vLight(c, .12)], [1, vDark(c, .16)]]); ctx.fill();
    }
    vRR(ax - .5, y0 - 1.2, aw + 1, 1.8, .8, "#3a2a22"); vSoft(ax, y0 + hh + 2.4, aw, 6, .34);
  };
  if (b.g === "door" || b.g === "sign" || b.g === "shrine") {
    const dx = b.g === "door" ? x + ri(10, Math.max(10, w - 30)) : x + 8; doorAt(dx, true);
    if (b.g === "door") { if (dx - x > 18 && r() < .8) vPot(dx - 9, false, B, r, pk); if (x + w - dx > 40 && r() < .8) vPot(dx + 24, false, B, r, pk); }
    if (b.g === "sign") {                                                    // placa azul do caminho do cais (a saída da cidade)
      const sx = CITY.MAX - 40;
      vRR(sx - 1.4, B - 55, 49, 17, 2.6, "#eef2e6"); vRR(sx, B - 53.6, 46.2, 14.2, 1.8, vLG(0, B - 54, 0, B - 39, [[0, "#2d6cb0"], [1, "#1a4a85"]]));
      vSoft(sx - 1, B - 38, 48, 4, .28);
      vText("CAIS  ›", sx + 23, B - 43, "#ffffff", 8.4, 40, "rgba(0,0,30,.4)");
    }
    if (b.g === "shrine") {                                                  // nichozinho com a santa e uma velinha
      const sx = x + w - 20;
      vArch(sx - 1.4, B - 55, 12, 20.4, "#e2d8bc"); vArch(sx, B - 53.6, 9.2, 18, vLG(0, B - 54, 0, B - 36, [[0, "#2a1a1c"], [1, "#4a3430"]]));
      ctx.beginPath(); ctx.moveTo(sx + 4.6, B - 49); ctx.bezierCurveTo(sx + 8, B - 46, sx + 8.2, B - 41, sx + 7.4, B - 37.4); ctx.lineTo(sx + 1.8, B - 37.4); ctx.bezierCurveTo(sx + 1, B - 41, sx + 1.2, B - 46, sx + 4.6, B - 49); ctx.fillStyle = vLG(sx, 0, sx + 9, 0, [[0, "#3d72b8"], [1, "#264a82"]]); ctx.fill();
      vCirc(sx + 4.6, B - 50.6, 1.8, "#e8c9a0"); vRR(sx + 3.2, B - 46, 2.8, 5, 1.2, "#eef2f8");
      vRR(sx - 2, B - 36.2, 13.2, 2.2, 1, "#dccfae"); vSoft(sx - 1.5, B - 34, 12, 3, .3);
      vRR(sx + .8, B - 40.2, 1.3, 3.6, .5, "#f6ecd2"); vRR(sx + 7, B - 40.2, 1.3, 3.6, .5, "#f6ecd2");
      D.doors.push({ cx: sx + 4.6, kind: "shrine", glow: 0, o: 0, t: 0 });
      D.lamps.push({ x: sx + 4.6, y: B - 40, r: 15 });
    }
  } else if (b.g === "shop") {
    const sx0 = x + 6, sw = w - 12, awn = pk(["#c0392b", "#2f6b4f", "#2d5a8a", "#d98e04"]), nm = b.name;
    vRR(x + 7.5, B - 55, w - 15, 14.4, 2, vLG(0, B - 55, 0, B - 40, [[0, "#6a4630"], [1, "#3a2414"]]));
    vRR(x + 8.8, B - 53.7, w - 17.6, 11.8, 1.4, vLG(0, B - 54, 0, B - 42, [[0, "#4a2f1c"], [1, "#2e1c10"]]));
    vText(nm, x + w / 2, B - 45, "#f4dca0", 6.4, w - 24, "rgba(0,0,0,.5)");
    const ww2 = sw - 16;
    vRR(sx0 - 1, B - 32, ww2 + 2, 28.6, 1.6, "#4a3020");
    vRR(sx0, B - 31, ww2, 26.6, 1, vLG(0, B - 31, 0, B - 4, [[0, "#f0c880"], [1, "#b8803c"]]));
    ctx.save(); vRR(sx0, B - 31, ww2, 26.6, 1); ctx.clip();
    [B - 22, B - 13].forEach(yy => { vRR(sx0, yy, ww2, 1.4, .5, "#7a5230"); vSoft(sx0, yy + 1.4, ww2, 2, .25); });
    for (let q = sx0 + 2.6; q < sx0 + ww2 - 5; q += 5.2) {
      vRR(q, B - 26.6, 3.4, 4.6, 1.2, pk(["#c0392b", "#f2c94c", "#2f6b4f", "#e8e0c8", "#2d5a8a"]));
      vRR(q, B - 17.6, 3.4, 4.6, 1.2, pk(["#d9b26a", "#c0392b", "#e8e0c8", "#8a4a2a"]));
    }
    ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.beginPath(); ctx.moveTo(sx0 + 3, B - 5); ctx.lineTo(sx0 + 14, B - 31); ctx.lineTo(sx0 + 24, B - 31); ctx.lineTo(sx0 + 13, B - 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    D.wins.push({ x: sx0, y: B - 31, w: ww2, h: 26.6, lit: true, soft: true });
    awning(sx0 - 2, sw + 4, awn, B - 41, 7);
    const dx = sx0 + ww2 + 2;
    vRR(dx - 1, B - 35, 14, 32, 1.6, "#4a3020"); vRR(dx, B - 34, 12, 30.4, 1, vLG(dx, 0, dx + 12, 0, [[0, "#6a4630"], [1, "#3e281a"]]));
    vGlass(dx + 1.8, B - 32, 8.4, 13, false, true); vCirc(dx + 9.6, B - 15.6, .9, "#e6bc6a");
    vRR(dx - 2, B - 3.2, 16, 2.6, 1, "#c6b9a0");
    D.wins.push({ x: dx + 1.8, y: B - 32, w: 8.4, h: 13, lit: true });
    D.doors.push({ cx: dx + 6, x: dx, y: B - 34, w: 12, h: 30, arch: false, col: "#4a3020", kind: "shop", name: nm, o: 0, t: 0 });
    vLantern(x + w - 6, B - 32, D);
    if (r() < .7) vPot(x + 1, false, B, r, pk);
    if (bi % 2 === 0) for (const cx of [x + w - 30, x + w - 16]) {            // caixotes de limão
      vEll(cx + 6, B + 5, 8, 1.3, "rgba(20,8,26,.3)");
      vRR(cx, B - 2, 12.4, 7.4, 1, vLG(0, B - 2, 0, B + 5.4, [[0, "#c28a4a"], [1, "#8a5a2c"]])); ctx.fillStyle = "rgba(60,30,12,.45)"; ctx.fillRect(cx + .5, B + 1.2, 11.4, .5); ctx.fillRect(cx + .5, B + 3.6, 11.4, .5);
      for (let j = 0; j < 5; j++) { vCirc(cx + 1.6 + j * 2.3, B - 2.6 + (j % 2) * .8, 1.3, vRG(cx + 1.4 + j * 2.3, B - 3 + (j % 2) * .8, 0, 1.4, [[0, "#fff09a"], [1, "#e8c020"]])); }
    }
  } else if (b.g === "cafe") {
    const cx0 = x + w / 2;
    vRR(cx0 - 24, B - 55, 48, 13.6, 2, vLG(0, B - 55, 0, B - 41, [[0, "#3a5a48"], [1, "#223a2e"]])); vRR(cx0 - 22.6, B - 53.6, 45.2, 10.8, 1.4, "#f6edd4");
    vText("CAFFÈ", cx0, B - 45, "#a32a1c", 8.6, 38, "rgba(80,20,10,.25)");
    vRR(x + 9, B - 29, 22, 25.6, 1.6, "#4a3020"); vRR(x + 10, B - 28, 20, 23.6, 1, vLG(0, B - 28, 0, B - 4, [[0, "#f6d68a"], [1, "#c88a44"]]));
    ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.beginPath(); ctx.moveTo(x + 12, B - 5); ctx.lineTo(x + 20, B - 28); ctx.lineTo(x + 27, B - 28); ctx.lineTo(x + 19, B - 5); ctx.closePath(); ctx.fill();
    D.wins.push({ x: x + 10, y: B - 28, w: 20, h: 23.6, lit: true, soft: true });
    awning(x + 3, w - 6, "#b8321f", B - 41, 8);
    doorAt(x + w - 26, false, "cafe");
    vRR(x + 33.4, B - 25, 13.2, 15.4, 1.4, "#5a3a22"); vRR(x + 34.4, B - 24, 11.2, 13.4, .9, "#26352e");
    ctx.strokeStyle = "rgba(240,236,220,.75)"; ctx.lineWidth = .4; ctx.lineCap = "round"; [[-20.5, 8], [-18, 6.4], [-15.6, 8.4], [-13.4, 5]].forEach(([yy, ln]) => { ctx.beginPath(); ctx.moveTo(x + 36, B + yy); ctx.bezierCurveTo(x + 37.5, B + yy - .8, x + 38.5, B + yy + .8, x + 36 + ln, B + yy); ctx.stroke(); });
    for (const tx of [x + 6, x + w - 34]) {                                  // mesinhas e cadeiras vermelhas
      vEll(tx + 5.5, B + 6.4, 10, 1.4, "rgba(20,8,26,.3)");
      vLine(tx + 5.5, B - 1, tx + 5.5, B + 5.2, .8, "#3a3a42"); vLine(tx + 3, B + 5.6, tx + 8, B + 5.6, .8, "#3a3a42");
      vEll(tx + 5.5, B - 2.2, 6.4, 1.8, vLG(0, B - 4, 0, B, [[0, "#f0e6c8"], [1, "#b8ac8e"]]));
      for (const cxx of [tx - 6, tx + 14]) {
        const sgn = cxx < tx ? -1 : 1;
        vLine(cxx + 1, B + 2.6, cxx + .6, B + 5.8, .6, "#3a3a42"); vLine(cxx + 4.4, B + 2.6, cxx + 4.8, B + 5.8, .6, "#3a3a42");
        vRR(cxx - .4, B + 1.2, 6, 1.8, .8, "#b53a2c");
        ctx.strokeStyle = "#b53a2c"; ctx.lineWidth = .9; ctx.beginPath(); ctx.moveTo(cxx + (sgn < 0 ? .4 : 4.8), B + 1.2); ctx.bezierCurveTo(cxx + (sgn < 0 ? -.8 : 6), B - 2, cxx + (sgn < 0 ? -.8 : 6), B - 4, cxx + (sgn < 0 ? .6 : 4.6), B - 5.6); ctx.stroke();
      }
    }
  } else if (b.g === "arch") {                                               // sottoportico: túnel por baixo do prédio
    const tw = 28, th = 46, tx = x + (w - tw) / 2;
    vArch(tx - 2.4, B - th - 2.4, tw + 4.8, th + 2.4, vLG(tx, 0, tx + tw, 0, [[0, "#e6dcc2"], [1, "#b8aa90"]]));
    vArch(tx, B - th, tw, th, vLG(0, B - th, 0, B, [[0, "#1c1218"], [1, "#2e2026"]]));
    ctx.save(); vArchP(tx, B - th, tw, th); ctx.clip();
    ctx.fillStyle = vRG(tx + tw / 2, B - 18, 0, 20, [[0, "rgba(255,226,160,.95)"], [.5, "rgba(236,170,100,.5)"], [1, "rgba(120,70,60,0)"]]); ctx.fillRect(tx, B - th, tw, th);
    vArch(tx + 6, B - th + 8, tw - 12, th - 10, "rgba(70,50,50,.5)");
    ctx.restore();
    vRR(tx, B - 3.2, tw, 3.2, 1, vLG(0, B - 3.2, 0, B, [[0, "#c2b49c"], [1, "#82766a"]])); vRR(tx + tw / 2 - 2.4, B - th - 3.4, 4.8, 4.6, 1.4, "#f0e6cc");
    vLantern(tx - 8, B - 36, D); vLantern(tx + tw + 5, B - 36, D);
    D.lamps.push({ x: tx + tw / 2, y: B - 22, r: 18 });
    if (bi % 2 === 0) {                                                      // vespa estacionada
      const vx = x + 4, vy = B + 4, vc = pk([["#8fd0c0", "#cdf2e8", "#5a9888"], ["#e8a0a8", "#fbd0d4", "#b86a74"], ["#f2d070", "#fff0b8", "#c09a3c"]]);
      vEll(vx + 14, vy + 1.2, 16, 2, "rgba(20,8,26,.34)");
      [[vx + 6, vy - 3.6], [vx + 23, vy - 3.6]].forEach(([wx, wy]) => { vCirc(wx, wy, 4.2, "#1c1c22"); vCirc(wx, wy, 2.4, "#8a8a92"); vCirc(wx, wy, .9, "#d0d0d6"); });
      ctx.beginPath(); ctx.moveTo(vx + 1, vy - 8); ctx.bezierCurveTo(vx + 1, vy - 15, vx + 9, vy - 15.4, vx + 12, vy - 12); ctx.lineTo(vx + 19.4, vy - 11); ctx.bezierCurveTo(vx + 21, vy - 13, vx + 21, vy - 14, vx + 20.4, vy - 17); ctx.lineTo(vx + 22.8, vy - 17.2); ctx.lineTo(vx + 24, vy - 8); ctx.bezierCurveTo(vx + 20, vy - 5.6, vx + 9, vy - 5.6, vx + 1, vy - 8); ctx.closePath();
      ctx.fillStyle = vLG(0, vy - 17, 0, vy - 5, [[0, vc[1]], [.35, vc[0]], [1, vc[2]]]); ctx.fill();
      vRR(vx + 2, vy - 16.6, 10.4, 3, 1.4, "#4a3022"); vLine(vx + 19, vy - 19.6, vx + 23.6, vy - 19.6, .8, "#2a2d35"); vLine(vx + 21.4, vy - 19.6, vx + 21.4, vy - 17.4, .8, "#2a2d35");
      vCirc(vx + 24, vy - 16.2, 1.4, "#fff0b0");
    }
  }
  // luz no alto, penumbra embaixo
  vSoft(x, B - 30, w, 30, .0);
  // telhado
  if (bi % 3 !== 2) {
    const hh = 12, ins = Math.min(12, w * .22);
    vRoofTiles(x - 3, x + w + 3, top - 2.5, hh, ins, bi);
    vSoft(x, top - .2, w, 6, .0);
    if (bi % 2 === 0) { const cx = x + ri(6, Math.max(6, w - 16)); vRR(cx, top - 26, 6.4, 18, .7, vLG(cx, 0, cx + 6.4, 0, [[0, "#b06a50"], [1, "#6a3c2c"]])); vRR(cx - 1.2, top - 27.8, 8.8, 2.4, .9, "#4e2a20"); ctx.fillStyle = "rgba(60,20,12,.25)"; for (let yy = top - 24; yy < top - 9; yy += 3) ctx.fillRect(cx, yy, 6.4, .4); }
    else { const ax = x + ri(10, Math.max(10, w - 14)); ctx.strokeStyle = "#3a3d46"; ctx.lineWidth = .5; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(ax, top - 24); ctx.lineTo(ax, top - 12); [[-4, 0], [-3, 3], [-4, 6]].forEach(([dx, dy]) => { ctx.moveTo(ax + dx, top - 24 + dy); ctx.lineTo(ax - dx, top - 24 + dy); }); ctx.stroke(); }
  } else {                                                                   // terraço com altana de madeira
    vRR(x, top - 6.4, w, 6.4, 1, vLG(0, top - 6.4, 0, top, [[0, vLight(wc[0], .1)], [1, wc[1]]])); vRR(x - 1.2, top - 8, w + 2.4, 2, .9, vLG(0, top - 8, 0, top - 6, [[0, wc[2]], [1, wc[1]]]));
    const ax = x + ri(6, Math.max(6, w - 30));
    vRR(ax, top - 23, 20, 15, .8, vLG(0, top - 23, 0, top - 8, [[0, "#a47c54"], [1, "#6e4e32"]]));
    vPoly([[ax - 2.6, top - 22.4], [ax + 22.6, top - 22.4], [ax + 17, top - 27.5], [ax + 3, top - 27.5]], vLG(0, top - 27.5, 0, top - 22.4, [[0, "#d98558"], [1, "#a94a2c"]]));
    vArch(ax + 3, top - 19, 5.4, 11, "#2a1c18"); vArch(ax + 11.6, top - 19, 5.4, 11, "#2a1c18"); vLine(ax + .4, top - 22, ax + .4, top - 8, .9, "#5a3e28"); vLine(ax + 19.6, top - 22, ax + 19.6, top - 8, .9, "#5a3e28");
    for (let q = 0; q < 3; q++) { const ppx = x + ri(2, Math.max(2, w - 7)); if (ppx > ax - 5 && ppx < ax + 22) continue; vBush(ppx + 2.2, top - 11.5, 2.5, pk, r); vRR(ppx, top - 9, 4.6, 3, .8, "#b4532f"); }
  }
  // varal na fachada (só nos prédios de porta simples)
  if (b.g === "door" && bi % 2 === 1 && nc >= 2) {
    const ty = B - GF - FH, x1 = x + 3, x2 = x + w - 7, y1 = ty + 27, y2 = ty + 28;
    vCirc(x1, y1, .9, "#2a2d35"); vCirc(x2, y2, .9, "#2a2d35");
    const items = []; for (let cx = x1 + 6; cx < x2 - 8; cx += 10) items.push({ x: cx, kind: ri(0, 3), col: pk(["#f1ecdc", "#c0392b", "#2d5a8a", "#f2c94c", "#e8e0c8", "#2f6b4f"]), ph: r() * 6 });
    D.lines.push({ x1, y1, x2, y2, sag: 2, items });
  }
}

// ---- grão fino de pintura por cima do cenário (dá textura de papel/reboco, sem quadradinhos)
function cityGrain(c2, FW, CWD, cs, seed) {
  let sd = seed || 91; const rr = () => (sd = sd * 16807 % 2147483647) / 2147483647;
  const nz = document.createElement("canvas"); nz.width = nz.height = 256; const nx = nz.getContext("2d"), im = nx.createImageData(256, 256);
  for (let i = 0; i < im.data.length; i += 4) { const v = rr() < .5 ? 0 : 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = rr() < .4 ? 3 + rr() * 11 : 0; }
  nx.putImageData(im, 0, 0);
  c2.save(); c2.setTransform(1, 0, 0, 1, 0, 0); c2.globalCompositeOperation = "source-atop";
  const pat = c2.createPattern(nz, "repeat"); c2.fillStyle = pat; c2.fillRect(0, 0, c2.canvas.width, c2.canvas.height);
  c2.restore();
}

function cityBuild() {                                                     // pinta tudo que não se mexe, uma vez só
  const D = cityData, B = CITY_B, FW = CITY_FW, CWD = CITY_FX1 - CITY_FW, GF = CITY_GF, FH = CITY_FH, cs = CITY_HD ? CITY_CS : S * CITY_Z;
  let sd = 777; const r = () => (sd = sd * 16807 % 2147483647) / 2147483647, ri = (a, b) => a + (r() * (b - a + 1) | 0), pk = a => a[r() * a.length | 0];
  D.wins = []; D.lamps = []; D.bulbs = []; D.lines = []; D.doors = [];
  const cv2 = document.createElement("canvas"); cv2.width = Math.ceil(CWD * cs); cv2.height = Math.ceil(CITY_CH * cs);
  const c2 = cv2.getContext("2d"); c2.setTransform(cs, 0, 0, cs, -FW * cs, 0);
  const main = ctx; ctx = c2;
  try {
    ctx.imageSmoothingEnabled = true;
    vGround(D, B, FW, CWD, r, ri, pk);
    vPiazza(D, B, r, pk);
    D.gaps.forEach(gp => vGap(D, gp, B, r, pk));
    D.blds.forEach((b, bi) => { if (b.g === "church") vChurch(D, b, B, r, ri, pk); else vBuilding(D, b, bi, B, r, ri, pk); });
    // varais atravessando as vielas e festões de luzes
    D.gaps.forEach((gp, gi) => {
      const x1 = gp.x - 6, x2 = gp.x + gp.w + 6, y1 = B - GF - FH + 8, y2 = y1 + 1;
      if (gi % 3 === 1) return;
      vCirc(x1, y1, .9, "#2a2d35"); vCirc(x2, y2, .9, "#2a2d35");
      const items = []; for (let cx = x1 + 7; cx < x2 - 6; cx += 9) items.push({ x: cx, kind: ri(0, 3), col: pk(["#f1ecdc", "#c0392b", "#2d5a8a", "#f2c94c", "#e8e0c8", "#2f6b4f"]), ph: r() * 6 });
      D.lines.push({ x1, y1, x2, y2, sag: 3, items });
    });
    for (let x1 = -110, fi = 0; x1 < CITY_FX1 - 120; fi++) {
      const x2 = x1 + 150 + ri(0, 30), y1 = B - 86 - ri(0, 8), y2 = B - 86 - ri(0, 8), sag = ri(8, 11), kind = fi % 2 ? "flag" : "bulb";
      vWire(x1, y1, x2, y2, sag, .55, "rgba(34,36,44,.9)"); vCirc(x1, y1 - .3, 1, "#2a2d35"); vCirc(x2, y2 - .3, 1, "#2a2d35");
      for (let x = x1 + 8, q = 0; x < x2 - 4; x += kind === "bulb" ? 11 : 8, q++) {
        const y = cityWireY(x1, y1, x2, y2, sag, x);
        if (kind === "bulb") { vLine(x, y, x, y + 1.6, .4, "#2a2d35"); vCirc(x, y + 3, 1.7, vRG(x - .4, y + 2.5, 0, 1.9, [[0, "#fffbe6"], [1, "#e8d49a"]])); D.bulbs.push({ x, y: y + 3 }); }
        else { const col = ["#c0392b", "#f2e6c9", "#2f6b4f"][q % 3]; vPoly([[x - 2.8, y], [x + 2.8, y + .3], [x, y + 5.6]], vLG(0, y, 0, y + 5.6, [[0, vLight(col, .1)], [1, vDark(col, .15)]])); }
      }
      x1 = x2 + ri(8, 30);
    }
    ctx.fillStyle = vLG(0, B + 30, 0, CITY_CH, [[0, "rgba(20,10,30,0)"], [1, "rgba(20,10,30,.42)"]]); ctx.fillRect(FW, B + 30, CWD, CITY_CH - B - 30);   // a beirada de baixo escurece, o pescador fica em destaque
    cityGrain(c2, FW, CWD, cs, sd);
  } finally { ctx = main; }
  cityCache = { cv: cv2, s: CITY_HD ? 0 : S, cs, font: true };
  cityFarBake(); cityLightBuild(); cityFrontBake();
}

function cityEnsure() {
  if (!cityData) cityInit();
  if (!cityCache || cityCache.s !== (CITY_HD ? 0 : S) || (!cityCache.font && cityFontOK())) cityBuild();
}

const cityFarWinLit = (b, wx, wy) => ((((b.x * 73856093) ^ (wx * 19349663) ^ (wy * 83492791)) >>> 0) % 5) === 0;
const cityHillH = x => 46 + 16 * Math.sin(x * .011 + 1) + 11 * Math.sin(x * .027 + 2) + 5 * Math.sin(x * .071);
const CITY_FCS = 1.5;                                                    // pixels por unidade das camadas do fundo (baixo de propósito: já nasce suave/desfocado)

// Pinta UMA vez cada camada do fundo (colinas, prédios longe, prédios do meio) em canvas próprios; por quadro só se desenha a fatia visível, deslocada pelo parallax
function cityFarBake() {
  const D = cityData, B = CITY_B, FW = CITY_FW, CWD = CITY_FX1 - CITY_FW, fog = [190, 198, 216], mx = (c, f = .5) => "rgb(" + c.map((v, i) => Math.round(v + (fog[i] - v) * f)) + ")";
  const mk = () => { const cv = document.createElement("canvas"); cv.width = Math.ceil(CWD * CITY_FCS); cv.height = Math.ceil((B + 4) * CITY_FCS); const c = cv.getContext("2d"); c.setTransform(CITY_FCS, 0, 0, CITY_FCS, -FW * CITY_FCS, 0); return { cv, c }; };
  const main = ctx, L = [mk(), mk(), mk()]; D.farLit = [[], [], []];
  const wins = (arr, x0, y0, y1, sx, sy, fn) => arr.forEach(b => { const top = B - b.h; for (let wy = top + y0; wy < B - y1; wy += sy) for (let wx = b.x + x0; wx < b.x + b.w - x0 - 1; wx += sx) fn(b, wx, wy); });
  try {
    ctx = L[0].c; const a = FW, b = CITY_FX1;                            // 0) colinas
    const hill = (fn, col) => { ctx.beginPath(); ctx.moveTo(a, B); for (let x = a; x <= b; x += 4) ctx.lineTo(x, B - fn(x)); ctx.lineTo(b, B); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
    hill(x => cityHillH(x * .8 + 400) - 14, vLG(0, B - 70, 0, B, [[0, mx([96, 112, 120], .86)], [1, mx([96, 112, 120], .93)]]));
    hill(x => cityHillH(x), vLG(0, B - 80, 0, B, [[0, mx([118, 104, 142], .8)], [1, mx([118, 104, 142], .9)]]));

    ctx = L[1].c;                                                        // 1) prédios bem longe + campanários
    const FC = CITY_FARC.map(c => mx(c, .72)), RC = mx([150, 78, 58], .72), RL = mx([176, 98, 70], .72), WD = CITY_FARC.map(c => mx(c.map(v => v * .62), .55));
    D.far2.forEach(bd => {
      const top = B - bd.h;
      vRR(bd.x, top, bd.w, bd.h + 2, 1.4, vLG(0, top, 0, B, [[0, FC[bd.c]], [1, vDark(FC[bd.c], .12)]])); vRR(bd.x + bd.w - 5, top, 5, bd.h, 1, "rgba(30,20,50,.14)");
      vPoly([[bd.x - 1.5, top + .5], [bd.x + bd.w + 1.5, top + .5], [bd.x + bd.w - 4, top - 7], [bd.x + 4, top - 7]], vLG(0, top - 7, 0, top, [[0, RL], [1, RC]]));
    });
    const tc = mx([232, 206, 160], .72), td = mx([150, 120, 100], .7), tb = mx([205, 190, 150], .72);
    D.towers.forEach(tx => {
      const tt = B - 128;
      vRR(tx, tt + 12, 15, 130, 1, vLG(tx, 0, tx + 15, 0, [[0, vLight(tc, .1)], [1, vDark(tc, .12)]]));
      vRR(tx - 1.2, tt + 10, 17.4, 3.2, 1, tb); vRR(tx - 1.2, tt + 28, 17.4, 2.4, 1, tb);
      vArch(tx + 3, tt + 14, 4, 12, td); vArch(tx + 8.4, tt + 14, 4, 12, td);
      vPoly([[tx - 1, tt + 12], [tx + 16, tt + 12], [tx + 7.5, tt - 2]], vLG(0, tt - 2, 0, tt + 12, [[0, RL], [1, RC]]));
      vLine(tx + 7.5, tt - 2, tx + 7.5, tt - 7, .7, RC); vLine(tx + 5.8, tt - 5, tx + 9.2, tt - 5, .7, RC);
    });
    wins(D.far2, 4, 10, 30, 8, 12, (bd, wx, wy) => { vRR(wx, wy, 2.4, 4.2, 1, WD[bd.c]); if (cityFarWinLit(bd, wx, wy)) D.farLit[1].push({ x: wx + 1, y: wy + 2 }); });

    ctx = L[2].c;                                                        // 2) prédios do meio (os que aparecem pelas vielas)
    const FC3 = CITY_FARC.map(c => mx(c)), RC3 = mx([150, 78, 58]), RL3 = mx([176, 98, 70]), WD3 = CITY_FARC.map(c => mx(c.map(v => v * .62), .4));
    D.far.forEach(bd => {
      const top = B - bd.h;
      vRR(bd.x, top, bd.w, bd.h + 2, 1.2, vLG(0, top, 0, B, [[0, vLight(FC3[bd.c], .06)], [1, vDark(FC3[bd.c], .14)]])); vRR(bd.x + bd.w - 4, top, 4, bd.h, 1, "rgba(30,20,50,.13)");
      vPoly([[bd.x - 1.5, top + .5], [bd.x + bd.w + 1.5, top + .5], [bd.x + bd.w - 4, top - 8], [bd.x + 4, top - 8]], vLG(0, top - 8, 0, top, [[0, RL3], [1, RC3]]));
    });
    wins(D.far, 4, 8, 70, 9, 16, (bd, wx, wy) => { vRR(wx - .6, wy - .6, 4.2, 6.2, 1, "rgba(235,225,200,.5)"); vRR(wx, wy, 3, 5, .8, WD3[bd.c]); if (cityFarWinLit(bd, wx, wy)) D.farLit[2].push({ x: wx + 1.5, y: wy + 2.5 }); });
  } finally { ctx = main; }
  D.farCv = L.map(o => o.cv);
}
function cityFar(fog, l, r) {                                            // por quadro: só copia a fatia visível de cada camada, com o deslocamento do parallax
  const D = cityData, cs = CITY_FCS;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "low";
  for (let i = 0; i < 3; i++) {
    const cv = D.farCv[i], f = CITY_FARF[i], sh = l * (1 - f), x0 = Math.max(CITY_FW, Math.floor(l - sh - 6)), x1 = Math.min(CITY_FX1, Math.ceil(r - sh + 6));
    if (x1 > x0) ctx.drawImage(cv, (x0 - CITY_FW) * cs, 0, (x1 - x0) * cs, cv.height, x0 + sh, 0, x1 - x0, cv.height / cs);
  }
}

// primeiro plano (postes e vasos fora de foco): sprites pintados uma vez
function cityFrontBake() {
  const D = cityData, main = ctx, base = PIER_Y + 40, FS = 1.5, s0 = [24, 34, 80], tint = (c, k = .3) => "rgb(" + c.map((v, i) => Math.round(v + (s0[i] - v) * k)).join(",") + ")";
  const iron = tint([34, 26, 42]), potC = tint([138, 66, 40]), G = [tint([54, 110, 56]), tint([40, 88, 46]), tint([66, 130, 66])];
  const mk = (x0, y0, w, h) => { const cv = document.createElement("canvas"); cv.width = Math.ceil(w * FS); cv.height = Math.ceil(h * FS); const c = cv.getContext("2d"); c.setTransform(FS, 0, 0, FS, -x0 * FS, -y0 * FS); return { cv, c, x0, y0, w, h }; };
  const P = mk(-9, 0, 32, base + 2), V = mk(-30, 110, 60, base - 108), Gl = mk(-56, -56, 112, 112);
  try {
    ctx = P.c; const X = 0;                                              // poste ornamentado (lanterna acesa vem do brilho à parte)
    vPoly([[X - 6, base], [X + 6, base], [X + 3, base - 14], [X - 3, base - 14]], iron);
    vRR(X - 1.8, 8, 3.6, base - 20, 1.6, iron); vRR(X - 4, base - 20, 8, 4, 1.8, iron);
    ctx.strokeStyle = iron; ctx.lineWidth = 1.7; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(X, 16); ctx.bezierCurveTo(X + 4, 5, X + 11, 4, X + 14, 11); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X - 5, 40, 5, 0, 3.6); ctx.stroke();
    vPoly([[X + 8, 11], [X + 20, 11], [X + 17, 6], [X + 11, 6]], iron);
    vRR(X + 9.4, 11, 9.2, 13, 3, "#ffd88c"); vRR(X + 8, 24, 12, 2.4, 1, iron); vCirc(X + 14, 4.2, 1.6, iron);
    ctx.strokeStyle = iron; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(X + 14, 11); ctx.lineTo(X + 14, 24); ctx.stroke();
    ctx = V.c; const gx = 0, gy = base - 36;                             // vaso grande com arbusto florido
    [[0, 0, 15], [-11, 5, 9], [12, 4, 10], [-3, -8, 10], [6, -7, 8]].forEach(([dx, dy, q], k) => vCirc(gx + dx, gy + dy, q, G[k % 3]));
    for (let q = 0; q < 8; q++) vCirc(gx - 13 + ((q * 37 + 11) % 26), gy - 14 + ((q * 19 + 7) % 20), 1.8, ["#e04a68", "#f4d050", "#ee78b0"][q % 3]);
    vPoly([[-14, base - 28], [14, base - 28], [10, base], [-10, base]], vLG(-14, 0, 14, 0, [[0, tint([176, 92, 58], .2)], [.6, potC], [1, tint([96, 44, 28])]]));
    vRR(-16, base - 32, 32, 6, 2.4, tint([196, 108, 68], .2));
    ctx = Gl.c; ctx.fillStyle = vRG(0, 0, 2, 55, [[0, "rgba(255,210,140,.3)"], [1, "rgba(255,200,120,0)"]]); ctx.fillRect(-56, -56, 112, 112);
  } finally { ctx = main; }
  D.front = { P, V, Gl };
}
function cityFront(now, l, r) {                                           // postes e vasos na frente do pescador, mais rápidos que o cenário
  const D = cityData; if (!D.front) return;
  const f = CITY_FRONT_F, s = l * (1 - f), GAP = CITY_FRONT_GAP, a = Math.floor((l - s - 40) / GAP), b = Math.ceil((r - s + 40) / GAP), { P, V, Gl } = D.front;
  ctx.save(); ctx.translate(s, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "low";
  for (let i = a; i <= b; i++) {
    const j = ((i * 2654435761) >>> 0) % 100, X = i * GAP + (j - 50);
    if (X + s < l - 40 || X + s > r + 40) continue;
    if (i % 2 === 0) {
      ctx.drawImage(P.cv, X + P.x0, P.y0, P.w, P.h);
      if (DAY.lamp > .01) { ctx.globalAlpha = DAY.lamp; ctx.globalCompositeOperation = "lighter"; ctx.drawImage(Gl.cv, X + 14 + Gl.x0, 17 + Gl.y0, Gl.w, Gl.h); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; }
    } else ctx.drawImage(V.cv, X + V.x0, V.y0, V.w, V.h);
  }
  ctx.restore();
}

function cityNearDoor() {                                                // a porta (ou nicho) ao alcance do pescador
  if (!cityData || !CITY.on) return null;
  let best = null, bd = 1e9;
  for (const d of cityData.doors) { const dd = Math.abs(px - d.cx); if (dd < (d.kind === "shrine" ? 11 : 13) && dd < bd) { best = d; bd = dd; } }
  return best;
}
const cityLabel = d => d.kind === "shrine" ? "acender vela" : d.locked === undefined && d.kind === "church" ? "entrar" : "abrir porta";
const CITY_LOCKED = ["Trancada.", "Ninguém atende...", "Parece que não tem ninguém em casa.", "Você bate e só ouve um cachorro latindo lá dentro."];
const CITY_HOUSE = ["Cheiro de molho de tomate vindo lá de dentro.", "Uma senhora acena da cozinha: \"Buongiorno!\"", "Lá dentro, um rádio antigo toca uma música lenta.", "Um menino espia pela fresta e some correndo."];
function cityUse() {                                                     // tecla E na cidade: bate/abre a porta mais próxima
  const d = cityNearDoor(); if (!d || TR.lock || state !== "walk") return false;
  if (d.t > 0.3) return true;
  const h = DAY.m / 60, pk = a => a[Math.random() * a.length | 0];
  let open = false, m;
  if (d.kind === "shrine") { d.glow = 5; say("Você acende uma velinha. Amém."); SND.play("catch_chime", { vol: .22, jitter: 0 }); return true; }
  if (d.kind === "house") { open = !d.locked; m = open ? pk(CITY_HOUSE) : pk(CITY_LOCKED); }
  else if (d.kind === "shop") { open = h >= 7 && h < 19; m = open ? "Bem-vindo à " + d.name + "!" : d.name + " está fechada agora."; }
  else if (d.kind === "cafe") { open = h >= 6 && h < 23; m = open ? "Um espresso, per favore!" : "O café já fechou."; }
  else { open = h >= 6 && h < 20; m = open ? "Silêncio... só o eco dos seus passos." : "A igreja está fechada."; }
  say(m);
  if (open) { d.t = 3; SND.play("pier_creak_2", { vol: .5, rate: .9 }); if (window.onCityDoor) try { window.onCityDoor(d); } catch (e) {} }
  else SND.play("pier_creak_1", { vol: .35, rate: 1.3 });
  return true;
}

// Luzes da noite: janelas acesas (cache normal) e brilhos/poças de luz (cache somado à cena) são pintados uma vez; por quadro só se desenham as fatias visíveis
function cityLightBuild() {
  const D = cityData, FW = CITY_FW, CWD = CITY_FX1 - CITY_FW, main = ctx;
  const mk = cs => { const cv = document.createElement("canvas"); cv.width = Math.ceil(CWD * cs); cv.height = Math.ceil(CITY_CH * cs); const c = cv.getContext("2d"); c.setTransform(cs, 0, 0, cs, -FW * cs, 0); return { cv, c, cs }; };
  const Wn = mk(CITY_CS), Gw = mk(2);
  const WTONE = ["#ffd98a", "#ffe6a8", "#ffc46e", "#f6e4bc", "#ffd07a"];
  try {
    ctx = Wn.c;
    D.wins.forEach(w => {
      if (!w.lit) return;
      const hs = (((w.x * 73856093) ^ (w.y * 19349663)) >>> 0), cx = w.x + w.w / 2, cy = w.y + w.h / 2, tone = WTONE[hs % WTONE.length];
      const shape = () => { if (w.round) { ctx.beginPath(); ctx.arc(cx, cy, w.w / 2, 0, 6.2832); } else if (w.arch) vArchP(w.x, w.y, w.w, w.h); else vRR(w.x, w.y, w.w, w.h, .7); };
      ctx.save(); shape(); ctx.clip();
      ctx.fillStyle = w.soft ? vLG(0, w.y, 0, w.y + w.h, [[0, "rgba(255,226,150,.62)"], [1, "rgba(255,190,100,.5)"]]) : vLG(0, w.y, 0, w.y + w.h, [[0, tone], [1, vMix(tone, "#e8923e", .55)]]);
      ctx.fillRect(w.x, w.y, w.w, w.h);
      if (!w.soft) {
        if (hs % 7 === 0 && w.h >= 12) { ctx.fillStyle = "rgba(60,30,24,.55)"; ctx.beginPath(); ctx.arc(cx + (hs % 3 - 1) * 1.2, w.y + w.h - 6.2, 1.5, 0, 6.2832); ctx.fill(); vRR(cx - 2.4 + (hs % 3 - 1) * 1.2, w.y + w.h - 4.6, 4.8, 5, 2, "rgba(60,30,24,.55)"); }
        else if (hs % 3 === 0) { ctx.fillStyle = "rgba(150,70,44,.34)"; ctx.beginPath(); ctx.moveTo(w.x, w.y); ctx.lineTo(w.x + w.w * .34, w.y); ctx.quadraticCurveTo(w.x + w.w * .2, w.y + w.h * .5, w.x + w.w * .3, w.y + w.h); ctx.lineTo(w.x, w.y + w.h); ctx.closePath(); ctx.fill(); }
        vSoft(w.x, w.y, w.w, Math.min(3.5, w.h * .3), .3, "130,60,26");
        if (w.w >= 6 && w.h >= 8) { ctx.fillStyle = "rgba(80,44,28,.55)"; ctx.fillRect(cx - .4, w.y, .8, w.h); ctx.fillRect(w.x, cy - .4, w.w, .8); }
      }
      ctx.restore();
    });
    ctx = Gw.c;
    D.wins.forEach(w => {                                                // respingo de luz das janelas na parede
      if (!w.lit) return;
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2, hr = Math.max(w.w, w.h) * .85 + 3;
      ctx.fillStyle = vRG(cx, cy, 0, hr, [[0, "rgba(255,190,110,.2)"], [1, "rgba(255,190,110,0)"]]); ctx.fillRect(cx - hr, cy - hr, hr * 2, hr * 2);
    });
    D.lamps.forEach(lp => {
      const R = lp.r * .8;
      ctx.fillStyle = vRG(lp.x, lp.y, 1, R, [[0, "rgba(255,196,120,.26)"], [.3, "rgba(255,170,90,.08)"], [1, "rgba(255,160,80,0)"]]); ctx.fillRect(lp.x - R, lp.y - R, R * 2, R * 2);
      const PR = lp.r * 1.2; ctx.save(); ctx.translate(lp.x, CITY_B + 10); ctx.scale(1, .26);              // poça de luz no chão (achatada)
      ctx.fillStyle = vRG(0, 0, 2, PR, [[0, "rgba(255,200,120,.34)"], [.5, "rgba(255,170,90,.12)"], [1, "rgba(255,160,80,0)"]]); ctx.fillRect(-PR, -PR, PR * 2, PR * 2); ctx.restore();
      vCirc(lp.x, lp.y, 1.1, "rgba(255,238,190,.85)");
    });
  } finally { ctx = main; }
  const spr = (w, f) => { const cv = document.createElement("canvas"); cv.width = cv.height = w; const c = cv.getContext("2d"); f(c, w); return cv; };
  D.lit = { Wn, Gw,
    bulb: spr(28, (c, w) => { const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, "rgba(255,220,140,.34)"); g.addColorStop(1, "rgba(255,200,110,0)"); c.fillStyle = g; c.fillRect(0, 0, w, w); }),
    far: spr(24, (c, w) => { const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, "rgba(255,200,120,1)"); g.addColorStop(1, "rgba(255,180,100,0)"); c.fillStyle = g; c.fillRect(0, 0, w, w); }) };
}
function cityLit(now, l, r) {                                            // à noite: janelas acesas, lanternas, luzinhas de festa (por cima da lavagem escura)
  if (DAY.lamp <= 0.01) return;
  const D = cityData, B = CITY_B, a = DAY.lamp, L = D.lit; if (!L) return;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "low";
  { // luzes dos prédios do fundo: só aparecem onde o fundo é visível (vielas, praça e acima dos telhados)
    ctx.save(); ctx.beginPath();
    D.blds.forEach(bd => { if (bd.x < r + 10 && bd.x + bd.w > l - 10) ctx.rect(bd.x - 2, -60, bd.w + 4, bd.top - 16 + 60); });
    D.gaps.forEach(gp => { if (gp.x < r + 10 && gp.x + gp.w > l - 10) ctx.rect(gp.x, -60, gp.w, B - 12 - gp.hh - 8 + 60); });
    ctx.rect(D.piazza.x, -60, D.piazza.w, B - 20 + 60);
    ctx.clip(); ctx.globalCompositeOperation = "lighter";
    [[1, .5, 9], [2, .62, 11]].forEach(([i, al, sz]) => {
      const sh = l * (1 - CITY_FARF[i]); ctx.globalAlpha = a * al;
      D.farLit[i].forEach(p => { const x = p.x + sh; if (x > l - 8 && x < r + 8) ctx.drawImage(L.far, x - sz / 2, p.y - sz / 2, sz, sz); });
    });
    ctx.restore();
  }
  const sl = (o, comp, al) => { const sx = Math.max(0, Math.floor((l - 4 - CITY_FW) * o.cs)), ex = Math.min(o.cv.width, Math.ceil((r + 4 - CITY_FW) * o.cs)); if (ex > sx) { ctx.globalCompositeOperation = comp; ctx.globalAlpha = al; ctx.drawImage(o.cv, sx, 0, ex - sx, o.cv.height, CITY_FW + sx / o.cs, 0, (ex - sx) / o.cs, o.cv.height / o.cs); } };
  sl(L.Wn, "source-over", a); sl(L.Gw, "lighter", a);
  ctx.globalCompositeOperation = "lighter";
  D.bulbs.forEach((bu, i) => { if (bu.x < l - 10 || bu.x > r + 10) return; ctx.globalAlpha = a * (.85 + .15 * Math.sin(now / 400 + i)); ctx.drawImage(L.bulb, bu.x - 7, bu.y - 7, 14, 14); });
  ctx.restore();
}

function drawCityBack(now, dt, l, r) {                                   // tudo que recebe a lavagem de cor da hora (l..r = trecho visível do mundo)
  cityEnsure();
  const D = cityData, B = CITY_B, t = now / 1000, cs = cityCache.cs;
  ctx.save();
  cityFar(DAY.sky[3], l, r);
  ctx.imageSmoothingEnabled = CITY_HD; ctx.imageSmoothingQuality = "low";
  const sx = Math.max(0, Math.floor((l - 4 - CITY_FW) * cs)), ex = Math.min(cityCache.cv.width, Math.ceil((r + 4 - CITY_FW) * cs));
  if (ex > sx) ctx.drawImage(cityCache.cv, sx, 0, ex - sx, cityCache.cv.height, CITY_FW + sx / cs, 0, (ex - sx) / cs, cityCache.cv.height / cs);
  { // fonte: jatinhos de água caindo
    const fx = D.fountain.x;
    if (fx > l - 40 && fx < r + 40) for (let i = 0; i < 16; i++) {
      const u = (t * .9 + i / 16) % 1, vx = (i - 7.5) * 2.1, x = fx + vx * u * 1.2, y = B - 42 + (-14 * u + 40 * u * u);
      ctx.fillStyle = "rgba(210,240,252," + (.9 - u * .3).toFixed(2) + ")"; ctx.beginPath(); ctx.arc(x, y, .8, 0, 6.2832); ctx.fill();
      if (u > .93) { ctx.strokeStyle = "rgba(235,250,255,.65)"; ctx.lineWidth = .4; ctx.beginPath(); ctx.ellipse(x, B - 5.4, 2.6, .75, 0, 0, 6.2832); ctx.stroke(); }
    }
  }
  D.lines.forEach(L => {                                                 // varais: fio e roupas balançando de leve
    if (L.x2 < l - 12 || L.x1 > r + 12) return;
    vWire(L.x1, L.y1, L.x2, L.y2, L.sag, .45, "rgba(58,52,64,.95)");
    L.items.forEach(it => {
      const yy = cityWireY(L.x1, L.y1, L.x2, L.y2, L.sag, it.x) + .6, sw = Math.sin(t * 1.6 + it.ph) * 1.1, g = it.col, x0 = it.x;
      if (it.kind === 0) { ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + 9, yy); ctx.lineTo(x0 + 9 + sw, yy + 11); ctx.quadraticCurveTo(x0 + 4.5 + sw * 1.5, yy + 12.8, x0 + sw * .6, yy + 11); ctx.closePath(); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.1)"; ctx.lineWidth = .4; ctx.beginPath(); ctx.moveTo(x0 + 4.5, yy + .5); ctx.quadraticCurveTo(x0 + 4.5 + sw * .8, yy + 6, x0 + 4.5 + sw, yy + 11.6); ctx.stroke(); }
      else if (it.kind === 1) vPoly([[x0 - 1.5, yy], [x0 + 1.5, yy], [x0 + 3.5, yy + 1.2], [x0 + 5.5, yy], [x0 + 8.5, yy], [x0 + 9, yy + 3], [x0 + 6.6 + sw * .5, yy + 3.6], [x0 + 6.4 + sw, yy + 8], [x0 + 1.6 + sw, yy + 8], [x0 + 1.4 + sw * .5, yy + 3.6], [x0 - 1.2, yy + 3]], g);
      else if (it.kind === 2) { vPoly([[x0 + 1, yy], [x0 + 7, yy], [x0 + 6.4 + sw * .5, yy + 3], [x0 + 6 + sw, yy + 10], [x0 + 4.2 + sw, yy + 10], [x0 + 4 + sw * .6, yy + 4], [x0 + 3.8 + sw, yy + 10], [x0 + 1.6 + sw, yy + 10], [x0 + 1.6 + sw * .5, yy + 3]], g); }
      else { vRR(x0 + 1 + sw * .3, yy, 6, 8, 1, g); ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.fillRect(x0 + 1 + sw * .3, yy + 3, 6, .9); ctx.fillRect(x0 + 1 + sw * .3, yy + 5, 6, .9); }
      vCirc(x0 + 1.5, yy - .2, .55, "#c0392b"); vCirc(x0 + 7, yy - .2, .55, "#c0392b");
    });
  });
  D.doors.forEach(d => {                                                 // portas abrindo (e velinha acesa no nicho)
    if (d.t > 0) d.t -= dt;
    if (d.kind === "shrine") {
      if (d.glow > 0) { d.glow -= dt; if (d.cx > l - 10 && d.cx < r + 10) { const fl = .8 + .25 * Math.sin(t * 20); [d.cx - 3.15, d.cx + 3.05].forEach(fx2 => { ctx.fillStyle = "#ffcf60"; ctx.beginPath(); ctx.ellipse(fx2, B - 41.4, .6, 1.3 * fl, 0, 0, 6.2832); ctx.fill(); }); ctx.fillStyle = vRG(d.cx, B - 41, 0, 7, [[0, "rgba(255,210,120,.45)"], [1, "rgba(255,210,120,0)"]]); ctx.fillRect(d.cx - 7, B - 48, 14, 14); } }
      return;
    }
    d.o += ((d.t > 0 ? 1 : 0) - d.o) * Math.min(1, dt * 7);
    if (d.o < .02 || d.cx < l - 20 || d.cx > r + 20) return;
    const shape = (x, y, w, h) => d.arch ? vArchP(x, y, w, h) : vRR(x, y, w, h, .8);
    ctx.save(); shape(d.x, d.y, d.w, d.h); ctx.clip();                   // interior iluminado
    ctx.fillStyle = vLG(0, d.y, 0, d.y + d.h, [[0, "#3a2214"], [.3, "#c48a48"], [1, "#f4c878"]]); ctx.fillRect(d.x, d.y, d.w, d.h);
    vRR(d.x + 2, d.y + d.h - 12, d.w - 4, 1.8, .6, "#5a3a24"); vLine(d.x + 3.4, d.y + d.h - 10, d.x + 3.4, d.y + d.h, .8, "#3a2418"); vLine(d.x + d.w - 3.4, d.y + d.h - 10, d.x + d.w - 3.4, d.y + d.h, .8, "#3a2418");
    const py = d.y + d.h - 24 - (Math.sin(t * 2) > .5 ? .8 : 0); vCirc(d.x + d.w / 2, py, 1.9, "#2a1810"); vRR(d.x + d.w / 2 - 2.4, py + 2, 4.8, 9, 2, "#2a1810");   // alguém passando
    ctx.restore();
    const lw = Math.max(2, d.w * (1 - d.o) * .9 + 2);
    ctx.save(); ctx.beginPath(); ctx.rect(d.x - 1, d.y - 2, lw + 1, d.h + 4); ctx.clip();                    // folha da porta
    shape(d.x, d.y, d.w, d.h); ctx.fillStyle = vLG(d.x, 0, d.x + d.w, 0, [[0, vLight(d.col, .12)], [.5, d.col], [1, vDark(d.col, .3)]]); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.2)"; for (let xx = d.x + 2.3; xx < d.x + d.w; xx += 2.3) ctx.fillRect(xx, d.y + 10, .45, d.h - 10);
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(d.x + lw - 1, d.y, 1, d.h);
    ctx.restore();
  });
  const drawCat = (cx, cy) => {                                          // gato laranja sentado, com o rabo balançando
    const sw = Math.sin(t * 2.4), O = "#e0913f", O2 = "#c3722a";
    ctx.strokeStyle = O; ctx.lineWidth = 1.7; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(cx - 3.6, cy - 1.6); ctx.bezierCurveTo(cx - 8, cy - 1, cx - 8.5 + sw, cy - 5, cx - 6.4 + sw * 2, cy - 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 4, cy); ctx.bezierCurveTo(cx - 5.2, cy - 6, cx - 1, cy - 9.6, cx + 2.8, cy - 7); ctx.lineTo(cx + 4.6, cy); ctx.closePath(); ctx.fillStyle = vLG(0, cy - 9, 0, cy, [[0, O], [1, O2]]); ctx.fill();
    ctx.strokeStyle = "rgba(120,60,20,.5)"; ctx.lineWidth = .5; [[-2.4, -6, -1.4, -3.4], [-.4, -7.2, .4, -4.2], [1.6, -6.4, 2.2, -3.8]].forEach(([a, b2, c, d2]) => { ctx.beginPath(); ctx.moveTo(cx + a, cy + b2); ctx.lineTo(cx + c, cy + d2); ctx.stroke(); });
    vCirc(cx + 3.4, cy - 9.2, 3, O); vPoly([[cx + 1, cy - 11], [cx + 1.4, cy - 14], [cx + 3.4, cy - 11.8]], O); vPoly([[cx + 3.8, cy - 11.8], [cx + 5.8, cy - 14], [cx + 6.2, cy - 10.8]], O);
    vPoly([[cx + 1.5, cy - 11.2], [cx + 1.6, cy - 13], [cx + 2.9, cy - 11.8]], "#f0a0a0");
    ctx.fillStyle = "#2a2d35"; ctx.beginPath(); ctx.ellipse(cx + 4.4, cy - 9.6, .45, .7, 0, 0, 6.2832); ctx.fill(); ctx.beginPath(); ctx.ellipse(cx + 2.4, cy - 9.6, .4, .65, 0, 0, 6.2832); ctx.fill();
    vCirc(cx + 5.9, cy - 8.4, .5, "#e88a96"); vEll(cx + 2.2, cy - .2, 1.6, .9, "#f4dcc0"); vEll(cx + 4, cy - .2, 1.6, .9, "#f4dcc0");
  };
  D.cats.forEach(cx => { if (cx > l - 12 && cx < r + 12) drawCat(cx, B - 6); });   // gatos sentados nos degraus
  ctx.restore();
}

function drawCity(now) {
  cityEnsure();
  const dt = Math.min(0.1, Math.max(0, (now - (cityT0 || now)) / 1000)); cityT0 = now;
  const Z = CITY_Z, vw = W / Z, vh = H / Z, vy = Math.max(0, PIER_Y - vh * 0.82);     // o pescador fica bem embaixo, sobra mais tela para os prédios
  const look = dir * vw * 0.06, tgt = Math.max(CITY_CAM_MIN, Math.min(CITY.MAX + CITY_CAM_PAD - vw, px + look - vw / 2));
  cityCamX = cityCamX == null ? tgt : cityCamX + (tgt - cityCamX) * Math.min(1, dt * 4.5);
  const cl = cityCamX, cr = cl + vw;
  lastView = { z: Z, sx: cl, sy: vy };
  ctx.save(); ctx.translate(W / 2, 0); ctx.scale(Z, Z); ctx.translate(-WORLD / 2 - EXT, 0); DAY.paintSky(ctx, now); ctx.restore();   // o mesmo céu do cais, na mesma hora
  ctx.save(); ctx.scale(Z, Z); ctx.translate(-cl, -vy);
  DAY.scene(() => drawCityBack(now, dt, cl, cr), [0, H]);
  cityLit(now, cl, cr);
  DAY.scene(() => {                                                                      // o pescador (com a mesma lavagem da hora)
    const CK = CITY_CHAR;
    ctx.fillStyle = "rgba(0,0,0,.32)"; ctx.beginPath(); ctx.ellipse(px, PIER_Y + 1, 9 * CK, 2.2 * CK, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(px, PIER_Y); ctx.scale(CK, CK); ctx.translate(-px, -PIER_Y);      // pescador reduzido (pés continuam em PIER_Y)
    drawFisher(px, dir, me.shirt, "#d98e04", walkAmp * (1 + 0.45 * runK), movePose(), { pants: me.pants, hs: hScale(me.h) });
    ctx.restore();
    text(myName, px, PIER_Y - FISHER_TOP * hScale(me.h) * CK - 6, "#ffd166", "center");
  }, [PIER_Y - 70, PIER_Y + 12]);
  const dn = !INTRO.active && state === "walk" && !TR.lock && !PH.open && !BAG.open && !UI.open ? cityNearDoor() : null;
  if (dn) {                                                                              // "E" quando há uma porta ao alcance
    const ky = PIER_Y - FISHER_TOP * hScale(me.h) * CITY_CHAR - 30 + Math.round(Math.sin(now / 260) * 1.5), kx = Math.round(px) - 6;   // o "E" flutua em cima do nome do pescador
    rect("#1b2619", kx, ky, 12, 12); rect("#bccdac", kx + 1, ky + 1, 10, 9); rect("#7d8f71", kx + 1, ky + 10, 10, 1);
    ctx.font = UI_PX + "px " + UI_FONT; ctx.textAlign = "center"; ctx.fillStyle = "#1b2619"; ctx.fillText("E", kx + 6, ky + 9);
  }
  if (DAY.lamp > .01) {                                                                  // vinheta azulada no alto: tira o "chapado" e destaca as luzes
    const vg = ctx.createLinearGradient(0, vy, 0, vy + vh * .4); vg.addColorStop(0, "rgba(4,6,24," + (.4 * DAY.lamp).toFixed(3) + ")"); vg.addColorStop(1, "rgba(4,6,24,0)");
    ctx.fillStyle = vg; ctx.fillRect(cl, vy, cr - cl, vh * .4);
  }
  cityFront(now, cl, cr);                                                                // postes e vasos na frente de tudo
  ctx.restore();

  if (!INTRO.active) {
    text(fmtMoney(money), 10, 16, "#8be28b");
    if (invCount() > 0) text("Peixes: " + invCount(), 10, 28, "#ffd166");
    if (!BAG.open) hintLine([PH.open ? "E selecionar   F ou ESC guardar o celular" : (dn ? "E " + cityLabel(dn) + "   I inventário" : "I inventário")], 10, H - 10);
    if (msgT > 0) text(msg, W / 2, 40, "#ffd166", "center");
  }
  drawBag(now);
  drawPhone();
  drawTrans();
  present();
}

// ---------- Tela de entrada / personalizar personagem: apelido, altura (até a do Malto), cor da camiseta e da calça ----------
// Abre sozinha ao entrar no jogo e depois pelo celular (F -> "Personalizar personagem" -> E). O boneco de prévia gira ao clicar.
const UI = { open: false, first: true, snap: null };
const SHIRTS = ["#c0392b", "#e67e22", "#f1c40f", "#27ae60", "#16a085", "#2980b9", "#8e44ad", "#e84393", "#ecf0f1", "#2c3e50"];
const PANTS = ["#26384a", "#1a1a1f", "#4a4e57", "#6b4a2f", "#8c7a55", "#2f5d3a", "#3b6ea8", "#7a2e2e", "#d9d2c0", "#5b3a6b"];
const cz = document.createElement("div"); cz.id = "cz";
cz.innerHTML = `<div class="cz-box" role="dialog" aria-label="Personalizar personagem">
  <div class="cz-title">Pesca no Cais</div>
  <label class="cz-row"><span>Apelido</span><input id="cz-name" maxlength="14" autocomplete="off" spellcheck="false" placeholder="Pescador"></label>
  <div class="cz-prevwrap"><canvas id="cz-prev" width="192" height="198" title="Clique para girar"></canvas></div>
  <div class="cz-hint">clique no boneco para girar</div>
  <label class="cz-row"><span>Altura</span><input id="cz-h" type="range" min="0" max="100" step="1"></label>
  <div class="cz-hint">máximo = a altura do Malto (linha pontilhada)</div>
  <div class="cz-row"><span>Camiseta</span><div class="cz-sw" id="cz-shirt"></div></div>
  <div class="cz-row"><span>Calça</span><div class="cz-sw" id="cz-pants"></div></div>
  <div class="cz-btns"><button id="cz-cancel" type="button">Cancelar</button><button id="cz-ok" type="button">Entrar</button></div>
</div>`;
const czStyle = document.createElement("style");
czStyle.textContent = `
#cz{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;background:rgba(8,12,20,.78);
  font:16px/1.2 "DigitalDisco",ui-monospace,monospace;color:#1b2619;-webkit-font-smoothing:none}
#cz.on{display:flex}
#cz .cz-box{width:min(360px,92vw);max-height:96vh;overflow:auto;box-sizing:border-box;padding:14px 16px 16px;background:#97a888;
  border:4px solid #1b2619;border-radius:10px;box-shadow:0 0 0 3px #7d8f71,0 14px 50px #000}
#cz .cz-title{font-size:32px;text-align:center;padding-bottom:6px;border-bottom:2px solid #1b2619;margin-bottom:10px}
#cz .cz-row{display:flex;align-items:center;gap:10px;margin:8px 0}
#cz .cz-row>span{width:78px;flex:none}
#cz #cz-name{flex:1;min-width:0;font:inherit;color:#1b2619;background:#a9b99b;border:2px solid #1b2619;padding:4px 6px;outline:none}
#cz #cz-name:focus{background:#bccdac}
#cz input[type=range]{flex:1;accent-color:#1b2619}
#cz .cz-prevwrap{display:flex;justify-content:center;margin:6px 0 2px}
#cz canvas{width:192px;height:198px;image-rendering:pixelated;border:2px solid #1b2619;cursor:pointer;touch-action:manipulation}
#cz .cz-hint{font-size:16px;text-align:center;opacity:.75;margin:0 0 4px}
#cz .cz-sw{display:flex;flex-wrap:wrap;gap:5px;flex:1}
#cz .cz-sw button,#cz .cz-sw label{width:22px;height:22px;box-sizing:border-box;border:2px solid #1b2619;padding:0;cursor:pointer;display:block;position:relative}
#cz .cz-sw button.sel{outline:3px solid #1b2619;outline-offset:1px}
#cz .cz-sw label{background:conic-gradient(#e74c3c,#f1c40f,#2ecc71,#3498db,#9b59b6,#e74c3c);overflow:hidden}
#cz .cz-sw label input{position:absolute;inset:-4px;width:40px;height:40px;opacity:0;cursor:pointer}
#cz .cz-btns{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}
#cz .cz-btns button{font:inherit;color:#97a888;background:#1b2619;border:0;padding:6px 16px;cursor:pointer}
#cz .cz-btns button:hover{background:#2f4029}
#cz #cz-cancel{background:transparent;color:#1b2619;border:2px solid #1b2619}
`;
document.head.appendChild(czStyle); document.body.appendChild(cz);
const $cz = id => cz.querySelector("#cz-" + id);
const czName = $cz("name"), czH = $cz("h"), czOk = $cz("ok"), czCancel = $cz("cancel"), pv = $cz("prev"), pvc = pv.getContext("2d");
function czSwatches(id, list, key) {
  const box = $cz(id); box.innerHTML = "";
  list.forEach(c => { const b = document.createElement("button"); b.type = "button"; b.style.background = c; b.dataset.c = c; b.title = c;
    b.onclick = () => { me[key] = c; czSync(); }; box.appendChild(b); });
  const lb = document.createElement("label"); lb.title = "Outra cor"; const inp = document.createElement("input"); inp.type = "color";
  inp.oninput = () => { me[key] = inp.value; czSync(); }; lb.appendChild(inp); box.appendChild(lb); box._inp = inp;
}
function czSync() {
  [["shirt", "shirt"], ["pants", "pants"]].forEach(([id, key]) => { const box = $cz(id);
    box.querySelectorAll("button").forEach(b => b.classList.toggle("sel", b.dataset.c.toLowerCase() === me[key].toLowerCase())); box._inp.value = me[key]; });
  czH.value = Math.round(me.h * 100);
}
czSwatches("shirt", SHIRTS, "shirt"); czSwatches("pants", PANTS, "pants");
czH.oninput = () => { me.h = czH.value / 100; };
function openCustomizer(first) {
  if (UI.open) return;
  UI.open = true; UI.first = first; UI.snap = { name: myName, shirt: me.shirt, pants: me.pants, h: me.h };
  for (const k in keys) keys[k] = false; PH.open = false;
  czName.value = myName; czSync(); czOk.textContent = first ? "Entrar" : "Pronto"; czCancel.style.display = first ? "none" : "";
  cz.classList.add("on"); setTimeout(() => czName.focus(), 30);
}
function closeCustomizer(save) {
  if (!UI.open) return;
  if (save) {
    myName = czName.value.trim().slice(0, 14) || myName || "Pescador" + (100 + Math.random() * 900 | 0);
    try { localStorage.setItem("look", JSON.stringify(lookPayload())); } catch (e) {}
    if (socket && socket.connected) socket.emit(ready ? "look" : "join", lookPayload());   // 1ª vez: entra na sala; depois só atualiza a aparência
    ready = true;
  } else if (UI.snap) { myName = UI.snap.name; me.shirt = UI.snap.shirt; me.pants = UI.snap.pants; me.h = UI.snap.h; }
  UI.open = false; cz.classList.remove("on"); cv.focus();
  if (save && INTRO.phase === "custom") introGo();                    // veio da tela inicial: agora a câmera desce e o pescador cai
}
czOk.onclick = () => { SND.unlock(); closeCustomizer(true); };
czCancel.onclick = () => closeCustomizer(false);
cz.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.key === "Enter" && e.target === czName) { SND.unlock(); closeCustomizer(true); }
  else if (e.key === "Escape" && !UI.first) closeCustomizer(false);
});
const PV = { k: 3, W: 64, H: 66, foot: 60, t: [1, 1, 1], goal: 1, last: 0 };    // prévia: boneco de frente; clicar gira (cabeça, tronco, pernas)
pv.onclick = () => { PV.goal = 1 - PV.goal; };
function drawPreview(now) {
  const dt = Math.min(0.1, (now - (PV.last || now)) / 1000); PV.last = now;
  const g = PV.goal, d = dt / TURN_PART, mv = (v, to) => v + Math.sign(to - v) * Math.min(Math.abs(to - v), d), t = PV.t;
  t[0] = mv(t[0], g);
  if (g ? t[0] > TURN_GATE : t[0] < 1 - TURN_GATE) t[1] = mv(t[1], g);
  if (g ? t[1] > TURN_GATE : t[1] < 1 - TURN_GATE) t[2] = mv(t[2], g);
  const avg = (t[0] + t[1] + t[2]) / 3, b = { rod: REST, arm: 0, lean: 0, off: 0, flex: 0 };
  if (avg > 0.001) { b.front = avg; b.turn = [t[0], t[1], t[2]]; }
  const prev = ctx; ctx = pvc;
  pvc.setTransform(PV.k, 0, 0, PV.k, 0, 0); pvc.imageSmoothingEnabled = false;
  const sky = pvc.createLinearGradient(0, 0, 0, PV.foot); sky.addColorStop(0, "#3a3f6b"); sky.addColorStop(1, "#d98c72");
  rect(sky, 0, 0, PV.W, PV.foot); rect("#7a4e32", 0, PV.foot, PV.W, PV.H - PV.foot); rect("#5a3622", 0, PV.foot, PV.W, 1);
  for (let x = 1; x < PV.W - 1; x += 4) rect("rgba(255,255,255,.55)", x, PV.foot - MALTO_TOP, 2, 1);   // altura do Malto
  pvc.save(); pvc.translate(0, PV.foot - PIER_Y);
  drawFisher(PV.W / 2, 1, me.shirt, "#d98e04", 0, rodPose(newRod(1), b), { pants: me.pants, hs: hScale(me.h) });
  pvc.restore(); ctx = prev;
}

// ---------- Abertura: câmera lá no alto (céu, nuvens e montanhas) com o título FISHTEC e o botão JOGAR ----------
// JOGAR -> personalizar o pescador -> a câmera desce e dá zoom no deck -> o pescador cai do céu em cima do cais -> o jogo começa.
const INTRO = { on: true, active: true, phase: "title", t: 0, landed: false, fell: false, shake: 0, back: false };   // back: voltou do jogo para a tela inicial (o pescador já existe)   // on: câmera especial; active: controles travados; phase: title | custom | go
const ZA = 0.6, INTRO_BOTTOM = 166;                  // tela inicial: zoom (menor = câmera mais longe) e a linha do quadro que fica na base da tela (a água começa em 168)
const ZIN = 1.3, ZOOM_T = 1.1;                    // zoom no deck: quanto aproxima e quantos segundos leva
const I_FALL0 = 0.8, I_FALL_T = 0.8, I_BOUNCE = 0.5, I_DROP = 200;   // queda: começa (s), dura (s), quicada ao pousar (s), altura de onde cai (px)
const SETTLE0 = 2.1, SETTLE_T = 1.0, I_FREE = 2.5, I_END = SETTLE0 + SETTLE_T;   // a câmera volta ao enquadramento normal; controles liberam em I_FREE
const introEl = document.createElement("div"); introEl.id = "intro";
introEl.innerHTML = `<h1 aria-label="FISHTEC">${[..."FISHTEC"].map((c, i) => `<span aria-hidden="true" style="--i:${i}">${c}</span>`).join("")}</h1><button id="intro-play" type="button">JOGAR</button><button id="intro-help" type="button" class="sec">AJUDA</button><button id="intro-config" type="button" class="sec">CONFIGURAÇÕES</button>`;
const introStyle = document.createElement("style");
introStyle.textContent = `
#intro{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:3.4vh;padding-top:8vh;
  pointer-events:none;transition:opacity .55s ease;font-family:"DigitalDisco",ui-monospace,monospace;-webkit-font-smoothing:none}
#intro.off{opacity:0}
#intro h1{perspective:3.5em;perspective-origin:50% 50%}
#intro h1 span{display:inline-block;transform-origin:50% 60%;will-change:transform;animation:introWave 3.2s cubic-bezier(.45,0,.55,1) infinite;animation-delay:calc(var(--i) * -.22s)}
@keyframes introWave{0%,100%{transform:translateZ(-.08em) rotateY(-3deg)}50%{transform:translateZ(.16em) rotateY(3deg)}}
@media (prefers-reduced-motion:reduce){#intro h1 span{animation:none}}
#intro h1{margin:0;font-weight:400;font-size:clamp(54px,12vw,140px);line-height:1;letter-spacing:.09em;color:#ffe0a8;padding-left:.09em;
  text-shadow:0 .045em 0 #f4a261,0 .09em 0 #b83f6a,0 .135em 0 #5e3274,0 0 .6em rgba(255,200,120,.4)}
#intro button{pointer-events:auto;font:inherit;font-size:clamp(24px,4vw,40px);letter-spacing:.14em;padding:.35em 1.7em .35em 1.84em;cursor:pointer;
  color:#241a45;background:#ffe0a8;border:3px solid #241a45;box-shadow:0 .14em 0 #b83f6a,0 0 0 3px #ffe0a8}
#intro button:hover,#intro button:focus-visible{background:#fff6dc;outline:none}
#intro button:active{transform:translateY(.1em);box-shadow:0 .04em 0 #b83f6a,0 0 0 3px #ffe0a8}
#intro button.sec{color:#ffe0a8;background:#241a45;border-color:#ffe0a8;box-shadow:0 .14em 0 #5e3274;margin-top:-1vh}
#intro button.sec:hover,#intro button.sec:focus-visible{background:#3a2a66}
#intro button.sec:active{box-shadow:0 .04em 0 #5e3274}
#help{position:fixed;inset:0;z-index:45;display:none;align-items:center;justify-content:center;background:rgba(8,12,20,.6);
  font-family:"DigitalDisco",ui-monospace,monospace;-webkit-font-smoothing:none;--u:3px;--acc:#ffd166}
#help.on{display:flex}
#help .hp-box{width:min(calc(280 * var(--u)),96vw);box-sizing:border-box;padding:calc(8 * var(--u)) calc(4 * var(--u)) calc(6 * var(--u));
  background:rgba(15,22,36,.96);color:#fff;box-shadow:0 0 0 var(--u) var(--acc),0 calc(10 * var(--u)) calc(30 * var(--u)) rgba(0,0,0,.6);animation:pzPop .18s ease-out}
#help .hp-title{font-size:calc(11 * var(--u));line-height:1;text-align:center;color:var(--acc);text-shadow:var(--u) var(--u) 0 #000}
#help .hp-line{height:var(--u);margin:calc(6 * var(--u)) calc(2 * var(--u)) calc(4 * var(--u));background:rgba(255,255,255,.18)}
#help .hp-row{display:flex;gap:calc(8 * var(--u));align-items:center;min-height:calc(18 * var(--u));padding:calc(2 * var(--u)) calc(6 * var(--u));font-size:calc(11 * var(--u));line-height:1;text-shadow:var(--u) var(--u) 0 #000}
#help .hp-keys{flex:none;width:calc(84 * var(--u));display:flex;align-items:center;justify-content:center;gap:calc(2 * var(--u));color:#1b2230;text-shadow:none}
#help .key{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:calc(14 * var(--u));height:calc(14 * var(--u));padding-bottom:var(--u);
  background:#fff;color:#1b2230;border-bottom:calc(2 * var(--u)) solid #9aa6b8;font-size:calc(11 * var(--u));line-height:1}
#help .key.w{width:calc(26 * var(--u))}
#help .key.sp{width:calc(62 * var(--u))}
#help .key svg,#help .hp-keys>svg{display:block}
#help .hp-keys>svg{color:#fff}
#help .or{color:#9aa6b8;margin:0 calc(1 * var(--u))}
#help .hp-btns{margin-top:calc(2 * var(--u))}
#help .hp-btns button{display:flex;align-items:center;justify-content:space-between;width:100%;height:calc(22 * var(--u));box-sizing:border-box;padding:0 calc(6 * var(--u));margin:0;border:0;border-radius:0;
  background:transparent;color:#fff;font:inherit;font-size:calc(11 * var(--u));line-height:1;text-align:left;cursor:pointer;text-shadow:var(--u) var(--u) 0 #000}
#help .hp-btns button:focus,#help .hp-btns button:active{outline:none;background:rgba(255,209,102,.16);color:var(--acc)}
#help .hp-btns button::after{content:"";width:calc(4 * var(--u));height:calc(4 * var(--u));background:var(--acc);opacity:0;clip-path:polygon(0 0,100% 50%,0 100%)}
#help .hp-btns button:focus::after{opacity:1}`;
document.head.appendChild(introStyle); document.body.appendChild(introEl);
const introBtns = [...introEl.querySelectorAll("button")];
function sizeIntroBtns() {                              // os três botões ficam com o mesmo tamanho (o do mais largo: CONFIGURAÇÕES)
  introBtns.forEach(b => { b.style.width = ""; });
  const w = Math.max(...introBtns.map(b => b.offsetWidth));
  if (w) introBtns.forEach(b => { b.style.width = w + "px"; });
}
sizeIntroBtns(); addEventListener("resize", sizeIntroBtns);
if (document.fonts) document.fonts.ready.then(sizeIntroBtns);
const introBtn = introEl.querySelector("#intro-play"), helpBtn = introEl.querySelector("#intro-help");
const helpEl = document.createElement("div"); helpEl.id = "help";
const PIX = rows => `<svg style="width:calc(var(--u) * ${rows[0].length * (rows.length > 9 ? 0.75 : 1)});height:calc(var(--u) * ${rows.length * (rows.length > 9 ? 0.75 : 1)})" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" fill="currentColor">` +
  rows.map((r, y) => [...r].map((c, x) => c === "#" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : "").join("")).join("") + `</svg>`;   // desenho em pixels (cada # = 1 quadradinho)
const ICO = {
  left:  PIX(["...#.....", "..##.....", ".########", "..##.....", "...#....."]),
  right: PIX([".....#...", ".....##..", "########.", ".....##..", ".....#..."]),
  shift: PIX(["....#....", "...###...", "..#####..", ".#######.", "...###...", "...###...", "...###..."]),
  mouse: PIX([".#######.", "#####...#", "#####...#", "#####...#", "#####...#", "#########", "#.......#", "#.......#", "#.......#", "#.......#", "#.......#", "#.......#", ".#######."]),
};
const KEY = (c, cls = "") => `<span class="key ${cls}">${c}</span>`;
helpEl.innerHTML = `<div class="hp-box" role="dialog" aria-label="Ajuda"><div class="hp-title">Ajuda</div><div class="hp-line"></div>
  <div class="hp-row"><div class="hp-keys">${KEY(ICO.left)}${KEY(ICO.right)}<span class="or">/</span>${KEY("A")}${KEY("D")}</div><span>Andar pelo cais</span></div>
  <div class="hp-row"><div class="hp-keys">${KEY(ICO.shift, "w")}</div><span>Correr (segure)</span></div>
  <div class="hp-row"><div class="hp-keys">${KEY("", "sp")}</div><span>Lançar, fisgar e puxar</span></div>
  <div class="hp-row"><div class="hp-keys">${ICO.mouse}</div><span>Clique/toque = espaço</span></div>
  <div class="hp-row"><div class="hp-keys">${KEY("E")}</div><span>Falar com Malto e Pedro</span></div>
  <div class="hp-row"><div class="hp-keys">${KEY("F")}</div><span>Abrir ou guardar o celular</span></div>
  <div class="hp-row"><div class="hp-keys">${KEY("M")}</div><span>Ligar ou desligar o som</span></div>
  <div class="hp-line"></div><div class="hp-btns"><button id="help-close" type="button">Voltar</button></div></div>`;
document.body.appendChild(helpEl);
const helpClose = helpEl.querySelector("#help-close");
function helpSize() { const r = cv.getBoundingClientRect(); helpEl.style.setProperty("--u", (r.height / H || 3) + "px"); }   // 1 pixel do jogo na tela (mesma escala da pausa)
addEventListener("resize", helpSize);
function openHelp() { helpSize(); helpEl.classList.add("on"); helpClose.focus(); }
function closeHelp() { if (!helpEl.classList.contains("on")) return; helpEl.classList.remove("on"); introBtn.focus(); }
helpBtn.onclick = openHelp; helpClose.onclick = closeHelp;
helpEl.addEventListener("pointerdown", e => { if (e.target === helpEl) closeHelp(); });
addEventListener("keydown", e => { if (e.code === "Escape") closeHelp(); });

// ---------- Config (tela inicial): som e tremor da tela ----------
const cfgEl = document.createElement("div"); cfgEl.id = "cfg";
const cfgStyle = document.createElement("style");
cfgStyle.textContent = `#cfg{position:fixed;inset:0;z-index:45;display:none;align-items:center;justify-content:center;background:rgba(8,12,20,.78);
  font:16px/1.2 "DigitalDisco",ui-monospace,monospace;color:#1b2619;-webkit-font-smoothing:none}
#cfg.on{display:flex}
#cfg .hp-box{width:min(380px,92vw);max-height:96vh;overflow:auto;box-sizing:border-box;padding:14px 18px 16px;background:#97a888;
  border:4px solid #1b2619;border-radius:10px;box-shadow:0 0 0 3px #7d8f71,0 14px 50px #000}
#cfg .hp-title{font-size:32px;text-align:center;padding-bottom:6px;border-bottom:2px solid #1b2619;margin-bottom:8px}
#cfg .hp-row{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px dashed rgba(27,38,25,.35)}
#cfg .hp-row:last-of-type{border-bottom:0}
#cfg .hp-row button,#cfg .hp-btns button{font:inherit;color:#97a888;background:#1b2619;border:0;padding:6px 14px;cursor:pointer}
#cfg .hp-row button{min-width:112px}
#cfg .hp-row button.off{color:#1b2619;background:transparent;box-shadow:inset 0 0 0 2px #1b2619}
#cfg .hp-row button:hover,#cfg .hp-row button:focus-visible,#cfg .hp-btns button:hover,#cfg .hp-btns button:focus-visible{background:#2f4029;color:#97a888;outline:none}
#cfg .hp-btns{display:flex;justify-content:flex-end;margin-top:12px}
#cfg .hp-row>span:first-child{flex:none}
#cfg input[type=range]{flex:1;min-width:0;accent-color:#1b2619;cursor:pointer}
#cfg .vv{flex:none;width:3.6em;text-align:right}`;
document.head.appendChild(cfgStyle);
cfgEl.innerHTML = `<div class="hp-box" role="dialog" aria-label="Configurações"><div class="hp-title">Configurações</div>
  <div class="hp-row"><span>Som</span><button id="cfg-snd" type="button"></button></div>
  <div class="hp-row"><span>Tremor da tela</span><button id="cfg-shk" type="button"></button></div>
  <div class="hp-row"><span>Efeitos</span><input id="cfg-sfx" type="range" min="0" max="150" step="5"><span class="vv" id="cfg-sfxv"></span></div>
  <div class="hp-row"><span>Música</span><input id="cfg-mus" type="range" min="0" max="150" step="5"><span class="vv" id="cfg-musv"></span></div>
  <div class="hp-row" id="cfg-keyrow"><span>Tecla de voltar</span><button id="cfg-key" type="button"></button></div>
  <div class="hp-btns"><button id="cfg-close" type="button">Voltar</button></div></div>`;
document.body.appendChild(cfgEl);
const cfgBtn = introEl.querySelector("#intro-config"), cfgSnd = cfgEl.querySelector("#cfg-snd"), cfgShk = cfgEl.querySelector("#cfg-shk"), cfgClose = cfgEl.querySelector("#cfg-close"), cfgKeyRow = cfgEl.querySelector("#cfg-keyrow"), cfgKey = cfgEl.querySelector("#cfg-key");
const cfgSfx = cfgEl.querySelector("#cfg-sfx"), cfgMus = cfgEl.querySelector("#cfg-mus"), cfgSfxV = cfgEl.querySelector("#cfg-sfxv"), cfgMusV = cfgEl.querySelector("#cfg-musv");
function cfgSync() {
  cfgSfx.value = Math.round(SND.sfxVol * 100); cfgSfxV.textContent = cfgSfx.value + "%";
  cfgMus.value = Math.round(SND.musVol * 100); cfgMusV.textContent = cfgMus.value + "%";
  cfgSnd.textContent = SND.muted ? "DESLIGADO" : "LIGADO"; cfgSnd.classList.toggle("off", SND.muted);
  cfgShk.textContent = SHAKE_ON ? "LIGADO" : "DESLIGADO"; cfgShk.classList.toggle("off", !SHAKE_ON);
  cfgKey.textContent = rebinding ? "PRESSIONE..." : keyLabel(RESUME_KEY);
}
function openCfg() { cfgKeyRow.style.display = INTRO.active ? "none" : ""; cfgSync(); if (PAUSED) pzEl.classList.remove("on"); cfgEl.classList.add("on"); cfgClose.focus(); }
function closeCfg() { if (!cfgEl.classList.contains("on")) return; cfgEl.classList.remove("on"); if (PAUSED) { pzEl.classList.add("on"); pzBack.focus(); } else cfgBtn.focus(); }
cfgBtn.onclick = openCfg; cfgClose.onclick = closeCfg;
cfgKey.onclick = () => { rebinding = true; cfgSync(); };
cfgSnd.onclick = () => { SND.toggleMute(); cfgSync(); };
cfgSfx.oninput = () => { SND.unlock(); SND.setSfxVol(cfgSfx.value / 100); cfgSync(); };
cfgSfx.onchange = () => SND.play("catch_chime", { vol: 0.5, jitter: 0 });           // ao soltar o controle, toca um som de teste
cfgMus.oninput = () => { SND.unlock(); SND.setMusVol(cfgMus.value / 100); cfgSync(); };
cfgShk.onclick = () => { SHAKE_ON = !SHAKE_ON; try { localStorage.setItem("shake", SHAKE_ON ? "1" : "0"); } catch (e) {} cfgSync(); };
cfgEl.addEventListener("pointerdown", e => { if (e.target === cfgEl) closeCfg(); });
addEventListener("keydown", e => { if (e.code === "Escape") closeCfg(); });

// ---------- Pausa (ESC no jogo): voltar ao jogo, configurações e tela inicial ----------
let RESUME_KEY = "Escape";                              // tecla (além do ESC) que fecha a pausa; dá para trocar em Configurações
try { RESUME_KEY = localStorage.getItem("resumeKey") || "Escape"; } catch (e) {}
const keyLabel = c => c === "Escape" ? "ESC" : c === "Space" ? "ESPAÇO" : c.replace(/^(Key|Digit)/, "").replace(/^Arrow/, "SETA ").toUpperCase();
const pzEl = document.createElement("div"); pzEl.id = "pz";
const pzStyle = document.createElement("style");
pzStyle.textContent = `
/* --u = tamanho de 1 pixel do jogo na tela: o painel usa as mesmas medidas do inventário e das caixas de fala */
#pz{position:fixed;inset:0;z-index:45;display:none;align-items:center;justify-content:center;background:rgba(8,12,20,.6);
  font-family:"DigitalDisco",ui-monospace,monospace;-webkit-font-smoothing:none;--u:3px;--acc:#ffd166}
#pz.on{display:flex}
#pz .pz-card{width:calc(200 * var(--u));box-sizing:border-box;padding:calc(8 * var(--u)) calc(4 * var(--u)) calc(6 * var(--u));background:rgba(15,22,36,.96);
  box-shadow:0 0 0 var(--u) var(--acc),0 calc(10 * var(--u)) calc(30 * var(--u)) rgba(0,0,0,.6);animation:pzPop .18s ease-out}
#pz .pz-top{display:flex;justify-content:center;align-items:baseline;padding:0 calc(4 * var(--u));font-size:calc(11 * var(--u));line-height:1;
  text-shadow:var(--u) var(--u) 0 #000}
#pz .pz-top b{font-weight:400;color:var(--acc)}
#pz .pz-line{height:var(--u);margin:calc(6 * var(--u)) calc(2 * var(--u)) calc(4 * var(--u));background:rgba(255,255,255,.18)}
#pz .pz-list{display:flex;flex-direction:column;gap:calc(2 * var(--u))}
#pz button{display:flex;align-items:center;justify-content:space-between;width:100%;height:calc(22 * var(--u));box-sizing:border-box;padding:0 calc(6 * var(--u));margin:0;border:0;border-radius:0;
  background:transparent;color:#fff;font:inherit;font-size:calc(11 * var(--u));line-height:1;text-align:left;cursor:pointer;text-shadow:var(--u) var(--u) 0 #000}
#pz button:focus,#pz button:active{outline:none;background:rgba(255,209,102,.16);color:var(--acc)}
#pz button::after{content:"";width:calc(4 * var(--u));height:calc(4 * var(--u));background:var(--acc);opacity:0;clip-path:polygon(0 0,100% 50%,0 100%)}
#pz button:focus::after{opacity:1}
@keyframes pzPop{from{transform:translateY(calc(6 * var(--u)));opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){#pz .pz-card{animation:none}}`;                                  // painel escuro com borda amarela, no mesmo estilo do inventário
document.head.appendChild(pzStyle);
pzEl.innerHTML = `<div class="pz-card" role="dialog" aria-label="Pausa"><div class="pz-top"><b>Pausa</b></div><div class="pz-line"></div><div class="pz-list"><button id="pz-back" type="button">Voltar ao jogo</button><button id="pz-cfg" type="button">Configurações</button><button id="pz-home" type="button">Tela inicial</button></div></div>`;
document.body.appendChild(pzEl);
const pzBtns = [...pzEl.querySelectorAll("button")], pzBack = pzEl.querySelector("#pz-back"), pzCfg = pzEl.querySelector("#pz-cfg"), pzHome = pzEl.querySelector("#pz-home");
function pzSize() { const r = cv.getBoundingClientRect(); pzEl.style.setProperty("--u", (r.height / H || 3) + "px"); }   // 1 pixel do jogo na tela
addEventListener("resize", pzSize);
pzBtns.forEach(b => b.addEventListener("mouseenter", () => b.focus()));
let rebinding = false;
function pauseGame() {
  PAUSED = true; rebinding = false;
  for (const k in keys) keys[k] = false; SND.reel(false);
  pzEl.classList.add("on");
  pzSize();
  pzBack.focus();
}
function resumeGame() { PAUSED = false; rebinding = false; pzEl.classList.remove("on"); cv.focus(); }
pzBack.onclick = resumeGame;
pzCfg.onclick = openCfg;
const UP_T = 1.7;                                      // segundos que a câmera leva para subir (e para descer de volta)
function goTitle() {                                    // câmera sobe até o céu e o painel FISHTEC (JOGAR / AJUDA / CONFIGURAÇÕES) aparece
  PAUSED = false; rebinding = false; pzEl.classList.remove("on");
  for (const k in keys) keys[k] = false; SND.reel(false); closePhone();
  state = "walk"; wantDraw = false; GSHAKE = 0;
  Object.assign(INTRO, { on: true, active: true, phase: "up", t: 0, back: true });
}
pzHome.onclick = goTitle;
pzEl.addEventListener("pointerdown", e => { if (e.target === pzEl) resumeGame(); });
addEventListener("keydown", e => {                      // captura antes do resto do jogo (assim o ESC que guarda o celular não abre a pausa junto)
  if (rebinding) {                                      // escolhendo a tecla de voltar (em Configurações)
    e.preventDefault(); e.stopPropagation();
    RESUME_KEY = e.code; try { localStorage.setItem("resumeKey", RESUME_KEY); } catch (er) {}
    rebinding = false; cfgSync(); return;
  }
  if (INTRO.active || UI.open) return;
  if (cfgEl.classList.contains("on")) return;           // Configurações aberta: o ESC fecha só ela
  if (PAUSED) {
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat && (e.code === "Escape" || e.code === RESUME_KEY)) { resumeGame(); return; }
    const i = pzBtns.indexOf(document.activeElement), n = pzBtns.length;
    if (e.code === "ArrowDown" || e.code === "KeyS") pzBtns[(i + 1) % n].focus();
    else if (e.code === "ArrowUp" || e.code === "KeyW") pzBtns[(i + n - 1) % n].focus();
    else if ((e.code === "Enter" || e.code === "Space" || e.code === "KeyE") && !e.repeat && i >= 0) pzBtns[i].click();
    return;
  }
  if (e.code === "Escape" && !e.repeat && !PH.open && !BAG.open) { e.preventDefault(); e.stopPropagation(); pauseGame(); }
}, true);
function introPlay() {
  if (INTRO.phase !== "title") return;
  SND.unlock();                                       // o clique libera o som (o mar e o vento começam aqui)
  if (INTRO.back) {                                   // veio da pausa: a câmera só desce de volta e o jogo continua
    introEl.classList.add("off"); setTimeout(() => introEl.remove(), 700); helpEl.remove();
    INTRO.phase = "down"; INTRO.t = 0; return;           // a câmera só desce; o pescador continua no cais (sem queda)
  }
  INTRO.phase = "custom"; introEl.classList.add("off");
  setTimeout(() => introEl.remove(), 700); helpEl.remove();
  openCustomizer(true);
}
function introGo() { INTRO.phase = "go"; INTRO.t = 0; }
introBtn.onclick = introPlay;
setTimeout(() => introBtn.focus(), 50);

function introUpdate(dt) {
  const I = INTRO; I.t += dt;
  if (!I.fell && I.t >= I_FALL0) { I.fell = true; SND.play("cast_whoosh", { vol: 0.35, rate: 1.5 }); }
  if (!I.landed && I.t >= I_FALL0 + I_FALL_T) {         // pousou no deck: poeira, barulho de madeira e um tranco na câmera
    I.landed = true; I.shake = 1; spawnDust(10, 1); spawnDust(10, -1);
    SND.play("step_wood_1", { vol: 0.9, rate: 0.75 }); SND.play("pier_creak_2", { vol: 0.35, rate: 0.9, delay: 0.05 });
  }
  I.shake *= Math.exp(-dt * 7);
  if (I.active && I.t >= I_FREE) I.active = false;
  if (I.t >= I_END) I.on = false;
}
function introMove(dt) {                                // câmera subindo para o título / descendo de volta ao jogo
  const I = INTRO; I.t += dt;
  if (I.t < UP_T) return;
  if (I.phase === "up") {                               // chegou lá em cima: mostra o painel do título de novo
    I.phase = "title";
    introEl.classList.add("off"); document.body.appendChild(introEl); document.body.appendChild(helpEl);
    sizeIntroBtns(); void introEl.offsetWidth; introEl.classList.remove("off"); introBtn.focus();
  } else {                                              // desceu: o jogo continua de onde parou
    Object.assign(I, { phase: "go", t: I_END + 1, on: false, active: false, back: false, landed: true, fell: true });
    cv.focus();
  }
}
function introPose(now) {                               // null = escondido; objeto = caindo/quicando; undefined = pose normal
  const I = INTRO;
  if (I.back) return undefined;                          // voltando ao título: o pescador continua parado no cais
  if (I.phase !== "go" || I.t < I_FALL0) return null;
  const k = (I.t - I_FALL0) / I_FALL_T;
  if (k < 1) return { ...cheerPose(now), hop: I_DROP * (1 - k * k) };                               // cai de braços abertos, acelerando
  return undefined;                                                                                  // pousou: pose normal (o amortecimento vem do introSquash)
}
function introSquash() {                                // amassa/estica o corpo: estica de leve caindo, agacha ao pousar e volta com mola
  const I = INTRO; if (I.phase !== "go") return 0;
  if (!I.landed) return I.t >= I_FALL0 ? -0.07 * Math.min(1, (I.t - I_FALL0) / I_FALL_T) : 0;
  const u = (I.t - I_FALL0 - I_FALL_T) / I_BOUNCE;
  return u >= 1 ? 0 : 0.26 * Math.exp(-4.5 * u) * Math.cos(8 * u);
}
function introCam(now) {                                // câmera: A = longe e no alto (título), B = zoom no deck, C = enquadramento normal do jogo
  const I = INTRO, wx = (W - WORLD) / 2 + camX;
  const A = { z: ZA, x: W / 2, y: INTRO_BOTTOM - H / ZA / 2 + Math.sin(now / 2600) * 2.3 };   // balanço lento da câmera no título (antes 2, +15%)   // a base da tela fica na linha da água: só o deck aparece lá embaixo
  const B = { z: ZIN, x: wx + px, y: PIER_Y - 26 };
  const C = { z: 1, x: W / 2, y: H / 2 };
  const mix = (a, b, p) => {                           // zoom e posição na MESMA curva: o zoom é geométrico e o centro acompanha o tamanho da janela (zoom em direção a um ponto)
    const z = a.z * Math.pow(b.z / a.z, p), q = (1 / z - 1 / a.z) / (1 / b.z - 1 / a.z);
    return { z, x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q };
  };
  if (I.phase === "up") return mix(C, A, ease3(Math.min(1, I.t / UP_T)));
  if (I.phase === "down") return mix(A, C, ease3(Math.min(1, I.t / UP_T)));
  if (I.phase !== "go") return A;
  if (I.t < ZOOM_T) return mix(A, B, ease3(I.t / ZOOM_T));
  if (I.t < SETTLE0) return B;
  return mix(B, C, ease3(Math.min(1, (I.t - SETTLE0) / SETTLE_T)));
}
let introStars = null, introClouds = null;
function introExtra(now) {                              // (em coordenadas do quadro) o que fica acima do céu do jogo: brilho do sol que continua, estrelas e nuvens
  if (!introStars) {
    let r = 4242; const rnd = () => (r = r * 16807 % 2147483647) / 2147483647;
    introStars = Array.from({ length: 320 }, () => ({ x: -320 + rnd() * 1500, y: -2 - rnd() * 380, big: rnd() < 0.16 }));
    introClouds = [[260, 84, -96, 40, 3.2, 0, 311], [200, 62, -62, 300, 2.2, 1, 517], [150, 46, -46, 600, 2.8, 0, 733], [300, 96, -190, 150, 2.0, 1, 911],
      [220, 70, -150, 700, 3.4, 0, 1013], [180, 56, -250, 500, 2.6, 1, 1117], [260, 80, -300, 900, 2.2, 0, 1223], [190, 60, -120, 1000, 2.9, 1, 1319]]
      .map(([w, h, y, x0, v, tone, seed]) => ({ w, h, y, x0, v, img: makeCloud(w, h, seed, tone) }));
  }
  const sxn = (W - WORLD) / 2 + camX * PAR.sky + DAY.sunX, syn = DAY.sunY;   // o mesmo brilho do sol do céu, continuando acima da borda (antes ele aparecia cortado)
  if (DAY.sunA > 0.01 && syn < 80) {
    const g = ctx.createRadialGradient(sxn, syn, 4, sxn, syn, 80);
    g.addColorStop(0, DAY.glow[0]); g.addColorStop(0.2, DAY.glow[1]); g.addColorStop(1, DAY.glow[2]);
    ctx.globalAlpha = DAY.sunA; ctx.fillStyle = g; ctx.fillRect(sxn - 80, syn - 80, 160, 80 - syn); ctx.globalAlpha = 1;
  }
  if (DAY.starA > 0.01) introStars.forEach((st, i) => {
    ctx.globalAlpha = DAY.starA * (0.35 + 0.65 * Math.abs(Math.sin(now / 700 + i * 1.7))) * Math.min(1, -st.y / 36);   // pisca e some perto do horizonte
    rect("#fff6d8", st.x | 0, st.y | 0, st.big ? 2 : 1, st.big ? 2 : 1);
  });
  DAY.scene(() => introClouds.forEach(cl => {
    ctx.globalAlpha = Math.max(0.4, 0.92 + Math.min(0, (cl.y + 40) / 700));                                    // as mais altas ficam mais apagadas
    ctx.drawImage(cl.img, (cl.x0 + now / 1000 * cl.v * 1.15) % 1200 - 280, cl.y, cl.w, cl.h);
  }));
  ctx.globalAlpha = 1;
}
function introBackdrop(now) {                           // com a câmera longe, redesenha o cenário direto das camadas (assim dá para mostrar mais largura que a tela do jogo)
  const ox = (W - WORLD) / 2, wx = ox + camX, lx = f => ox + camX * f - EXT;
  ctx.imageSmoothingEnabled = true;
  const wide = (im, x) => {                              // camada + cópias espelhadas dos lados (quando a câmera abre mais que a camada)
    ctx.drawImage(im, x, 0, LW, H);
    ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, LW, H); ctx.restore();
    ctx.save(); ctx.translate(x + 2 * LW, 0); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, LW, H); ctx.restore();
  };
  const fog = i => { const f = FOGS[i], x0 = ox + camX * f.par - EXT, d = ((now / 1000 * f.sp) % LW + LW) % LW; for (let n = -2; n <= 1; n++) ctx.drawImage(layers.fogs[i], x0 + d + n * LW, f.y0, LW, f.bh); };
  const sk = layers.sky, x = lx(PAR.sky);                // céu: as pontas esticam (o sol fica só no meio)
  ctx.drawImage(sk, x, 0, LW, H);
  ctx.drawImage(sk, 0, 0, 1, sk.height, x - LW, 0, LW, H); ctx.drawImage(sk, sk.width - 1, 0, 1, sk.height, x + LW, 0, LW, H);
  DAY.scene(() => {
  CLOUDS.forEach((c, i) => {
    const cl = layers.clouds[i], u = (now / 1000 + c.seed * 3.7) / c.m, f = u - Math.floor(u), e = f * f * (3 - 2 * f), k = c.back ? 0.8 : 1;
    const cx = (c.x + now / 1000 * c.v) % (LW + c.w) - c.w + lx(c.back ? PAR.sky + 0.03 : PAR.cloud);
    for (let n = -1; n <= 1; n++) {
      ctx.globalAlpha = (1 - e) * k; ctx.drawImage(cl.a, cx + n * (LW + c.w), c.y, c.w, c.h);
      ctx.globalAlpha = e * k;       ctx.drawImage(cl.b, cx + n * (LW + c.w), c.y, c.w, c.h);
    }
    ctx.globalAlpha = 1;
  });
  drawGulls(now);
  wide(layers.far, lx(PAR.far)); fog(0); wide(layers.mid, lx(PAR.mid)); fog(1); wide(layers.near, lx(PAR.near));
  wide(layers.hills, lx(PAR.hills)); wide(layers.lake, lx(PAR.lake)); fog(2);
  drawLakeGlints(now, ox + camX * PAR.sky + DAY.lightX);
  wide(layers.deck, lx(PAR.pier));
  ctx.save(); ctx.translate(wx, 0); lampWide = true; drawLamps(now); drawMalto(now);   // postes também na tela inicial
  if (INTRO.back) {                                      // voltou ao título pela pausa: o pescador (e os outros jogadores) continuam no cais, senão só o reflexo aparece na água
    Object.values(others).forEach(o => drawOther(o, now));
    drawFisher(px, dir, me.shirt, "#d98e04", walkAmp * (1 + 0.45 * runK), movePose(), { pants: me.pants, hs: hScale(me.h) });
  }
  ctx.restore();
  });
  if (DAY.lamp > 0.01) { ctx.save(); ctx.translate(wx, 0); drawLampGlow(now); ctx.restore(); }   // luz dos postes (depois do cenário lavado, como no jogo)
  lampWide = false;
  DAY.scene(() => wide(layers.posts, lx(PAR.pier)));
  ctx.save(); ctx.translate(wx, 0); drawMaltoUI(now); ctx.restore();
}
// tecla ESPAÇO desenhada em pixels (mesmo visual da Ajuda); quando o jogador segura, a tecla aparece apertada (desce 2px, sem a "espessura")
function spaceKey(x, y, down) {                          // y = linha de base do texto
  const kw = 30, d = down ? 2 : 0;
  rect("#1b2619", x, y - 10 + d, kw, 10 + (down ? 0 : 2));                       // contorno + espessura
  rect(down ? "#97a888" : "#bccdac", x + 1, y - 9 + d, kw - 2, 8);                   // face da tecla (mais escura quando apertada)
  if (!down) rect("#7d8f71", x + 1, y - 1, kw - 2, 1);                               // sombra da espessura
  rect("#1b2619", x + 8, y - 5 + d, kw - 16, 1);                                     // traço central (barra de espaço)
}
function hintLine(parts, x, y) {                         // parts: textos e SP (a tecla ESPAÇO no meio da frase)
  ctx.font = UI_PX + "px " + UI_FONT;
  for (const p of parts) {
    if (typeof p === "string") { text(p, x, y); x += Math.ceil(ctx.measureText(p).width); }
    else { spaceKey(x + 2, y, !!keys.Space); x += 34; }
  }
}
function shakeView(now) {                                // balança o quadro pronto: leve ao fisgar/pegar e um tremor bem fraquinho enquanto puxa o peixe
  const a = SHAKE_ON ? GSHAKE + (state === "reel" ? 0.22 : 0) : 0;
  if (a < 0.02) return;
  if (!zctx || zb.width !== buf.width || zb.height !== buf.height) { zb.width = buf.width; zb.height = buf.height; zctx = zb.getContext("2d"); }
  zctx.setTransform(1, 0, 0, 1, 0, 0); zctx.drawImage(buf, 0, 0);
  const dx = Math.sin(now / 21) * a + Math.sin(now / 37 + 2) * a * 0.6, dy = Math.sin(now / 17 + 1) * a, m = a * 1.7;   // m: amplia um pouco para não aparecer borda
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(zb, 0, 0, buf.width, buf.height, dx - m, dy - m, W + 2 * m, H + 2 * m);
}
function introView(now) {                               // longe (zoom < 1): cenário redesenhado; perto (zoom >= 1): reaproveita o quadro pronto (com água e reflexo)
  const c = introCam(now), z = c.z, sw = W / z, sh = H / z, direct = z < 1;
  const sx = c.x - sw / 2, sy = c.y - sh / 2 + (INTRO.phase === "go" ? (SHAKE_ON ? INTRO.shake : 0) * Math.sin(now / 18) * 5.5 : 0);
  if (!zctx || zb.width !== buf.width || zb.height !== buf.height) { zb.width = buf.width; zb.height = buf.height; zctx = zb.getContext("2d"); }
  zctx.setTransform(1, 0, 0, 1, 0, 0); zctx.drawImage(buf, 0, 0);
  ctx.fillStyle = DAY.topCss; ctx.fillRect(0, 0, W, H);                       // mesma cor do topo do céu do jogo: emenda sem costura
  ctx.save(); ctx.translate(-sx * z, -sy * z); ctx.scale(z, z);
  if (sy < 0) introExtra(now);
  if (direct) {
    introBackdrop(now);
    const sl = (x0, flip) => { ctx.save(); ctx.translate(x0, 0); ctx.scale(flip, 1); ctx.drawImage(zb, 0, WATER_Y * S, W * S, (H - WATER_Y) * S, 0, WATER_Y, W, H - WATER_Y); ctx.restore(); };
    sl(0, 1); sl(0, -1); sl(2 * W, -1);                  // água do quadro pronto (com reflexo) no meio e espelhada nas pontas
  }
  ctx.restore();
  if (direct) return;
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(W, sx + sw), y1 = Math.min(H, sy + sh);
  ctx.imageSmoothingEnabled = true;
  if (x1 > x0 && y1 > y0) ctx.drawImage(zb, x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S, (x0 - sx) * z, (y0 - sy) * z, (x1 - x0) * z, (y1 - y0) * z);
}

DAY.update(gameMinutes()); buildLayers(performance.now());     // pré-carrega o cenário inteiro antes do primeiro quadro
2.5.8let last = performance.now(), slow = 0, fast = 0, S_MAX = S, recoverNeed = 600, lastRecover = -1e9;
(function loop(now) {
  const raw = (now - last) / 1000;
  update(Math.min(0.05, raw)); last = now;
  if (raw < 0.5) slow = raw > 0.04 ? slow + 1 : Math.max(0, slow - 1);   // abaixo de ~25 fps por um tempo: reduz a resolução (travadas enormes, como aba em segundo plano ou carregamento, não contam)
  if (slow > 60 && S > 1) {
    if (now - lastRecover < 30000) recoverNeed = Math.min(recoverNeed * 2, 9600);   // voltar à resolução alta deu errado há pouco: espera mais antes de tentar de novo
    setScale(S > 1.5 ? 1.5 : 1); slow = 0; fast = 0;
  }
  fast = raw < 0.026 ? fast + 1 : 0;                              // ~10 s seguidos rodando bem (acima de ~38 fps): sobe a resolução de volta (antes ela só descia e o jogo ficava borrado para sempre)
  if (fast > recoverNeed && S < S_MAX && !CITY.on) { setScale(S < 1.5 ? 1.5 : S_MAX); fast = 0; lastRecover = now; }
  net(now); draw(now); if (UI.open) drawPreview(now); requestAnimationFrame(loop);
})(last);
// (o personalizar agora abre pelo botão JOGAR, ver introPlay)
