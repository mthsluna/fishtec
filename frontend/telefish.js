// ---------- Telefish: aperte F para o celular subir (e F ou ESC para guardar) ----------
// A imagem e o menu são HTML por cima do jogo (ver #telefish no index.html e o telefish.css).
const TELEFISH = (() => {
  const root = document.getElementById("telefish");
  let isOpen = false, timer = 0;

  function show() {
    if (!root || isOpen) return;
    isOpen = true; clearTimeout(timer);
    root.classList.add("open"); root.setAttribute("aria-hidden", "false");        // 1) o celular sobe...
    timer = setTimeout(() => root.classList.add("lit"), 480);                       // 2) ...e a tela acende e mostra as opções
  }
  function hide() {
    if (!root || !isOpen) return;
    isOpen = false; clearTimeout(timer);
    root.classList.remove("lit");                                                  // 1) a tela apaga...
    timer = setTimeout(() => { root.classList.remove("open"); root.setAttribute("aria-hidden", "true"); }, 220);   // 2) ...e ele desce
  }
  const toggle = () => isOpen ? hide() : show();

  addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === "KeyF") toggle();
    else if (e.code === "Escape") hide();
  });
  return { show, hide, toggle, get isOpen() { return isOpen; } };
})();
