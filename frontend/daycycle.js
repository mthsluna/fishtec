// ---------- Ciclo de dia ----------
// Usa gameMinutes() (game.js), que já vem do relógio do SERVIDOR: todo mundo vê a mesma hora e o mesmo céu.
// 1 dia = 30 min reais (DAY_MS no game.js). Para testar no console do navegador:
//   DAY.force = 12 * 60;   // trava ao meio-dia (em minutos do dia do jogo, 0 a 1440)
//   DAY.force = null;      // volta a seguir o relógio
//
// Como funciona:
//  - o CÉU é repintado (a cada ~100 ms) com o degradê da hora, mais sol, lua e estrelas;
//  - o CENÁRIO (nuvens, montanhas, cais, pescadores...) é desenhado num canvas transparente e recebe uma "lavagem" de cor
//    (night = azul escuro, meio-dia = névoa azulada, nascer/pôr do sol = laranja/roxo) antes de ir para a tela, por cima do céu;
//  - a ÁGUA tem a própria lavagem; as ondas/brilhos usam a cor do sol (ou da lua) e seguem a posição dele.
// As cores de cada hora ficam na tabela KEYS logo abaixo: é só mexer nelas para ajustar o visual.
const DAY = (() => {
  // at: hora do dia | sky: [topo, meio, baixo, horizonte] | wash: [r,g,b,força] sobre o cenário | water: idem sobre a água | stars: 0 a 1
  // O visual original do jogo (pôr do sol) é a chave "17:45": força 0 = nada muda.
  const KEYS = [
    { at: "00:00", sky: ["#0a1030", "#121c48", "#1e2d5c", "#2e3d70"], wash: [60, 80, 150, .28], water: [30, 50, 110, .34], stars: 1 },
    { at: "04:00", sky: ["#0a1030", "#121c48", "#1e2d5c", "#2e3d70"], wash: [60, 80, 150, .28], water: [30, 50, 110, .34], stars: 1 },
    { at: "05:30", sky: ["#161c42", "#3a3472", "#7a528a", "#cc7a80"], wash: [90, 80, 130, .22], water: [60, 70, 120, .28], stars: .55 },
    { at: "06:15", sky: ["#2d3f7a", "#c25a7a", "#f4a261", "#ffd9a0"], wash: [255, 170, 130, .14], water: [255, 170, 140, .16], stars: 0 },
    { at: "07:30", sky: ["#3d78c8", "#78b2e6", "#b4d8f0", "#f2e6c8"], wash: [200, 215, 235, .18], water: [90, 150, 200, .34], stars: 0 },
    { at: "10:00", sky: ["#2f6dc2", "#5aa3e6", "#9fcdf0", "#dcecf5"], wash: [205, 225, 240, .24], water: [60, 140, 200, .42], stars: 0 },
    { at: "13:00", sky: ["#2864b8", "#4f9ae2", "#94c8f0", "#d4e8f5"], wash: [205, 228, 242, .26], water: [55, 135, 195, .44], stars: 0 },
    { at: "15:30", sky: ["#3470bc", "#62a0dc", "#aacbe6", "#efe3c6"], wash: [225, 225, 215, .18], water: [80, 140, 190, .34], stars: 0 },
    { at: "17:00", sky: ["#34407e", "#d4807a", "#f5b070", "#ffe6b0"], wash: [255, 200, 140, .08], water: [255, 190, 140, .12], stars: 0 },
    { at: "17:45", sky: ["#241a45", "#b83f6a", "#f4a261", "#ffe0a8"], wash: [0, 0, 0, 0], water: [0, 0, 0, 0], stars: 0 },      // = visual original
    { at: "18:30", sky: ["#161634", "#5a2c66", "#a4426a", "#e07a5a"], wash: [80, 50, 110, .2], water: [70, 50, 105, .2], stars: .1 },
    { at: "19:30", sky: ["#0c1234", "#1c2250", "#3a3568", "#7a4a74"], wash: [55, 65, 130, .3], water: [35, 45, 100, .36], stars: .6 },
    { at: "20:30", sky: ["#0a1030", "#121c48", "#1e2d5c", "#2e3d70"], wash: [60, 80, 150, .28], water: [30, 50, 110, .34], stars: 1 },
    { at: "24:00", sky: ["#0a1030", "#121c48", "#1e2d5c", "#2e3d70"], wash: [60, 80, 150, .28], water: [30, 50, 110, .34], stars: 1 },
  ].map(k => {
    const [h, m] = k.at.split(":").map(Number);
    return { t: h * 60 + m, sky: k.sky.map(c => [1, 3, 5].map(i => parseInt(c.substr(i, 2), 16))), wash: k.wash, water: k.water, stars: k.stars };
  });

  const SUNRISE = 360, SUNSET = 1080;                       // 06:00 e 18:00: o sol cruza o céu nesse intervalo e a lua no resto
  const lerp = (a, b, f) => a + (b - a) * f;
  const mix = (a, b, f) => a.map((v, i) => lerp(v, b[i], f));
  const sm = (a, b, v) => { const k = Math.max(0, Math.min(1, (v - a) / (b - a))); return k * k * (3 - 2 * k); };
  const rgb = c => c.map(v => Math.round(v)).join(",");
  // mistura [r,g,b,força]; se um dos lados tem força 0 (sem lavagem), a cor vem do outro lado: evita escurecer à toa na transição
  const mixW = (a, b, f) => {
    const o = mix(a, b, f);
    if (a[3] <= 0) { o[0] = b[0]; o[1] = b[1]; o[2] = b[2]; } else if (b[3] <= 0) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; }
    return o;
  };

  // estrelas fixas (mesmas para todos os jogadores)
  let seed = 90210; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const STARS = Array.from({ length: 110 }, () => ({ x: -160 + rnd() * 800, y: 2 + rnd() * 104, big: rnd() < 0.14, ph: rnd() * 6.28 }));

  const D = {
    force: null,                                            // minutos fixos para testar (null = segue o relógio)
    m: 0,
    sky: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    topCss: "#241a45", washCss: "rgba(0,0,0,0)", washA: 0, waterCss: "rgba(0,0,0,0)", waterA: 0,
    starA: 0,
    lamp: 0,                                                // 0 a 1: quão acesos estão os postes de luz (acendem no entardecer, apagam de manhã)
    sunX: 370, sunY: 62, sunA: 1, sunE: .4, moonX: 100, moonY: 60, moonA: 0,
    lightX: 370, lightA: 1, lc: [255, 205, 150],            // de onde vem o brilho na água, quão forte e de que cor
    glow: ["#fffbe6", "#ffe9a8", "rgba(255,200,120,0)"],

    update(minutes) {
      const m = this.force != null ? ((this.force % 1440) + 1440) % 1440 : minutes;
      this.m = m;
      let i = 0; while (i < KEYS.length - 2 && m >= KEYS[i + 1].t) i++;
      const a = KEYS[i], b = KEYS[i + 1], f = sm(0, 1, (m - a.t) / (b.t - a.t));
      this.sky = a.sky.map((c, j) => mix(c, b.sky[j], f));
      this.topCss = "rgb(" + rgb(this.sky[0]) + ")";
      const w = mixW(a.wash, b.wash, f), v = mixW(a.water, b.water, f);
      this.washA = w[3]; this.washCss = `rgba(${rgb(w.slice(0, 3))},${w[3].toFixed(3)})`;
      this.waterA = v[3]; this.waterCss = `rgba(${rgb(v.slice(0, 3))},${v[3].toFixed(3)})`;
      this.starA = lerp(a.stars, b.stars, f);
      this.lamp = m < 720 ? 1 - sm(345, 375, m) : sm(1050, 1080, m);   // apagam das 05:45 às 06:15; acendem das 17:30 às 18:00

      // sol: nasce à esquerda, passa no alto ao meio-dia e se põe à direita atrás das montanhas
      const p = (m - SUNRISE) / (SUNSET - SUNRISE);
      if (p >= 0 && p <= 1) {
        const e = Math.sin(Math.PI * p);
        this.sunX = 60 + 360 * p; this.sunY = HZ + 6 - (HZ + 6 - 26) * Math.pow(e, .85);
        this.sunA = sm(0, .12, e); this.sunE = e;
      } else this.sunA = 0;
      // lua: faz o mesmo caminho durante a noite
      const q = m >= SUNSET ? (m - SUNSET) / 720 : (m + 1440 - SUNSET) / 720;
      if (q >= 0 && q <= 1) {
        const e = Math.sin(Math.PI * q);
        this.moonX = 60 + 360 * q; this.moonY = HZ + 6 - (HZ + 6 - 34) * Math.pow(e, .85);
        this.moonA = sm(0, .12, e);
      } else this.moonA = 0;

      // cor/posição do brilho na água e no lago
      const sunL = this.sunA, moonL = this.moonA * 0.55;
      if (sunL >= moonL) { this.lightX = this.sunX; this.lightA = sunL; this.lc = mix([255, 205, 150], [255, 238, 205], this.sunE); }
      else { this.lightX = this.moonX; this.lightA = moonL; this.lc = [185, 205, 250]; }
      const e = this.sunE;
      this.glow = [`rgb(${rgb(mix([255, 251, 230], [255, 255, 255], e))})`, `rgb(${rgb(mix([255, 233, 168], [255, 243, 196], e))})`, `rgba(${rgb(mix([255, 200, 120], [255, 235, 170], e))},0)`];
    },

    // pinta o céu no contexto c (coordenadas do mundo; as margens EXT ficam dos dois lados)
    paintSky(c, now = 0) {
      c.save(); c.translate(EXT, 0);
      const s = this.sky, bot = PIER_Y + 8;
      let g = c.createLinearGradient(0, 0, 0, bot);
      g.addColorStop(0, "rgb(" + rgb(s[0]) + ")"); g.addColorStop(0.45, "rgb(" + rgb(s[1]) + ")");
      g.addColorStop(0.8, "rgb(" + rgb(s[2]) + ")"); g.addColorStop(1, "rgb(" + rgb(s[3]) + ")");
      c.fillStyle = g; c.fillRect(-EXT, 0, LW, bot);
      if (this.starA > 0.01) {
        const t = now / 1000;
        STARS.forEach(st => {
          const a = this.starA * (0.4 + 0.6 * Math.pow(Math.sin(t * 0.9 + st.ph) * 0.5 + 0.5, 1.5)) * Math.max(0, 1 - st.y / 112);
          if (a < 0.03) return;
          c.globalAlpha = a; c.fillStyle = "#fff6d8"; c.fillRect(st.x | 0, st.y | 0, st.big ? 2 : 1, st.big ? 2 : 1);
        });
        c.globalAlpha = 1;
      }
      if (this.sunA > 0.01) {                               // brilho do sol (o mesmo desenho do pôr do sol original)
        const x = this.sunX, y = this.sunY;
        g = c.createRadialGradient(x, y, 4, x, y, 80);
        g.addColorStop(0, this.glow[0]); g.addColorStop(0.2, this.glow[1]); g.addColorStop(1, this.glow[2]);
        c.globalAlpha = this.sunA; c.fillStyle = g;
        c.save(); c.beginPath(); c.rect(x - 80, 0, 160, PIER_Y); c.clip(); c.fillRect(x - 80, y - 80, 160, 160); c.restore();
        c.globalAlpha = 1;
      }
      if (this.moonA > 0.01) {                              // lua: halo, disco e algumas crateras
        const x = this.moonX, y = this.moonY;
        c.globalAlpha = this.moonA;
        g = c.createRadialGradient(x, y, 5, x, y, 42);
        g.addColorStop(0, "rgba(200,215,255,.42)"); g.addColorStop(1, "rgba(200,215,255,0)");
        c.fillStyle = g; c.fillRect(x - 42, y - 42, 84, 84);
        c.fillStyle = "#eef2ff"; c.beginPath(); c.arc(x, y, 6.5, 0, 6.2832); c.fill();
        c.fillStyle = "rgba(150,165,205,.55)";
        [[-2, -1.5, 1.6], [2.2, 1.2, 1.3], [-0.5, 3, 1]].forEach(([dx, dy, r]) => { c.beginPath(); c.arc(x + dx, y + dy, r, 0, 6.2832); c.fill(); });
        c.globalAlpha = 1;
      }
      c.restore();
    },

    lastSky: -1e9,
    repaintSky(now) {                                       // chamado todo quadro; só repinta de ~100 em ~100 ms
      if (!layers || !layers.sky || now - this.lastSky < 100) return;
      this.lastSky = now;
      this.paintSky(layers.sky.getContext("2d"), now);
    },

    // desenha fn() num canvas transparente, aplica a lavagem de cor do horário e joga o resultado por cima do que já está na tela
    // band = [y0, y1] (opcional): só essa faixa (em coordenadas do jogo, sem zoom) é limpa, lavada e copiada
    _sc: null, _scx: null,
    scene(fn, band) {
      if (this.washA <= 0.004) { fn(); return; }              // sem lavagem (visual original): desenha direto, sem custo extra
      const main = ctx, w = buf.width, h = buf.height;
      if (!this._sc || this._sc.width !== w || this._sc.height !== h) {
        this._sc = document.createElement("canvas"); this._sc.width = w; this._sc.height = h; this._scx = this._sc.getContext("2d");
      }
      const sc = this._scx, tf = main.getTransform();
      let y0 = 0, y1 = h;
      if (band) { y0 = Math.max(0, Math.floor(band[0] * S)); y1 = Math.min(h, Math.ceil(band[1] * S)); }
      sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalAlpha = 1; sc.globalCompositeOperation = "source-over";
      sc.clearRect(0, y0, w, y1 - y0);
      sc.setTransform(tf); sc.imageSmoothingEnabled = main.imageSmoothingEnabled;
      ctx = sc;
      try { fn(); } finally { ctx = main; }
      sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalAlpha = 1;
      if (this.washA > 0.004) {
        sc.globalCompositeOperation = "source-atop"; sc.fillStyle = this.washCss; sc.fillRect(0, y0, w, y1 - y0);
        sc.globalCompositeOperation = "source-over";
      }
      main.save(); main.setTransform(1, 0, 0, 1, 0, 0); main.globalAlpha = 1;
      main.drawImage(this._sc, 0, y0, w, y1 - y0, 0, y0, w, y1 - y0);
      main.restore();
    },

    washWater() {                                           // lavagem só no fundo d'água (antes do reflexo, que já vem lavado)
      if (this.waterA < 0.004 && this.washA < 0.004) return;
      // no topo a água usa a mesma lavagem do lago distante (sem emenda na linha da água) e vai passando para a cor própria da água
      const FADE = 22, g = ctx.createLinearGradient(0, WATER_Y, 0, WATER_Y + FADE);
      g.addColorStop(0, this.washCss); g.addColorStop(1, this.waterCss);
      ctx.fillStyle = g; ctx.fillRect(0, WATER_Y, W, FADE);
      ctx.fillStyle = this.waterCss; ctx.fillRect(0, WATER_Y + FADE, W, H - WATER_Y - FADE);
    },
  };
  return D;
})();
