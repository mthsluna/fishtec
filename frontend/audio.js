// ---------- Áudio (WebAudio) ----------
// Coloque os .wav em assets/audio/. O navegador só libera som depois do primeiro toque/tecla,
// então o jogo chama SND.unlock() nos eventos de entrada. Arquivo que faltar é ignorado em silêncio.
const SND = (() => {
  const BASE = "assets/audio/";
  const NAMES = [
    "ambient_wind", "ambient_sea", "ambient_water_lap",
    "step_wood_1", "step_wood_2", "step_wood_3", "step_wood_4",
    "pier_creak_1", "pier_creak_2",
    "cast_whoosh", "bobber_splash_1", "bobber_splash_2", "bobber_splash_3",
    "bite_alert", "hook_set", "reel_loop", "reel_ratchet",
    "catch_splash", "catch_chime", "fish_escaped",
  ];
  const AMBIENCE = [["ambient_sea", 0.3], ["ambient_wind", 0.08], ["ambient_water_lap", 0.18]];   // volumes de cada loop (0 a 1)
  const CREAK_VOL = 0.28;                                  // volume do ranger da madeira a cada passo

  let ac = null, master = null, sfx = null, amb = null;
  const buf = {};
  let muted = false, ambStarted = false, loading = false;
  try { muted = localStorage.getItem("muted") === "1"; } catch (e) {}

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.random() * arr.length | 0];

  function load() {
    if (loading) return; loading = true;
    Promise.all(NAMES.map(n =>
      fetch(BASE + n + ".wav").then(r => r.ok ? r.arrayBuffer() : Promise.reject())
        .then(a => new Promise((ok, no) => ac.decodeAudioData(a, ok, no)))
        .then(b => { buf[n] = b; })
        .catch(() => {})
    )).then(startAmbience);
  }

  function startAmbience() {
    if (ambStarted || !ac) return; ambStarted = true;
    AMBIENCE.forEach(([n, v]) => {
      if (!buf[n]) return;
      const s = ac.createBufferSource(), g = ac.createGain();
      s.buffer = buf[n]; s.loop = true; g.gain.value = v;
      s.connect(g); g.connect(amb);
      s.start(0, Math.random() * buf[n].duration);       // cada visita começa num ponto diferente
    });
  }

  // ranger da madeira: só toca junto com cada passo ("nhec... nhec... nhec")
  let lastCreak = 0;
  function creak() {
    lastCreak = lastCreak === 1 ? 2 : 1;                 // alterna 1, 2, 1, 2...
    play("pier_creak_" + lastCreak, { vol: CREAK_VOL, jitter: 0.12, delay: 0.02 });
  }

  // carretilha em loop: liga/desliga com fade enquanto segura ESPAÇO
  let reelSrc = null, reelGain = null;
  function reelLoop(on) {
    if (!ac || !buf.reel_loop) return;
    if (!reelSrc) {
      reelSrc = ac.createBufferSource(); reelGain = ac.createGain();
      reelSrc.buffer = buf.reel_loop; reelSrc.loop = true; reelGain.gain.value = 0;
      reelSrc.connect(reelGain); reelGain.connect(sfx); reelSrc.start();
    }
    reelGain.gain.setTargetAtTime(on ? 0.5 : 0, ac.currentTime, 0.05);
  }

  function unlock() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(ac.destination);
      sfx = ac.createGain(); sfx.gain.value = 1; sfx.connect(master);
      amb = ac.createGain(); amb.gain.value = 0.7; amb.connect(master);
    }
    if (ac.state === "suspended") ac.resume();
    load();
  }

  // toca um efeito; rate varia um pouco para não soar repetido
  function play(name, { vol = 1, rate = 1, jitter = 0.06, delay = 0 } = {}) {
    if (!ac || !buf[name]) return;
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = buf[name];
    s.playbackRate.value = rate * (1 + rnd(-jitter, jitter));
    g.gain.value = vol * rnd(0.9, 1);
    s.connect(g); g.connect(sfx);
    s.start(ac.currentTime + delay);
  }

  let lastStep = -1;
  const api = {
    unlock,
    play,
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem("muted", muted ? "1" : "0"); } catch (e) {}
      if (master) master.gain.value = muted ? 0 : 0.7;
      return muted;
    },
    get muted() { return muted; },
    step() {                                              // nunca repete o mesmo passo duas vezes seguidas
      let i; do { i = 1 + (Math.random() * 4 | 0); } while (i === lastStep); lastStep = i;
      play("step_wood_" + i, { vol: 0.45, jitter: 0.08 });
      creak();
    },
    cast() { play("cast_whoosh", { vol: 0.6, delay: 0.25 }); },          // o swish acompanha o chicote da vara
    splash() { play("bobber_splash_" + (1 + (Math.random() * 3 | 0)), { vol: 0.5 }); },   // toca quando a isca cai na água
    retract() { play("reel_ratchet", { vol: 0.4 }); },
    bite() { play("bite_alert", { vol: 0.6 }); },
    hook() { play("hook_set", { vol: 0.6 }); play("reel_ratchet", { vol: 0.35, delay: 0.08 }); },
    reel: reelLoop,                                       // reel(true) liga o loop, reel(false) desliga
    win() { reelLoop(false); play("catch_splash", { vol: 0.65 }); play("catch_chime", { vol: 0.35, delay: 0.35, jitter: 0 }); },
    lose() { play("fish_escaped", { vol: 0.5 }); reelLoop(false); },
  };
  return api;
})();
