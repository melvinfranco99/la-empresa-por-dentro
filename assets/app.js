/* ==========================================================
   La empresa por dentro — layout común, tema, pestañas, TOC
   ========================================================== */
(function () {
  const PAGES = [
    { group: "Empezar" },
    { id: "index", href: "index.html", title: "Inicio y mapa de niveles", color: "var(--accent)" },
    { id: "fundamentos", href: "fundamentos.html", title: "Fundamentos imprescindibles", color: "var(--fg-3)" },
    { group: "Niveles de empresa" },
    { id: "nivel-0", href: "nivel-0.html", title: "N0 · Casa / autónomo", color: "var(--l0)" },
    { id: "nivel-1", href: "nivel-1.html", title: "N1 · Microempresa", color: "var(--l1)" },
    { id: "nivel-2", href: "nivel-2.html", title: "N2 · Pequeña empresa", color: "var(--l2)" },
    { id: "nivel-3", href: "nivel-3.html", title: "N3 · Mediana empresa", color: "var(--l3)" },
    { id: "mi-empresa", href: "mi-empresa.html", title: "★ Mi empresa (6 plantas)", color: "#db2777" },
    { id: "nivel-4", href: "nivel-4.html", title: "N4 · Grande multisede", color: "var(--l4)" },
    { id: "nivel-5", href: "nivel-5.html", title: "N5 · Multinacional global", color: "var(--l5)" },
    { group: "Profundizar" },
    { id: "wifi", href: "wifi.html", title: "Wi-Fi a fondo", color: "var(--d-wifi)" },
    { id: "vlan", href: "vlan.html", title: "VLANs y subredes", color: "var(--l2)" },
    { id: "gpo", href: "gpo.html", title: "Active Directory y GPO", color: "var(--l2)" },
    { id: "laboratorio", href: "laboratorio.html", title: "Laboratorio (simulador)", color: "var(--l3)" },
    { group: "Práctica" },
    { id: "problemas", href: "problemas.html", title: "Diagnóstico y problemas", color: "var(--bad)" },
    { id: "calculadoras", href: "calculadoras.html", title: "Matemáticas y calculadoras", color: "var(--warn)" },
    { id: "glosario", href: "glosario.html", title: "Glosario", color: "var(--fg-3)" },
  ];

  const pageId = document.body.dataset.page || "index";

  // ---------- Tema ----------
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem("theme");
    if (saved) root.dataset.theme = saved;
  } catch (e) {}
  function isDark() {
    if (root.dataset.theme) return root.dataset.theme === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // ---------- Topbar ----------
  const top = document.createElement("header");
  top.className = "topbar";
  top.innerHTML = `
    <button class="icon-btn" id="menu-btn" aria-label="Menú">☰</button>
    <a class="brand" href="index.html">
      <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="3" y="4" width="26" height="7" rx="2" fill="var(--l2)"/>
        <rect x="3" y="13" width="26" height="7" rx="2" fill="var(--l3)"/>
        <rect x="3" y="22" width="26" height="7" rx="2" fill="var(--l4)"/>
        <circle cx="7.5" cy="7.5" r="1.4" fill="#fff"/><circle cx="7.5" cy="16.5" r="1.4" fill="#fff"/><circle cx="7.5" cy="25.5" r="1.4" fill="#fff"/>
      </svg>
      <span>La empresa por dentro</span>
    </a>
    <span class="spacer"></span>
    <button class="icon-btn" id="theme-btn" aria-label="Cambiar tema" title="Cambiar tema claro/oscuro"></button>
  `;
  document.body.prepend(top);

  const prog = document.createElement("div");
  prog.className = "progress";
  document.body.appendChild(prog);

  const themeBtn = top.querySelector("#theme-btn");
  const paintThemeBtn = () => (themeBtn.textContent = isDark() ? "☀" : "☾");
  paintThemeBtn();
  themeBtn.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
    paintThemeBtn();
  });

  // ---------- Sidebar ----------
  const main = document.querySelector("main");
  const layout = document.createElement("div");
  layout.className = "layout";
  main.parentNode.insertBefore(layout, main);
  const side = document.createElement("nav");
  side.className = "sidebar";
  layout.appendChild(side);
  layout.appendChild(main);

  let html = "";
  PAGES.forEach((p) => {
    if (p.group) { html += `<h4>${p.group}</h4>`; return; }
    const active = p.id === pageId;
    html += `<a href="${p.href}" class="${active ? "active" : ""}"><span class="dot" style="background:${p.color}"></span>${p.title}</a>`;
    if (active) html += `<div class="toc" id="toc"></div>`;
  });
  side.innerHTML = html;

  top.querySelector("#menu-btn").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  side.addEventListener("click", (e) => { if (e.target.closest("a")) document.body.classList.remove("menu-open"); });

  // ---------- TOC con h2 ----------
  const toc = side.querySelector("#toc");
  const heads = [...document.querySelectorAll("main h2")];
  heads.forEach((h, i) => {
    if (!h.id) h.id = "s" + (i + 1) + "-" + h.textContent.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (toc) {
      const a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent;
      toc.appendChild(a);
    }
  });
  if (toc && !heads.length) toc.remove();

  const tocLinks = toc ? [...toc.querySelectorAll("a")] : [];
  function onScroll() {
    const h = document.documentElement;
    const pct = (h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)) * 100;
    prog.style.width = pct + "%";
    if (!tocLinks.length) return;
    let cur = 0;
    heads.forEach((hd, i) => { if (hd.getBoundingClientRect().top < 120) cur = i; });
    tocLinks.forEach((a, i) => a.classList.toggle("on", i === cur));
  }
  document.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---------- Paginador inferior ----------
  const flat = PAGES.filter((p) => !p.group);
  const idx = flat.findIndex((p) => p.id === pageId);
  const content = document.querySelector("main .content");
  if (content && idx >= 0) {
    const prev = flat[idx - 1], next = flat[idx + 1];
    const pager = document.createElement("div");
    pager.className = "pager";
    pager.innerHTML =
      (prev ? `<a href="${prev.href}"><span class="k">← Anterior</span>${prev.title}</a>` : "<span></span>") +
      (next ? `<a class="next" href="${next.href}"><span class="k">Siguiente →</span>${next.title}</a>` : "<span></span>");
    content.appendChild(pager);
    const foot = document.createElement("footer");
    foot.className = "site";
    foot.innerHTML = `La empresa por dentro · guía práctica de infraestructura IT por niveles · Precios orientativos (España/UE, 2026) — varían según proveedor y mercado.`;
    content.appendChild(foot);
  }

  // ---------- Pestañas ----------
  document.querySelectorAll(".tabs").forEach((tabs) => {
    const panels = [...tabs.querySelectorAll(":scope > .tab-panel")];
    const bar = document.createElement("div");
    bar.className = "tab-btns";
    panels.forEach((p, i) => {
      const b = document.createElement("button");
      b.textContent = p.dataset.tab;
      b.addEventListener("click", () => {
        panels.forEach((x) => x.classList.remove("on"));
        bar.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
        p.classList.add("on"); b.classList.add("on");
      });
      bar.appendChild(b);
      if (i === 0) { p.classList.add("on"); b.classList.add("on"); }
    });
    tabs.prepend(bar);
  });

  // ---------- Filtro de tablas (data-filter) ----------
  document.querySelectorAll("[data-filter-for]").forEach((box) => {
    const table = document.getElementById(box.dataset.filterFor);
    if (!table) return;
    const input = box.querySelector("input");
    const btns = [...box.querySelectorAll("button")];
    let tag = "all";
    function apply() {
      const q = (input ? input.value : "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      table.querySelectorAll("tbody tr").forEach((tr) => {
        const txt = tr.textContent.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const okQ = !q || txt.includes(q);
        const okT = tag === "all" || (tr.dataset.tags || "").split(" ").includes(tag);
        tr.style.display = okQ && okT ? "" : "none";
      });
    }
    if (input) input.addEventListener("input", apply);
    btns.forEach((b) => b.addEventListener("click", () => {
      btns.forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      tag = b.dataset.tag;
      apply();
    }));
  });
})();
