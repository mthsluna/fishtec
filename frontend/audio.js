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
    "bite_alert", "hook_set", "reel_1", "reel_2", "reel_ratchet",
    "catch_splash", "catch_chime", "fish_escaped",
  ];
  const AMBIENCE = [["ambient_sea", 0.55], ["ambient_wind", 0.35], ["ambient_water_lap", 0.3]];

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

  function unlock() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ac.destination);
      sfx = ac.createGain(); sfx.gain.value = 1; sfx.connect(master);
      amb = ac.createGain(); amb.gain.value = 0.8; amb.connect(master);
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
      if (master) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    get muted() { return muted; },
    step() {                                              // nunca repete o mesmo passo duas vezes seguidas
      let i; do { i = 1 + (Math.random() * 4 | 0); } while (i === lastStep); lastStep = i;
      play("step_wood_" + i, { vol: 0.7, jitter: 0.08 });
      if (Math.random() < 0.07) play("pier_creak_" + (1 + (Math.random() * 2 | 0)), { vol: 0.35, delay: 0.05 });
    },
    cast() {
      play("cast_whoosh", { vol: 0.9 });
      play("bobber_splash_" + (1 + (Math.random() * 3 | 0)), { vol: 0.8, delay: 0.5 });   // a isca cai na água
    },
    retract() { play("reel_ratchet", { vol: 0.6 }); },
    bite() { play("bite_alert", { vol: 0.9 }); },
    hook() { play("hook_set", { vol: 0.9 }); play("reel_ratchet", { vol: 0.5, delay: 0.08 }); },
    reel() { play(pick(["reel_1", "reel_2"]), { vol: 0.55, jitter: 0.1 }); },
    win() { play("catch_splash", { vol: 0.95 }); play("catch_chime", { vol: 0.55, delay: 0.35, jitter: 0 }); },
    lose() { play("fish_escaped", { vol: 0.8 }); },
  };
  return api;
})();
