// ---------- Contas (Supabase): entrar / criar conta e salvar o progresso na nuvem ----------
// Fluxo: tela de login -> baixa o progresso da conta para o localStorage -> só então carrega o game.js.
// O game.js continua lendo/gravando no localStorage como sempre; este arquivo só sincroniza isso com o Supabase.
// Se o Supabase não estiver configurado (config.js), o jogo abre direto, como antes, sem conta.
(() => {
  const SB_URL = window.SUPABASE_URL, SB_KEY = window.SUPABASE_ANON_KEY;
  const GAME_KEYS = ["money", "inv", "owned", "look"];      // o que o game.js guarda no localStorage e vai para a nuvem

  let gameLoaded = false;
  const loadGame = () => {
    if (gameLoaded) return; gameLoaded = true;
    const s = document.createElement("script"); s.src = "game.js"; document.body.appendChild(s);
  };

  const configured = SB_URL && SB_KEY && !/SEU[_-]|YOUR[_-]/i.test(SB_URL + SB_KEY) && window.supabase && window.supabase.createClient;
  if (!configured) { console.warn("[fishtec] Supabase não configurado em config.js: abrindo o jogo sem contas."); loadGame(); return; }

  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  let uid = null, canSave = false, timer = 0, pending = false;

  // ---------- Progresso: localStorage <-> tabela game_saves ----------
  const readJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const snapshot = () => ({
    user_id: uid,
    money: Math.max(0, parseInt(localStorage.getItem("money"), 10) || 0),
    inv: readJSON("inv", {}), owned: readJSON("owned", []), look: readJSON("look", {}),
  });
  const applyToLocal = d => {
    localStorage.setItem("money", String(Math.max(0, Number(d.money) || 0)));
    localStorage.setItem("inv", JSON.stringify(d.inv || {}));
    localStorage.setItem("owned", JSON.stringify(d.owned || []));
    localStorage.setItem("look", JSON.stringify(d.look || {}));
  };
  const clearLocal = () => { GAME_KEYS.concat("cloudUid").forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); };

  async function pushNow() {                                 // devolve true se salvou (ou se não havia o que salvar)
    clearTimeout(timer);
    if (!canSave || !uid) return true;
    pending = false;
    const { error } = await sb.from("game_saves").upsert(snapshot(), { onConflict: "user_id" });
    if (error) { pending = true; console.warn("[fishtec] não foi possível salvar:", error.message); return false; }
    return true;
  }

  const CLOUD = window.CLOUD = {
    active: false,
    save() { if (!canSave) return; pending = true; clearTimeout(timer); timer = setTimeout(pushNow, 1500); },     // o game.js chama isto sempre que muda dinheiro/peixes/roupa
    async logout() {
      if (!(await pushNow()) && !confirm("Não deu para salvar seu progresso agora. Sair mesmo assim?")) return;
      canSave = false;
      await sb.auth.signOut();
      clearLocal();                                          // o próximo a entrar neste navegador não herda o progresso de quem saiu
      location.reload();
    },
  };
  const flush = () => { if (pending) pushNow(); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  addEventListener("pagehide", flush);
  sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT" && canSave) { canSave = false; location.reload(); } });   // saiu em outra aba

  // ---------- Tela de login (mesma paleta e fonte da tela inicial) ----------
  const css = document.createElement("style");
  css.textContent = `
@font-face{font-family:"DigitalDisco";src:url("assets/fonts/DigitalDisco.ttf") format("truetype");font-display:block}
#auth{position:fixed;inset:0;z-index:100;display:flex;overflow:auto;padding:20px 16px;box-sizing:border-box;background:#14202b;color:#ffe0a8;
  font:16px/1.35 "DigitalDisco",ui-monospace,monospace;-webkit-font-smoothing:none}
#auth [hidden]{display:none!important}
#auth .au-wrap{margin:auto;width:min(380px,100%);display:flex;flex-direction:column;align-items:center;gap:28px}
#auth h1{margin:0;font-weight:400;font-size:clamp(40px,11vw,64px);line-height:1;letter-spacing:.09em;padding-left:.09em;color:#ffe0a8;
  text-shadow:0 .045em 0 #f4a261,0 .09em 0 #b83f6a,0 .135em 0 #5e3274,0 0 .6em rgba(255,200,120,.4)}
#auth .au-box{width:100%;box-sizing:border-box;padding:18px;background:#241a45;box-shadow:0 0 0 3px #ffe0a8,0 8px 0 3px #5e3274}
#auth .au-tabs{display:flex;gap:8px;margin-bottom:16px}
#auth button{font:inherit;cursor:pointer;border:3px solid #ffe0a8;color:#ffe0a8;background:transparent;padding:8px 10px}
#auth .au-tabs button{flex:1}
#auth .au-tabs button[aria-selected=true]{color:#241a45;background:#ffe0a8}
#auth .au-tabs button:not([aria-selected=true]):hover{background:#3a2a66}
#auth label{display:block;margin-bottom:12px}
#auth input{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;font:inherit;font-size:16px;color:#fff6dc;background:#160f2c;border:2px solid #5e3274;border-radius:0;outline:none}
#auth input:focus{border-color:#ffe0a8;box-shadow:0 0 0 2px #ffe0a8}
#auth .au-msg{min-height:2.7em;margin:0 0 10px;color:#ffe0a8}
#auth .au-msg.err{color:#ff9db5}
#auth .au-msg.ok{color:#b6f0a8}
#auth .au-go{width:100%;font-size:22px;letter-spacing:.14em;padding:10px;color:#241a45;background:#ffe0a8;border-color:#241a45;box-shadow:0 5px 0 #b83f6a,0 0 0 3px #ffe0a8}
#auth .au-go:hover,#auth .au-go:focus-visible{background:#fff6dc;outline:none}
#auth .au-go:active{transform:translateY(3px);box-shadow:0 2px 0 #b83f6a,0 0 0 3px #ffe0a8}
#auth .au-go:disabled{opacity:.6;cursor:wait;transform:none}
#auth .au-alt{width:100%;margin-top:12px}
#auth .au-alt:hover,#auth .au-alt:focus-visible{background:#3a2a66;outline:none}
#auth .au-status{margin:0;text-align:center}
#auth button:focus-visible{outline:3px solid #fff6dc;outline-offset:2px}`;
  document.head.appendChild(css);

  const overlay = document.createElement("div");
  overlay.id = "auth"; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "Entrar no FISHTEC");
  overlay.innerHTML = `<div class="au-wrap"><h1 aria-label="FISHTEC">FISHTEC</h1><div class="au-box"></div></div>`;
  document.body.appendChild(overlay);
  const box = overlay.querySelector(".au-box");

  const friendly = err => {                                  // erros do Supabase em português, dizendo o que fazer
    const m = String((err && err.message) || err || ""), c = String((err && (err.code || err.error_code)) || "");
    if (c === "invalid_credentials" || /invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (c === "email_not_confirmed" || /email not confirmed/i.test(m)) return "Falta confirmar o e-mail. Abra o link que enviamos para você.";
    if (c === "user_already_exists" || c === "email_exists" || /already registered/i.test(m)) return "Esse e-mail já tem conta. Use a aba Entrar.";
    if (c === "weak_password" || /weak|at least \d+ characters/i.test(m)) return "Senha fraca. Use pelo menos 6 caracteres, com letras e números.";
    if (c === "email_address_invalid" || /email address .* invalid/i.test(m)) return "Esse e-mail não foi aceito. Confira se está certo.";
    if (/rate.?limit|too many/i.test(c + " " + m)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
    if (c === "signup_disabled" || /signups? (are )?(not allowed|disabled)/i.test(m)) return "Novos cadastros estão desativados no momento.";
    if (/failed to fetch|network|load failed/i.test(m)) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
    return "Não deu certo: " + (m || "erro desconhecido");
  };

  function viewLoading(msg) { box.innerHTML = `<p class="au-status" role="status">${msg}</p>`; }

  function viewRetry(user) {                                 // não conseguiu baixar o progresso: NÃO inicia o jogo (senão um save vazio poderia sobrescrever o da nuvem)
    box.innerHTML = `<p class="au-msg err" role="alert">Não deu para carregar seu progresso. Verifique a internet e tente de novo.</p>
      <button type="button" class="au-go" id="au-retry">TENTAR DE NOVO</button>
      <button type="button" class="au-alt" id="au-out">Sair da conta</button>`;
    box.querySelector("#au-retry").onclick = () => enter(user);
    box.querySelector("#au-out").onclick = async () => { await sb.auth.signOut(); clearLocal(); location.reload(); };
    box.querySelector("#au-retry").focus();
  }

  function viewForm() {
    let signUp = false;
    box.innerHTML = `<div class="au-tabs" role="tablist">
        <button type="button" role="tab" id="au-t-in" aria-selected="true">Entrar</button>
        <button type="button" role="tab" id="au-t-up" aria-selected="false">Criar conta</button>
      </div>
      <form id="au-form" novalidate>
        <label>E-mail<input id="au-email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false"></label>
        <label>Senha<input id="au-pass" type="password" autocomplete="current-password"></label>
        <label id="au-l2" hidden>Repita a senha<input id="au-pass2" type="password" autocomplete="new-password"></label>
        <p class="au-msg" id="au-msg" role="status" aria-live="polite"></p>
        <button type="submit" class="au-go" id="au-go">ENTRAR</button>
      </form>`;
    const $ = id => box.querySelector("#" + id);
    const say = (t, kind) => { const m = $("au-msg"); m.textContent = t || ""; m.className = "au-msg" + (kind ? " " + kind : ""); };
    const busy = b => { $("au-go").disabled = b; };
    const setMode = up => {
      signUp = up;
      $("au-t-in").setAttribute("aria-selected", String(!up)); $("au-t-up").setAttribute("aria-selected", String(up));
      $("au-l2").hidden = !up; $("au-pass").autocomplete = up ? "new-password" : "current-password";
      $("au-go").textContent = up ? "CRIAR CONTA" : "ENTRAR"; say("");
    };
    $("au-t-in").onclick = () => setMode(false);
    $("au-t-up").onclick = () => setMode(true);

    $("au-form").onsubmit = async e => {
      e.preventDefault();
      const email = $("au-email").value.trim(), pass = $("au-pass").value;
      if (!/^\S+@\S+\.\S+$/.test(email)) return say("Digite um e-mail válido.", "err");
      if (pass.length < 6) return say("A senha precisa ter pelo menos 6 caracteres.", "err");
      if (signUp && pass !== $("au-pass2").value) return say("As duas senhas não são iguais.", "err");
      busy(true); say(signUp ? "Criando sua conta..." : "Entrando...");
      try {
        if (signUp) {
          const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.origin + location.pathname } });
          if (error) throw error;
          if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw { code: "user_already_exists" };   // o Supabase não dá erro para e-mail repetido quando exige confirmação
          if (!data.session) {                                // confirmação de e-mail ligada: a conta só vale depois do clique no link
            setMode(false); $("au-email").value = email;
            say("Conta criada! Enviamos um link de confirmação para " + email + ". Abra o link e depois entre aqui.", "ok");
            return busy(false);
          }
          await enter(data.session.user);
        } else {
          const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
          if (error) throw error;
          await enter(data.user);
        }
      } catch (err) { say(friendly(err), "err"); busy(false); }
    };
    $("au-email").focus();
  }

  // ---------- Entrou: baixa o progresso, grava no localStorage e inicia o jogo ----------
  async function enter(user) {
    viewLoading("Carregando seu progresso...");
    try {
      const { data, error } = await sb.from("game_saves").select("money,inv,owned,look").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      const owner = localStorage.getItem("cloudUid");
      if (owner && owner !== user.id) clearLocal();           // sobrou progresso de OUTRA conta neste navegador: descarta
      uid = user.id;
      if (data) applyToLocal(data);                           // conta com save: a nuvem manda
      else { canSave = true; if (!(await pushNow())) throw new Error("save inicial falhou"); }   // 1ª vez: sobe o que já estava neste navegador (jogadores antigos não perdem nada)
      localStorage.setItem("cloudUid", user.id);
      canSave = true;
    } catch (err) { console.error("[fishtec]", err); canSave = false; viewRetry(user); return; }
    CLOUD.active = true;
    overlay.remove();
    loadGame();
  }

  (async () => {
    viewLoading("Carregando...");
    const { data } = await sb.auth.getSession();
    if (data && data.session) enter(data.session.user); else viewForm();
  })();
})();
