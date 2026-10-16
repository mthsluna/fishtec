// ---------- Proteção básica: sem selecionar, copiar, arrastar, menu do botão direito e atalhos do inspetor ----------
// Obs.: isso só dificulta para quem usa o navegador normalmente; ninguém consegue bloquear o inspetor 100% no navegador.
(() => {
  const isField = t => t && t.closest && t.closest("input, textarea, [contenteditable='true']");   // campos de digitar (apelido etc.) continuam normais
  const stop = e => { if (!isField(e.target)) e.preventDefault(); };

  ["contextmenu", "selectstart", "copy", "cut", "dragstart"].forEach(ev => addEventListener(ev, stop, true));
  addEventListener("contextmenu", e => e.preventDefault(), true);                                // botão direito: nunca abre (nem nos campos)

  addEventListener("keydown", e => {
    const k = (e.key || "").toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    const devtools =
      e.key === "F12" ||
      (ctrl && e.shiftKey && ["i", "j", "c", "k"].includes(k)) ||   // Ctrl+Shift+I/J/C/K
      (e.metaKey && e.altKey && ["i", "j", "c", "u"].includes(k)) || // Cmd+Option+I/J/C/U (Mac)
      (ctrl && ["u", "s"].includes(k));                              // ver código-fonte / salvar página
    const copy = ctrl && !isField(e.target) && ["c", "x", "a"].includes(k);   // copiar/recortar/selecionar tudo fora dos campos
    if (devtools || copy) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
