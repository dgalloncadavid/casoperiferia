(function () {
  "use strict";

  // ---------- utilidades ----------
  const $ = (id) => document.getElementById(id);
  const el = (tag, clase, texto) => {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined) n.textContent = texto; // siempre textContent: nada del cliente se interpreta como HTML
    return n;
  };
  const icono = (nombre) => { const i = document.createElement("i"); i.setAttribute("data-lucide", nombre); return i; };
  // Los íconos son decorativos (siempre acompañan texto o el botón tiene aria-label): se ocultan a los lectores de pantalla.
  const iconos = () => { if (window.lucide) window.lucide.createIcons(); document.querySelectorAll("svg.lucide:not([aria-hidden])").forEach((i) => i.setAttribute("aria-hidden", "true")); };
  const anunciar = (t) => { const a = $("anuncio"); a.textContent = ""; setTimeout(() => { a.textContent = t; }, 50); };
  const almacen = (op, k, v) => { try { return op === "get" ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } };
  const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const fechaCorta = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? Number(m[3]) + " " + MESES[Number(m[2]) - 1] + " " + m[1] : "—"; };
  const fechaHora = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }); };
  const usd = (n) => "US$ " + n.toFixed(n < 0.01 ? 4 : 3).replace(".", ",");
  const miles = (n) => Math.round(n).toLocaleString("es-CO");
  const hoyLocal = () => { const d = new Date(); const dos = (x) => String(x).padStart(2, "0"); return d.getFullYear() + "-" + dos(d.getMonth() + 1) + "-" + dos(d.getDate()); };
  const FORMATOS = { xlsx: "Excel", pdf: "PDF", portal: "Portal web" };
  const PAISES = { CO: "Colombia", EC: "Ecuador", PE: "Perú", PA: "Panamá", HN: "Honduras" };
  const ESTADOS = {
    nuevo: { icono: "circle-dashed", clase: "nuevo" },
    decision: { icono: "circle-alert", clase: "decision" },
    listo: { icono: "circle-check", clase: "listo" },
    enviado: { icono: "send", clase: "enviado" },
  };
  const SEMAFORO = { verde: "circle-check", amarilla: "triangle-alert", roja: "circle-x" };
  const HERRAMIENTAS = {
    proveedor_leer_solicitud: "Leer la solicitud",
    proveedor_mapear_campos: "Mapear los campos con el maestro",
    proveedor_generar_formulario: "Generar el formulario",
    proveedor_armar_paquete: "Armar el paquete para firma",
    proveedor_simular_envio: "Envío simulado",
    processCaso: "Procesar el caso sin modelo",
  };

  // ---------- estado ----------
  const estado = {
    fecha: null, fechaDefecto: null, casos: [], seleccion: null, detalle: null, vista: "caso", sessionId: null, ocupado: false,
    auth: { habilitada: false, cliente: null, usuario: null }, soloLectura: false, sesiones: null,
    detalleAbierto: false, bandejaAbierta: false, filtroConv: null, vistaSesion: null, overlay: null, sugerido: "",
    ruta: "asistente", resumen: null, resumenEstado: "cargando", filtro: { texto: "", estado: "" }, orden: { col: "cliente", dir: "asc" },
    hoja: { abierta: false, caso: null, pestana: "campos", datos: null },
  };

  /** Cabeceras con el token de la sesión (el cliente de Supabase lo renueva solo). */
  async function cabeceras(extra) {
    const h = Object.assign({}, extra || {});
    if (estado.auth.cliente) {
      const r = await estado.auth.cliente.auth.getSession();
      if (r.data && r.data.session) h.authorization = "Bearer " + r.data.session.access_token;
    }
    return h;
  }

  async function api(ruta, opciones) {
    try {
      const op = Object.assign({}, opciones || {});
      op.headers = await cabeceras(op.headers);
      const r = await fetch(ruta, op);
      const data = await r.json().catch(() => ({}));
      if (r.status === 401 && estado.auth.habilitada) { mostrarIngreso("Tu sesión terminó. Ingresa de nuevo."); }
      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "No pude conectar con el servidor. Revisa tu conexión e inténtalo de nuevo." } };
    }
  }
  const q = () => "fecha=" + encodeURIComponent(estado.fecha);
  const post = (ruta, cuerpo) => api(ruta, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

  // ---------- layout: bandeja | chat | detalle ----------
  const mqDetalle = window.matchMedia("(max-width: 1279px)");   // el detalle pasa a drawer sobre el chat
  const mqBandeja = window.matchMedia("(max-width: 899px)");    // la bandeja también pasa a drawer
  const mqQuieto = window.matchMedia("(prefers-reduced-motion: reduce)");
  const REGIONES = ["encabezado", "panel-bandeja", "chat", "vista-casos", "panel-detalle", "hoja-caso"];
  const MS_PANEL = 180;

  function mostrarPanel(nodo) { nodo.classList.remove("saliendo"); nodo.hidden = false; }
  function ocultarPanel(nodo, despues) {
    if (nodo.hidden) { if (despues) despues(); return; }
    if (mqQuieto.matches) { nodo.hidden = true; if (despues) despues(); return; }
    nodo.classList.add("saliendo");
    setTimeout(() => { nodo.hidden = true; nodo.classList.remove("saliendo"); if (despues) despues(); }, MS_PANEL);
  }

  /** Mientras un panel hace de drawer, lo demás queda inerte y el foco no se escapa. */
  function overlayNecesario() {
    if (estado.hoja.abierta) return "hoja-caso";
    if (estado.ruta === "casos") return estado.bandejaAbierta && mqBandeja.matches ? "panel-bandeja" : null; // el detalle derecho no existe en la vista de tabla
    if (estado.detalleAbierto && mqDetalle.matches) return "panel-detalle";
    if (estado.bandejaAbierta && mqBandeja.matches) return "panel-bandeja";
    return null;
  }
  function sincronizarOverlay(focoAntes) {
    const quiere = overlayNecesario();
    const fondo = $("fondo-paneles");
    if (quiere && !estado.overlay) estado.overlay = { panel: quiere, focoAntes: focoAntes || document.activeElement };
    if (quiere) {
      estado.overlay.panel = quiere;
      fondo.hidden = false; fondo.classList.remove("saliendo");
      for (const id of REGIONES) $(id).inert = id !== quiere;
    } else if (estado.overlay) {
      for (const id of REGIONES) $(id).inert = false;
      ocultarPanel(fondo);
      const antes = estado.overlay.focoAntes;
      estado.overlay = null;
      if (antes && document.contains(antes) && !antes.closest("[hidden]")) antes.focus();
    }
  }

  function abrirDetalle(focoAntes) {
    estado.detalleAbierto = true;
    $("estructura").classList.add("con-detalle");
    mostrarPanel($("panel-detalle"));
    $("abrir-detalle").hidden = true;
    sincronizarOverlay(focoAntes);
  }
  function cerrarDetalle() {
    estado.detalleAbierto = false;
    $("estructura").classList.remove("con-detalle");
    ocultarPanel($("panel-detalle"));
    $("abrir-detalle").hidden = !estado.seleccion && estado.vista !== "reporte";
    sincronizarOverlay();
  }
  function abrirBandeja() { estado.bandejaAbierta = true; mostrarPanel($("panel-bandeja")); sincronizarOverlay(document.activeElement); const f = $("panel-bandeja").querySelector("button"); if (f) f.focus(); }
  function cerrarBandeja() {
    estado.bandejaAbierta = false;
    if (mqBandeja.matches) ocultarPanel($("panel-bandeja"));
    sincronizarOverlay();
  }
  function sincronizarLayout() {
    if (!mqBandeja.matches) { estado.bandejaAbierta = false; $("panel-bandeja").hidden = false; $("panel-bandeja").classList.remove("saliendo"); }
    else if (!estado.bandejaAbierta) $("panel-bandeja").hidden = true;
    $("abrir-bandeja").hidden = !mqBandeja.matches;
    sincronizarOverlay();
    const alto = $("encabezado").offsetHeight;
    document.documentElement.style.setProperty("--alto-enc", alto + "px");
  }
  mqDetalle.addEventListener("change", sincronizarLayout);
  mqBandeja.addEventListener("change", sincronizarLayout);
  window.addEventListener("resize", () => document.documentElement.style.setProperty("--alto-enc", $("encabezado").offsetHeight + "px"));
  function cerrarOverlayActivo() {
    const p = estado.overlay && estado.overlay.panel;
    if (p === "hoja-caso") cerrarHoja();
    else if (p === "panel-detalle") cerrarDetalle();
    else cerrarBandeja();
  }
  $("abrir-bandeja").addEventListener("click", abrirBandeja);
  $("cerrar-bandeja").addEventListener("click", cerrarBandeja);
  $("abrir-detalle").addEventListener("click", () => abrirDetalle(document.activeElement));
  $("cerrar-detalle").addEventListener("click", cerrarDetalle);
  /** El título del encabezado lleva al inicio (el asistente): cierra la tabla y los drawers; no toca la sesión, la conversación, el caso en foco ni la fecha. */
  function irAlInicio() {
    if (estado.hoja.abierta) cerrarHoja(false);
    if (estado.bandejaAbierta) cerrarBandeja();
    if (location.hash !== "#/") location.hash = "#/";
    aplicarRuta();
  }
  $("ir-inicio").addEventListener("click", (e) => { e.preventDefault(); irAlInicio(); });
  $("fondo-paneles").addEventListener("click", (e) => {
    // Con un drawer abierto el encabezado queda inerte bajo el fondo: un clic sobre el título cuenta como clic en el título.
    const r = $("ir-inicio").getBoundingClientRect();
    const sobreTitulo = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    cerrarOverlayActivo();
    if (sobreTitulo) irAlInicio();
  });
  document.addEventListener("keydown", (e) => {
    if (!estado.overlay) return;
    if (e.key === "Escape") { e.preventDefault(); cerrarOverlayActivo(); return; }
    if (e.key === "Tab") { // el foco no sale del drawer abierto
      const f = [...$(estado.overlay.panel).querySelectorAll("button:not([disabled]), a[href], input, [tabindex='0']")].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const [primero, ultimo] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
  });

  // ---------- bandeja ----------
  /** Esqueleto de carga: barras que laten en lugar del texto «Cargando». El aviso para lectores de pantalla va oculto a la vista. */
  function esqueleto(contenedor, filas, claseFila) {
    contenedor.textContent = "";
    contenedor.setAttribute("aria-busy", "true");
    const s = el("div", "skeleton");
    s.setAttribute("aria-hidden", "true");
    const anchos = ["sk-l", "sk-m", "sk-s"];
    for (let i = 0; i < filas; i++) s.appendChild(el("div", "sk " + (claseFila || "") + " " + anchos[i % 3]));
    contenedor.appendChild(s);
    contenedor.appendChild(el("span", "solo-lector", "Cargando…"));
  }

  /** Al repintar una lista se destruyen sus botones: el foco debe volver al equivalente nuevo. */
  function recordarFoco(contenedor, atributo) {
    const a = document.activeElement;
    return a && contenedor.contains(a) && a.dataset ? a.dataset[atributo] : null;
  }
  function devolverFoco(contenedor, atributo, valor) {
    if (!valor) return;
    const nuevo = [...contenedor.querySelectorAll("button")].find((b) => b.dataset[atributo] === valor);
    if (nuevo) nuevo.focus({ preventScroll: true });
  }

  const plural = (n, uno, varios) => n + " " + (n === 1 ? uno : varios);
  /** Resumen corto de una línea: «2 por confirmar · 1 soporte vencido». */
  function resumenCorto(c) {
    const partes = [];
    if (c.porConfirmar) partes.push(c.porConfirmar + " por confirmar");
    const sp = c.soportesProblema || { vencidos: 0, faltantes: 0 };
    if (sp.vencidos) partes.push(plural(sp.vencidos, "soporte vencido", "soportes vencidos"));
    if (sp.faltantes) partes.push(plural(sp.faltantes, "soporte faltante", "soportes faltantes"));
    if (!partes.length && c.procesado) partes.push("Sin pendientes");
    return partes.join(" · ");
  }
  function renderBandeja() {
    const ul = $("lista-casos");
    ul.removeAttribute("aria-busy");
    const focoCaso = recordarFoco(ul, "caso");
    ul.textContent = "";
    for (const c of estado.casos) {
      const info = ESTADOS[c.estado];
      const li = el("li");
      const b = el("button", "caso-fila borde-" + info.clase);
      b.type = "button";
      b.dataset.caso = c.caso;
      b.title = c.cliente;
      if (c.caso === estado.seleccion && estado.vista === "caso") b.setAttribute("aria-current", "true");
      const l1 = el("span", "fila-1");
      l1.appendChild(el("span", "cliente trunc", c.cliente));
      const e = el("span", "estado estado-" + info.clase);
      e.append(icono(info.icono), document.createTextNode(c.estadoTexto));
      l1.appendChild(e);
      b.appendChild(l1);
      b.appendChild(el("span", "meta trunc", [PAISES[c.pais] || c.pais, FORMATOS[c.formato] || c.formato, resumenCorto(c)].filter(Boolean).join(" · ")));
      b.addEventListener("click", () => seleccionar(c.caso, true, true, true));
      li.appendChild(b);
      ul.appendChild(li);
    }
    iconos();
    devolverFoco(ul, "caso", focoCaso);
  }
  // Flechas arriba/abajo dentro de la bandeja
  $("lista-casos").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const botones = [...document.querySelectorAll("#lista-casos button")];
    const i = botones.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    botones[(i + (e.key === "ArrowDown" ? 1 : -1) + botones.length) % botones.length].focus();
  });

  /** Bandeja y tabla salen de la misma fuente: /api/casos/resumen. */
  const cargarBandeja = () => cargarResumen(true);

  // ---------- panel del caso ----------
  function limpiarPrincipal() { const p = $("detalle-contenido"); p.textContent = ""; return p; }
  function mostrarError(texto) {
    if ($("panel-detalle").hidden) { const a = $("aviso-chat"); a.hidden = false; a.textContent = texto; a.setAttribute("role", "alert"); return; }
    const aviso = el("div", "aviso", texto);
    aviso.setAttribute("role", "alert");
    $("detalle-contenido").prepend(aviso);
  }

  /** Elegir un caso abre su detalle y deja el chat enfocado en él. No manda nada al modelo. */
  async function seleccionar(caso, mover, abrir, restaurar) {
    if (estado.ruta === "casos") navegar("#/");
    const abrirPanel = abrir !== false;
    if (estado.bandejaAbierta) cerrarBandeja();
    estado.seleccion = caso;
    estado.vista = "caso";
    if (estado.filtroConv && estado.filtroConv !== caso) estado.filtroConv = null;
    renderBandeja();
    if (abrirPanel) abrirDetalle(document.activeElement);
    if (restaurar) await restaurarConversacion(caso);
    renderConversaciones();
    await cargarCaso(mover && abrirPanel);
    enfocarChatEnCaso();
  }

  function enfocarChatEnCaso() {
    const v = estado.detalle;
    const hint = $("caso-foco");
    if (!v || estado.vista !== "caso") { hint.textContent = ""; return; }
    hint.textContent = "Caso en foco: " + v.cliente;
    // Sugerencia lista para enviar; solo se escribe si el campo está vacío y la envía la persona.
    const entrada = $("entrada");
    if (!estado.soloLectura && (entrada.value === "" || entrada.value === estado.sugerido)) {
      estado.sugerido = "Procesa el caso " + v.caso + ".";
      entrada.value = estado.sugerido;
    }
  }

  async function cargarCaso(moverFoco) {
    if (!estado.seleccion) return;
    if (!estado.detalle || estado.detalle.caso !== estado.seleccion) esqueleto($("detalle-contenido"), 7, "");
    else $("detalle-contenido").setAttribute("aria-busy", "true");
    const r = await api("/api/casos/" + encodeURIComponent(estado.seleccion) + "?" + q());
    $("detalle-contenido").removeAttribute("aria-busy");
    if (!r.ok) { limpiarPrincipal(); mostrarError(r.data.error || "No pude cargar el caso."); return; }
    estado.detalle = r.data;
    $("h-detalle").textContent = "Detalle del caso";
    renderCaso(r.data, moverFoco);
  }

  function boton(texto, nombreIcono, clase, onclick) {
    const b = el("button", "btn " + (clase || ""));
    b.type = "button";
    if (nombreIcono) b.appendChild(icono(nombreIcono));
    b.appendChild(document.createTextNode(texto));
    b.addEventListener("click", onclick);
    return b;
  }

  function renderCaso(v, moverFoco) {
    const p = limpiarPrincipal();
    const info = ESTADOS[v.estado];

    // Cabecera
    const cab = el("section", "tarjeta cabecera-caso");
    cab.setAttribute("aria-labelledby", "h-caso");
    const h = el("h2", "", v.cliente);
    h.id = "h-caso"; h.tabIndex = -1;
    cab.appendChild(h);
    cab.appendChild(el("p", "meta", [PAISES[v.pais] || v.pais, FORMATOS[v.formato] || v.formato, "Solicitud del " + fechaCorta(v.fechaSolicitud)].join(" · ")));
    const e = el("p", "estado estado-" + info.clase);
    e.append(icono(info.icono), document.createTextNode(v.estadoTexto + (v.enviado && v.enviadoIncompleto ? " (marcado como incompleto)" : "")));
    cab.appendChild(e);
    if (v.motivos.length) {
      const ul = el("ul", "lista-motivos");
      for (const m of v.motivos) ul.appendChild(el("li", "", "• " + m));
      cab.appendChild(ul);
    }
    if (v.paqueteConOtraFecha) {
      const a = el("p", "aviso", "El paquete se armó con la fecha " + fechaCorta(v.paqueteConOtraFecha) + " y esta vista usa " + fechaCorta(v.fechaReferencia) + ". Vuelve a procesar para que coincidan.");
      cab.appendChild(a);
    }
    const acc = el("div", "acciones");
    if (!v.enviado) acc.appendChild(boton(v.procesado ? "Volver a procesar" : "Procesar el caso", "refresh-cw", v.procesado ? "" : "primario", () => procesar()));
    if (v.puedeProponerEnvio) acc.appendChild(boton("Preparar el envío", "send", v.estado === "listo" ? "primario" : "", () => prepararEnvio()));
    if (acc.children.length) cab.appendChild(acc);
    p.appendChild(cab);

    // Las confirmaciones una por una viven en el chat (zona fija sobre el campo de texto).
    renderDecisiones();
    const pend = v.campos.filter((c) => c.estado === "requiere_confirmacion" && c.decision !== "confirmado");
    if (pend.length) {
      const t = el("section", "tarjeta bloque");
      t.appendChild(el("p", "", pend.length === 1 ? "Hay 1 valor por confirmar." : "Hay " + pend.length + " valores por confirmar."));
      t.appendChild(boton("Ir a la confirmación en el chat", "message-square", "", () => { const h = $("h-decision") || $("h-chat"); h.tabIndex = -1; h.focus(); }));
      p.appendChild(t);
    }

    // Soportes
    p.appendChild(seccionSoportes(v));

    // Campos
    if (v.procesado) p.appendChild(seccionCampos(v));
    else {
      const t = el("section", "tarjeta bloque");
      t.appendChild(el("h3", "", "Campos del formulario"));
      t.appendChild(el("p", "ayuda", "Todavía no se procesó este caso. Cuando lo hagas verás aquí cada campo, de dónde sale el dato y qué herramienta lo llenó."));
      p.appendChild(t);
    }

    // Archivos y costo
    p.appendChild(seccionArchivos(v));
    iconos();
    if (moverFoco) h.focus();
  }

  /** Tarjetas «valor 1 de N» y la lista de valores para revisar con el cliente, fijas en el chat. */
  function renderDecisiones() {
    const z = $("decision-chat");
    z.textContent = "";
    const v = estado.detalle;
    const campos = v && v.procesado && !estado.soloLectura ? v.campos : [];
    const porConfirmar = campos.filter((c) => c.estado === "requiere_confirmacion");
    const sinDecidir = porConfirmar.filter((c) => !c.decision);
    const paraRevisar = porConfirmar.filter((c) => c.decision === "revisar");
    if (sinDecidir.length) z.appendChild(tarjetaDecision(sinDecidir[0], porConfirmar.length - sinDecidir.length + 1, porConfirmar.length));
    if (paraRevisar.length) z.appendChild(bloqueRevisar(paraRevisar));
    z.hidden = z.children.length === 0;
    iconos();
  }

  function tarjetaDecision(c, n, total) {
    const s = el("section", "decision");
    s.setAttribute("aria-labelledby", "h-decision");
    const h = el("h3", "");
    h.id = "h-decision"; h.tabIndex = -1;
    h.append(icono("circle-alert"), document.createTextNode("Necesita tu decisión · valor " + n + " de " + total));
    s.appendChild(h);
    const dl = el("dl");
    const fila = (k, val, clase) => { dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", clase || "", val)); };
    fila("Campo", c.etiqueta);
    fila("Valor propuesto", c.valor || "—", "valor-grande");
    fila("Por qué", c.razon || c.nota || "Hay que confirmarlo antes de firmar.");
    s.appendChild(dl);
    // «Regla» plegada por defecto; al abrirla, la altura se anima (filas de grid de 0fr a 1fr).
    const idRegla = "regla-" + Math.random().toString(36).slice(2, 8);
    const toggle = el("button", "regla-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", idRegla);
    toggle.append(document.createTextNode("Regla"), icono("chevron-down"));
    const cuerpo = el("div", "regla-cuerpo");
    cuerpo.id = idRegla;
    const interior = el("div");
    interior.appendChild(el("p", "", c.regla || "Los valores con poca seguridad se confirman antes de firmar."));
    cuerpo.appendChild(interior);
    toggle.addEventListener("click", () => {
      const abierto = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!abierto));
      cuerpo.classList.toggle("abierto", !abierto);
    });
    s.append(toggle, cuerpo);
    const acc = el("div", "acciones");
    acc.appendChild(boton("Confirmar este valor", "check", "primario", () => decidir(c.etiqueta, "confirmado")));
    acc.appendChild(boton("Revisar con el cliente", "x", "", () => decidir(c.etiqueta, "revisar")));
    s.appendChild(acc);
    return s;
  }

  function bloqueRevisar(lista) {
    const s = el("section", "tarjeta bloque");
    s.appendChild(el("h3", "", "Para revisar con el cliente"));
    const ul = el("ul", "campos");
    for (const c of lista) {
      const li = el("li", "campo");
      const fila = el("div", "campo-cab");
      fila.style.cursor = "default";
      fila.appendChild(el("span", "etq", c.etiqueta + ": " + (c.valor || "—")));
      fila.appendChild(boton("Confirmar ahora", "check", "", () => decidir(c.etiqueta, "confirmado")));
      li.appendChild(fila);
      ul.appendChild(li);
    }
    s.appendChild(ul);
    return s;
  }

  function seccionSoportes(v) {
    const s = el("section", "tarjeta bloque");
    s.setAttribute("aria-labelledby", "h-soportes");
    const h = el("h3", "", "Soportes a la fecha " + fechaCorta(v.fechaReferencia));
    h.id = "h-soportes";
    s.appendChild(h);
    const ul = el("ul", "soportes");
    for (const so of v.soportes) {
      const li = el("li", "soporte soporte-" + so.alerta);
      li.appendChild(icono(SEMAFORO[so.alerta]));
      const c = el("div");
      c.appendChild(el("div", "nombre", so.nombre[0].toUpperCase() + so.nombre.slice(1)));
      const t = el("div");
      t.appendChild(el("span", "sem", so.estadoTexto));
      let det = "";
      if (so.estado === "vigente") det = so.vigenciaHasta ? " · vence el " + fechaCorta(so.vigenciaHasta) + " (quedan " + so.diasRestantes + " días)" : " · sin fecha de vencimiento";
      else if (so.estado === "vencido") det = " · venció el " + fechaCorta(so.vigenciaHasta);
      t.appendChild(document.createTextNode(det));
      c.appendChild(t);
      if (so.advertencia) c.appendChild(el("div", "meta", "Aviso: " + so.advertencia.charAt(0).toUpperCase() + so.advertencia.slice(1) + ". Se incluye igual."));
      li.appendChild(c);
      ul.appendChild(li);
    }
    s.appendChild(ul);
    return s;
  }

  const SEGURIDAD = { 1: "Coincide exactamente con la etiqueta del cliente", 0.9: "Equivalente a la etiqueta del cliente (cambian tildes o mayúsculas)", 0.7: "Se aplicó una regla de negocio: conviene confirmarlo", 0: "Sin dato" };
  const ESTADO_CAMPO = {
    lleno: { texto: "Lleno", icono: "circle-check", clase: "est-lleno" },
    requiere_confirmacion: { texto: "Por confirmar", icono: "circle-alert", clase: "est-por" },
    faltante: { texto: "Falta", icono: "circle-x", clase: "est-falta" },
  };

  function seccionCampos(v) {
    const s = el("section", "tarjeta bloque");
    s.setAttribute("aria-labelledby", "h-campos");
    const h = el("h3", "", "Campos del formulario");
    h.id = "h-campos";
    s.appendChild(h);
    const cuenta = (k) => v.campos.filter((c) => c.estado === k).length;
    s.appendChild(el("p", "ayuda", v.campos.length + " campos: " + cuenta("lleno") + " llenos, " + cuenta("requiere_confirmacion") + " por confirmar, " + cuenta("faltante") + " faltantes. Toca un campo para ver de dónde sale."));
    const lista = el("div", "campos");
    v.campos.forEach((c, i) => {
      const caja = el("div", "campo");
      const info = ESTADO_CAMPO[c.estado];
      const cab = el("button", "campo-cab");
      cab.type = "button";
      cab.setAttribute("aria-expanded", "false");
      cab.setAttribute("aria-controls", "traza-" + i);
      cab.appendChild(el("span", "etq", c.etiqueta));
      cab.appendChild(el("span", "val" + (/\b(NIT|RUC|RTN)\b/i.test(c.etiqueta) && c.valor !== null ? " mono" : ""), c.valor !== null ? c.valor : "Sin dato"));
      const est = el("span", "est " + info.clase);
      est.append(icono(info.icono), document.createTextNode(info.texto), icono("chevron-down"));
      est.lastChild.classList.add("chev");
      cab.appendChild(est);
      const traza = trazaCampo(c, i);
      traza.hidden = true;
      cab.addEventListener("click", () => {
        const abierto = cab.getAttribute("aria-expanded") === "true";
        cab.setAttribute("aria-expanded", String(!abierto));
        traza.hidden = abierto;
      });
      caja.append(cab, traza);
      lista.appendChild(caja);
    });
    s.appendChild(lista);
    return s;
  }

  function trazaCampo(c, i) {
    const t = el("div", "traza");
    t.id = "traza-" + i;
    t.setAttribute("role", "region");
    t.setAttribute("aria-label", "De dónde sale: " + c.etiqueta);
    const flujo = el("p", "trazaflujo");
    flujo.append(icono("database"), document.createTextNode("Maestro"), icono("chevron-right"), document.createTextNode(c.herramienta.nombre), icono("chevron-right"), document.createTextNode("Formulario"));
    t.appendChild(flujo);
    const dl = el("dl");
    const fila = (k, val) => { if (!val) return; dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "", val)); };
    fila("De dónde sale", c.estado === "faltante" ? "No existe en el maestro de Periferia. Hay que conseguirlo y completarlo a mano." : c.origen);
    fila("Quién lo llenó", c.herramienta.nombre + (c.herramienta.cuando ? ", el " + fechaHora(c.herramienta.cuando) : ""));
    fila("Dónde quedó", c.destino);
    fila("Qué tan seguro es", SEGURIDAD[c.confianza] || "Regla aplicada");
    if (c.enmascarado) fila("Número completo", "Solo aparece en el formulario, no en pantalla.");
    fila("Por qué hay que confirmarlo", c.razon);
    fila("Regla", c.regla);
    if (c.decision) fila("Tu decisión", c.decision === "confirmado" ? "Lo confirmaste." : "Lo dejaste para revisar con el cliente.");
    t.appendChild(dl);
    const det = el("details");
    det.appendChild(el("summary", "", "Detalle técnico"));
    det.appendChild(el("p", "tecnico", "Herramienta: " + c.herramienta.tecnico + " · coincidencia: " + c.confianza));
    t.appendChild(det);
    return t;
  }

  const ARCHIVOS = {
    "formulario.xlsx": "Formulario en Excel", "formulario.pdf": "Formulario en PDF", "valores-portal.md": "Valores para copiar al portal",
    "ENVIO-SIMULADO.md": "Constancia del envío simulado", "paquete/checklist.md": "Checklist del paquete", "paquete/borrador-correo.md": "Borrador de correo",
    "paquete/formulario.xlsx": "Formulario (copia en el paquete)", "paquete/formulario.pdf": "Formulario (copia en el paquete)", "paquete/valores-portal.md": "Valores (copia en el paquete)",
  };

  function seccionArchivos(v) {
    const s = el("section", "tarjeta bloque");
    s.setAttribute("aria-labelledby", "h-archivos");
    const h = el("h3", "", "Archivos y costo");
    h.id = "h-archivos";
    s.appendChild(h);
    if (v.archivos.length) {
      const caja = el("div", "archivos");
      for (const a of v.archivos) {
        const ruta = "/api/paquetes/" + encodeURIComponent(v.caso) + "/" + a.split("/").map(encodeURIComponent).join("/");
        const nombre = ARCHIVOS[a] || (a.startsWith("paquete/soportes/") ? "Soporte: " + a.slice("paquete/soportes/".length) : a);
        // Con login, un enlace normal no lleva el token: se descarga con fetch y se entrega como archivo.
        const b = el("button", "enlace");
        b.type = "button";
        b.append(icono("download"), document.createTextNode(nombre));
        b.addEventListener("click", () => descargar(ruta, a.split("/").pop()));
        caja.appendChild(b);
      }
      s.appendChild(caja);
    } else s.appendChild(el("p", "ayuda", "Todavía no hay archivos: se generan al procesar el caso."));
    const costo = el("p", "ayuda");
    costo.style.marginTop = "12px";
    costo.textContent = v.consumo ? "Consumo del modelo en este caso: " + miles(v.consumo.tokensEntrada + v.consumo.tokensSalida) + " tokens, unos " + usd(v.consumo.costoUsd) + " (estimado)." : "Sin consumo del modelo en este caso.";
    s.appendChild(costo);
    return s;
  }

  // ---------- acciones del panel ----------
  async function procesar() {
    const caso = estado.seleccion;
    anunciar("Procesando el caso…");
    const r = await post("/api/casos/" + encodeURIComponent(caso) + "/procesar", { fecha: estado.fecha });
    if (!r.ok) return mostrarError(r.data.error || "No pude procesar el caso.");
    anunciar("Caso procesado.");
    estado.detalle = r.data.caso;
    renderCaso(r.data.caso, true);
    refrescarListas();
  }

  async function decidir(campo, decision) {
    const r = await post("/api/casos/" + encodeURIComponent(estado.seleccion) + "/decisiones", { campo: campo, decision: decision, fecha: estado.fecha });
    if (!r.ok) return mostrarError(r.data.error || "No pude guardar tu decisión.");
    anunciar(decision === "confirmado" ? "Valor confirmado." : "Valor marcado para revisar con el cliente.");
    estado.detalle = r.data.caso;
    renderCaso(r.data.caso, false);   // también vuelve a pintar las tarjetas del chat
    const foco = $("h-decision") || $("h-chat");
    foco.tabIndex = -1; foco.focus();
    refrescarListas();
  }

  async function prepararEnvio() {
    const r = await post("/api/casos/" + encodeURIComponent(estado.seleccion) + "/proponer-envio", { sessionId: estado.sessionId, fecha: estado.fecha });
    if (!r.ok) return mostrarError(r.data.error || "No pude preparar el envío.");
    pintarMensaje({ rol: "user", texto: "Preparar el envío de este caso" }, false);
    pintarMensaje({ rol: "assistant", texto: r.data.reply, toolCalls: [], needsConfirmation: true }, true);
    anunciar("Te pedí la confirmación del envío en la conversación.");
    if (estado.overlay && estado.overlay.panel === "panel-detalle") cerrarDetalle(); // en pantallas angostas el detalle tapa el chat
    refrescarListas();
  }

  async function descargar(ruta, nombre) {
    try {
      const r = await fetch(ruta, { headers: await cabeceras() });
      if (r.status === 401 && estado.auth.habilitada) return mostrarIngreso("Tu sesión terminó. Ingresa de nuevo.");
      if (!r.ok) return mostrarError("No pude descargar el archivo.");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { mostrarError("No pude descargar el archivo."); }
  }

  // ---------- reporte ----------
  async function verReporte() {
    if (estado.ruta === "casos") navegar("#/");
    estado.vista = "reporte";
    renderBandeja();
    abrirDetalle(document.activeElement);
    $("h-detalle").textContent = "Reporte";
    const r = await api("/api/reporte?" + q());
    const p = limpiarPrincipal();
    if (!r.ok) return mostrarError(r.data.error || "No pude cargar el reporte.");
    const d = r.data;
    const cab = el("section", "tarjeta cabecera-caso");
    const h = el("h2", "", "Reporte entre todos los casos");
    h.id = "h-reporte"; h.tabIndex = -1;
    cab.appendChild(h);
    cab.appendChild(el("p", "meta", "Soportes evaluados al " + fechaCorta(d.fechaReferencia) + "."));
    p.appendChild(cab);

    const falt = el("section", "tarjeta bloque");
    falt.appendChild(el("h3", "", "Lo que falta, por campo"));
    if (d.faltantesPorCampo.length === 0) falt.appendChild(el("p", "ayuda", "No falta ningún dato en los casos actuales."));
    else {
      const tabla = el("table");
      tabla.appendChild(el("caption", "solo-lector", "Campos que faltan en el maestro y casos afectados"));
      const thead = el("thead"); const trh = el("tr");
      for (const t of ["Campo que falta", "Casos donde lo piden"]) { const th = el("th", "", t); th.scope = "col"; trh.appendChild(th); }
      thead.appendChild(trh); tabla.appendChild(thead);
      const tb = el("tbody");
      for (const f of d.faltantesPorCampo) { const tr = el("tr"); tr.appendChild(el("td", "", f.campo)); tr.appendChild(el("td", "", f.casos.map((c) => c.cliente).join(", "))); tb.appendChild(tr); }
      tabla.appendChild(tb);
      const w = el("div", "tabla-scroll"); w.tabIndex = 0; w.setAttribute("role", "region"); w.setAttribute("aria-label", "Campos que faltan, con desplazamiento"); w.appendChild(tabla); falt.appendChild(w);
      falt.appendChild(el("p", "ayuda", "Estos datos no existen en el maestro de Periferia. No bloquean la firma, pero hay que conseguirlos."));
    }
    p.appendChild(falt);

    const por = el("section", "tarjeta bloque");
    por.appendChild(el("h3", "", "Por caso: pendientes y costo"));
    const t2 = el("table");
    t2.appendChild(el("caption", "solo-lector", "Estado, pendientes y costo por caso"));
    const th2 = el("thead"); const r2 = el("tr");
    for (const t of ["Caso", "Estado", "Falta", "Por confirmar", "Soportes a actualizar", "Costo del modelo (estimado)"]) { const th = el("th", "", t); th.scope = "col"; r2.appendChild(th); }
    th2.appendChild(r2); t2.appendChild(th2);
    const tb2 = el("tbody");
    for (const c of d.casos) {
      const tr = el("tr");
      const celda = (txt, clase) => tr.appendChild(el("td", clase || "", txt));
      const tc = el("td"); const bt = el("button", "enlace"); bt.type = "button"; bt.textContent = c.cliente; bt.addEventListener("click", () => seleccionar(c.caso, true, true, true)); tc.appendChild(bt); tr.appendChild(tc);
      celda(c.estadoTexto);
      celda(c.faltantes.join(", ") || "—");
      celda(c.porConfirmar.join(", ") || "—");
      celda(c.soportesAActualizar.join(", ") || "—");
      celda(c.consumo ? usd(c.consumo.costoUsd) + " · " + miles(c.consumo.tokensEntrada + c.consumo.tokensSalida) + " tokens" : "Sin modelo", c.consumo ? "mono" : "");
      tb2.appendChild(tr);
    }
    t2.appendChild(tb2);
    const w2 = el("div", "tabla-scroll"); w2.tabIndex = 0; w2.setAttribute("role", "region"); w2.setAttribute("aria-label", "Pendientes y costo por caso, con desplazamiento"); w2.appendChild(t2); por.appendChild(w2);
    por.appendChild(el("p", "ayuda", "Total del modelo: " + usd(d.totalCostoUsd) + " y " + miles(d.totalTokens) + " tokens. Son estimaciones con la tabla de precios configurada; solo cuentan las conversaciones con el modelo (procesar desde el panel no cuesta)."));
    p.appendChild(por);
    iconos();
    h.focus();
  }

  // ---------- chat ----------
  function pintarHerramientas(contenedor, llamadas) {
    for (const l of llamadas || []) {
      const d = el("details", "herr" + (l.ok ? "" : " fallo"));
      const s = el("summary");
      s.appendChild(icono(l.ok ? "wrench" : "triangle-alert"));
      s.appendChild(el("span", "", (HERRAMIENTAS[l.nombre] || l.nombre) + " — " + l.resumen));
      d.appendChild(s);
      d.appendChild(el("div", "detalle tecnico", "Herramienta: " + l.nombre + " · argumentos: " + JSON.stringify(l.args)));
      contenedor.appendChild(d);
    }
  }

  function pintarMensaje(m, esUltimo) {
    const caja = el("div", "msg " + (m.rol === "user" ? "user" : "asistente") + (m.error ? " error" : "") + (m.needsConfirmation ? " confirmacion" : ""));
    if (m.rol === "user") caja.appendChild(document.createTextNode(m.texto)); else textoConCampos(caja, m.texto);
    if (m.rol !== "user") pintarHerramientas(caja, m.toolCalls);
    if (m.needsConfirmation && esUltimo && !estado.soloLectura) {
      const acc = el("div", "acciones");
      acc.appendChild(boton("Confirmar envío", "check", "primario", () => enviar("", true)));
      acc.appendChild(boton("Cancelar", "x", "", () => enviar("Cancelar", false)));
      caja.appendChild(acc);
    }
    const lista = $("mensajes");
    lista.appendChild(caja);
    iconos();
    lista.scrollTop = lista.scrollHeight;
    return caja;
  }

  /** Si el asistente trabajó sobre un caso distinto al que está en foco, el chat pasa a ese caso (sin abrir el detalle). */
  async function seguirAlAsistente(llamadas) {
    const caso = (llamadas || []).map((l) => l.args && l.args.caso).filter(Boolean).pop();
    if (!caso) return;
    if (caso !== estado.seleccion) await seleccionar(caso, false, false);
    else await cargarCaso(false);
  }

  /** Texto con los nombres de caso (p. ej. ec-corp-andina) en monoespaciada. */
  function agregarTexto(caja, texto) {
    const re = /\b[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)+\b/g;
    let ultimo = 0, m;
    while ((m = re.exec(texto)) !== null) {
      if (m.index > ultimo) caja.appendChild(document.createTextNode(texto.slice(ultimo, m.index)));
      caja.appendChild(el("code", "mono", m[0]));
      ultimo = m.index + m[0].length;
    }
    if (ultimo < texto.length) caja.appendChild(document.createTextNode(texto.slice(ultimo)));
  }

  /** Los campos del caso en foco que se nombran en un mensaje del asistente se vuelven botones que abren su trazabilidad. */
  function textoConCampos(caja, texto) {
    const v = estado.detalle;
    const etiquetas = v && v.campos ? [...new Set(v.campos.map((c) => c.etiqueta).filter((e) => e.length >= 3))].sort((a, b) => b.length - a.length) : [];
    if (!etiquetas.length) { agregarTexto(caja, texto); return; }
    const escapar = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(?<![\\p{L}\\p{N}])(" + etiquetas.map(escapar).join("|") + ")(?![\\p{L}\\p{N}])", "u");
    const usadas = new Set();
    let resto = texto;
    while (resto) {
      const m = re.exec(resto);
      if (!m || usadas.has(m[1])) { // una sola mención enlazada por campo y mensaje
        if (m && usadas.has(m[1])) { agregarTexto(caja, resto.slice(0, m.index + m[1].length)); resto = resto.slice(m.index + m[1].length); continue; }
        agregarTexto(caja, resto); break;
      }
      usadas.add(m[1]);
      agregarTexto(caja, resto.slice(0, m.index));
      const b = el("button", "enlace-campo", m[1]);
      b.type = "button";
      b.title = "Ver de dónde sale este campo";
      b.addEventListener("click", () => irACampo(m[1], b));
      caja.appendChild(b);
      resto = resto.slice(m.index + m[1].length);
    }
  }

  function irACampo(etiqueta, origen) {
    abrirDetalle(origen);
    const doIt = () => {
      const botones = [...document.querySelectorAll("#detalle-contenido .campo-cab")];
      const b = botones.find((x) => x.querySelector(".etq") && x.querySelector(".etq").textContent === etiqueta);
      if (!b) return;
      if (b.getAttribute("aria-expanded") !== "true") b.click();
      b.scrollIntoView({ block: "center" });
      b.focus();
    };
    setTimeout(doIt, 60);
  }

  function mostrarAviso(t) { const a = $("aviso-chat"); a.hidden = !t; a.textContent = t || ""; }

  async function enviar(texto, confirmar) {
    if (estado.ocupado) return;
    texto = (texto || "").trim();
    if (!texto && !confirmar) return;
    estado.ocupado = true;
    $("enviar").disabled = true; $("pensando").hidden = false;
    document.querySelectorAll("#mensajes .acciones button").forEach((b) => { b.disabled = true; });
    const burbuja = pintarMensaje({ rol: "user", texto: confirmar ? "Confirmar envío" : texto }, false);
    $("entrada").value = "";
    const r = await post("/api/chat", { sessionId: estado.sessionId, message: texto, confirm: confirmar, fecha: estado.fecha });
    if (r.status === 401 && estado.auth.habilitada) {
      // La sesión venció: se vuelve al ingreso, pero la conversación y lo que escribías se conservan.
      burbuja.remove();
      if (!confirmar) $("entrada").value = texto;
    } else if (!r.ok) pintarMensaje({ rol: "assistant", texto: r.data.error || "No se pudo completar la solicitud.", error: true }, false);
    else {
      estado.sessionId = r.data.sessionId; almacen("set", claveSesion(), estado.sessionId);
      mostrarAviso(r.data.aviso || "");
      await seguirAlAsistente(r.data.toolCalls);   // primero el caso, para que los campos nombrados ya sean enlaces
      pintarMensaje({ rol: "assistant", texto: r.data.reply, toolCalls: r.data.toolCalls, needsConfirmation: r.data.needsConfirmation }, true);
      anunciar("El asistente respondió.");
      await refrescar();
    }
    estado.ocupado = false; $("enviar").disabled = false; $("pensando").hidden = true; $("entrada").focus();
  }

  function modoLectura(si, fecha) {
    estado.soloLectura = si;
    $("entrada").disabled = si; $("enviar").disabled = si;
    renderDecisiones();
    $("entrada").placeholder = si ? "Esta conversación ya terminó (solo lectura)." : "Ej.: Procesa el caso ec-corp-andina. No envíes nada todavía.";
    const b = $("banner-lectura");
    if (b) b.remove();
    if (si) {
      const caja = el("div", "aviso banner-lectura");
      caja.id = "banner-lectura";
      caja.appendChild(document.createTextNode("Estás viendo una conversación terminada" + (fecha ? " (" + fecha + ")" : "") + ", solo lectura. "));
      caja.appendChild(boton("Empezar una conversación nueva", "rotate-ccw", "", () => conversacionNueva()));
      $("chat").insertBefore(caja, $("mensajes"));
      iconos();
    }
  }

  async function iniciarChat() {
    $("mensajes").textContent = "";
    modoLectura(false);
    const r = await api("/api/sessions/" + encodeURIComponent(estado.sessionId));
    if (r.ok) { r.data.historial.forEach((m, i) => pintarMensaje(m, i === r.data.historial.length - 1 && Boolean(r.data.pendiente))); return; }
    pintarMensaje({ rol: "assistant", texto: "Hola. Elige un caso en la bandeja o dime cuál procesar (por ejemplo «ec-corp-andina»). Te cuento qué quedó lleno, qué falta y si el paquete está listo para firma. No envío nada sin tu confirmación." }, false);
  }

  // ---------- ruta por hash: #/ (asistente) y #/casos (tabla) ----------
  const rutaDeHash = () => (/^#\/casos(\/|$)/.test(location.hash) ? "casos" : "asistente");

  function aplicarRuta(inicial) {
    const r = rutaDeHash();
    if (r === estado.ruta && !inicial) return;
    estado.ruta = r;
    const enCasos = r === "casos";
    $("estructura").classList.toggle("en-casos", enCasos);
    $("chat").hidden = enCasos;
    $("vista-casos").hidden = !enCasos;
    if (enCasos) $("ver-todos").setAttribute("aria-current", "page"); else $("ver-todos").removeAttribute("aria-current");
    $("saltar").setAttribute("href", enCasos ? "#h-casos-todos" : "#chat");
    $("saltar").textContent = enCasos ? "Saltar a la tabla" : "Saltar al chat";
    if (!enCasos && estado.hoja.abierta) cerrarHoja(false);
    sincronizarOverlay();
    if (enCasos) {
      if (estado.bandejaAbierta) cerrarBandeja();
      cargarResumen();
      if (!inicial) { const h = $("h-casos-todos"); h.focus(); anunciar("Todos los casos"); }
    } else if (!inicial) anunciar("Asistente");
  }
  /** Cambia de vista (el botón atrás del navegador también funciona porque usa el hash). */
  function navegar(objetivo) {
    if (location.hash !== objetivo) location.hash = objetivo;
    aplicarRuta();
  }
  window.addEventListener("hashchange", () => aplicarRuta());
  // Si ya estás en la tabla, el enlace no cambia el hash: igual cierra el lateral (drawer) para mostrarla.
  $("ver-todos").addEventListener("click", () => { if (estado.bandejaAbierta) cerrarBandeja(); });

  // ---------- Todos los casos: tabla ----------
  const ORDEN_ESTADO = { nuevo: 0, decision: 1, listo: 2, enviado: 3 };
  const COLUMNAS = [
    { col: "cliente", titulo: "Cliente" }, { col: "pais", titulo: "País" }, { col: "canal", titulo: "Canal" }, { col: "estado", titulo: "Estado" },
    { col: "camposLlenos", titulo: "Campos llenos" }, { col: "porConfirmar", titulo: "Por confirmar" }, { col: "soportes", titulo: "Soportes vencidos o faltantes" }, { col: "ultima", titulo: "Última actualización" },
  ];
  const valorOrden = (f, col) => {
    switch (col) {
      case "cliente": return f.cliente.toLocaleLowerCase("es");
      case "pais": return (PAISES[f.pais] || f.pais).toLocaleLowerCase("es");
      case "canal": return (FORMATOS[f.formato] || f.formato).toLocaleLowerCase("es");
      case "estado": return ORDEN_ESTADO[f.estado];
      case "camposLlenos": return f.camposLlenos;
      case "porConfirmar": return f.porConfirmar;
      case "soportes": return f.soportesProblema.total;
      case "ultima": return f.ultimaActividad ? Date.parse(f.ultimaActividad) : null;
      default: return null;
    }
  };
  function filasVisibles() {
    const q = estado.filtro.texto.trim().toLocaleLowerCase("es");
    let filas = (estado.resumen || []).filter((f) => (!q || f.cliente.toLocaleLowerCase("es").includes(q)) && (!estado.filtro.estado || f.estado === estado.filtro.estado));
    const { col, dir } = estado.orden, signo = dir === "asc" ? 1 : -1;
    filas = filas.slice().sort((a, b) => {
      const x = valorOrden(a, col), y = valorOrden(b, col);
      if (x === null && y === null) return a.cliente.localeCompare(b.cliente, "es");
      if (x === null) return 1;            // sin dato: siempre al final
      if (y === null) return -1;
      const c = typeof x === "string" ? x.localeCompare(y, "es") : x - y;
      return c !== 0 ? signo * c : a.cliente.localeCompare(b.cliente, "es");
    });
    return filas;
  }

  async function cargarResumen(silencioso) {
    const cuerpo = $("casos-cuerpo");
    if (!silencioso || !estado.resumen) { estado.resumenEstado = "cargando"; renderTabla(); }
    const r = await api("/api/casos/resumen?" + q());
    if (!r.ok) {
      $("lista-casos").removeAttribute("aria-busy");
      if (!silencioso || !estado.resumen) { estado.resumenEstado = "error"; renderTabla(); }
      else { estado.resumenEstado = "ok"; renderTabla(); }
      if (!estado.resumen) mostrarError(r.data.error || "No pude cargar la bandeja.");
      return;
    }
    estado.resumen = r.data.casos;
    estado.casos = estado.resumen;
    estado.resumenEstado = "ok";
    renderBandeja();
    renderTabla();
    renderConversaciones();
    cuerpo.removeAttribute("aria-busy");
  }

  function estadoPunto(f) {
    const e = el("span", "estado estado-" + ESTADOS[f.estado].clase);
    e.appendChild(document.createTextNode(f.estadoTexto));
    return e;
  }
  const txtSoportes = (f) => (f.soportesProblema.total === 0 ? "0" : String(f.soportesProblema.total));
  const txtLlenos = (f) => (f.camposLlenos === null ? "—" : f.camposLlenos + "/" + f.camposTotal);

  function renderTabla() {
    const cuerpo = $("casos-cuerpo");
    cuerpo.textContent = "";
    if (estado.resumenEstado === "cargando") {
      cuerpo.setAttribute("aria-busy", "true");
      const caja = el("div", "tabla-wrap"); caja.style.padding = "16px";
      esqueleto(caja, 6, "sk-fila");
      cuerpo.appendChild(caja);
      return;
    }
    cuerpo.removeAttribute("aria-busy");
    if (estado.resumenEstado === "error") {
      const e = el("div", "estado-vacio-vista estado-error");
      e.setAttribute("role", "alert");
      e.appendChild(icono("triangle-alert"));
      e.appendChild(el("p", "", "No pude cargar los casos."));
      e.appendChild(boton("Reintentar", "refresh-cw", "", () => cargarResumen()));
      cuerpo.appendChild(e);
      iconos();
      return;
    }
    const filas = filasVisibles();
    if (filas.length === 0) {
      const sinCasos = !estado.resumen || estado.resumen.length === 0;
      const e = el("div", "estado-vacio-vista");
      e.appendChild(icono(sinCasos ? "inbox" : "search-x"));
      e.appendChild(el("p", "", sinCasos ? "Todavía no hay casos." : "Ningún caso coincide con tu búsqueda."));
      cuerpo.appendChild(e);
      iconos();
      anunciar(sinCasos ? "No hay casos." : "Ningún caso coincide.");
      return;
    }
    cuerpo.appendChild(tablaCasos(filas));
    cuerpo.appendChild(listaMovil(filas));
    iconos();
  }

  function tablaCasos(filas) {
    const wrap = el("div", "tabla-wrap");
    const t = el("table", "tabla-casos");
    t.appendChild(el("caption", "solo-lector", "Todos los casos: " + filas.length + (filas.length === 1 ? " caso" : " casos") + ". Cada encabezado ordena la tabla."));
    const th = el("thead"), tr = el("tr");
    for (const c of COLUMNAS) {
      const cel = el("th");
      cel.scope = "col";
      const activa = estado.orden.col === c.col;
      if (activa) cel.setAttribute("aria-sort", estado.orden.dir === "asc" ? "ascending" : "descending");
      const b = el("button", "th-orden");
      b.type = "button";
      b.appendChild(document.createTextNode(c.titulo));
      if (activa) b.appendChild(icono(estado.orden.dir === "asc" ? "arrow-up" : "arrow-down"));
      b.addEventListener("click", () => ordenarPor(c.col, c.titulo));
      cel.appendChild(b); tr.appendChild(cel);
    }
    th.appendChild(tr); t.appendChild(th);
    const tb = el("tbody");
    for (const f of filas) {
      const fila = el("tr");
      fila.dataset.caso = f.caso;
      const c1 = el("td"); const bt = el("button", "fila-cliente"); bt.type = "button"; bt.textContent = f.cliente;
      bt.addEventListener("click", (e) => { e.stopPropagation(); abrirHoja(f.caso, bt); });
      c1.appendChild(bt); fila.appendChild(c1);
      fila.appendChild(el("td", "", PAISES[f.pais] || f.pais));
      fila.appendChild(el("td", "", FORMATOS[f.formato] || f.formato));
      const ce = el("td"); ce.appendChild(estadoPunto(f)); fila.appendChild(ce);
      fila.appendChild(el("td", "num", txtLlenos(f)));
      fila.appendChild(el("td", "num", f.porConfirmar === null ? "—" : String(f.porConfirmar)));
      const cs = el("td"); cs.appendChild(el("span", "num", txtSoportes(f)));
      if (f.soportesProblema.total) cs.appendChild(el("span", "sub-meta", f.soportesProblema.nombres.join(", ")));
      fila.appendChild(cs);
      fila.appendChild(el("td", "", f.fechaColombia || "—"));
      fila.addEventListener("click", () => abrirHoja(f.caso, bt));
      tb.appendChild(fila);
    }
    t.appendChild(tb); wrap.appendChild(t);
    return wrap;
  }

  /** En pantallas angostas la tabla pasa a filas apiladas. */
  function listaMovil(filas) {
    const ul = el("ul", "casos-lista-movil");
    ul.setAttribute("aria-label", "Casos");
    for (const f of filas) {
      const li = el("li"), b = el("button", "fila-movil");
      b.type = "button";
      b.dataset.caso = f.caso;
      b.appendChild(el("span", "fila-cliente", f.cliente));
      b.appendChild(estadoPunto(f));
      b.appendChild(el("span", "meta", [PAISES[f.pais] || f.pais, FORMATOS[f.formato] || f.formato].join(" · ")));
      b.appendChild(el("span", "", "Campos llenos: " + txtLlenos(f) + " · Por confirmar: " + (f.porConfirmar === null ? "—" : f.porConfirmar)));
      b.appendChild(el("span", "", "Soportes vencidos o faltantes: " + txtSoportes(f) + (f.soportesProblema.total ? " (" + f.soportesProblema.nombres.join(", ") + ")" : "")));
      b.appendChild(el("span", "meta", "Actualizado: " + (f.fechaColombia || "—")));
      b.addEventListener("click", () => abrirHoja(f.caso, b));
      li.appendChild(b); ul.appendChild(li);
    }
    return ul;
  }

  function ordenarPor(col, titulo) {
    const mismo = estado.orden.col === col;
    estado.orden = { col: col, dir: mismo && estado.orden.dir === "asc" ? "desc" : "asc" };
    sincronizarOrdenMovil();
    renderTabla();
    anunciar("Ordenado por " + titulo + (estado.orden.dir === "asc" ? ", de menor a mayor." : ", de mayor a menor."));
    // el foco vuelve al encabezado que se pulsó (la tabla se vuelve a pintar)
    const nuevo = document.querySelector('#casos-cuerpo th[aria-sort] .th-orden');
    if (nuevo) nuevo.focus();
  }
  function sincronizarOrdenMovil() {
    const v = estado.orden.col + ":" + estado.orden.dir, sel = $("orden-movil");
    sel.value = [...sel.options].some((o) => o.value === v) ? v : sel.value;
  }
  $("buscar-caso").addEventListener("input", (e) => { estado.filtro.texto = e.target.value; if (estado.resumenEstado === "ok") renderTabla(); });
  $("filtro-estado").addEventListener("change", (e) => { estado.filtro.estado = e.target.value; if (estado.resumenEstado === "ok") renderTabla(); });
  $("orden-movil").addEventListener("change", (e) => { const [col, dir] = e.target.value.split(":"); estado.orden = { col: col, dir: dir }; renderTabla(); });

  // ---------- hoja del caso: pestañas Campos, Soportes y Decisiones ----------
  const PESTANAS = ["campos", "soportes", "decisiones"];
  function activarPestana(nombre, foco) {
    estado.hoja.pestana = nombre;
    for (const p of PESTANAS) {
      const activa = p === nombre;
      $("pest-" + p).setAttribute("aria-selected", String(activa));
      $("pest-" + p).tabIndex = activa ? 0 : -1;
      $("panel-" + p).hidden = !activa;
    }
    if (foco) $("pest-" + nombre).focus();
  }
  PESTANAS.forEach((p, i) => {
    $("pest-" + p).addEventListener("click", () => activarPestana(p, false));
    $("pest-" + p).addEventListener("keydown", (e) => {
      const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? "ini" : e.key === "End" ? "fin" : 0;
      if (!paso) return;
      e.preventDefault();
      const j = paso === "ini" ? 0 : paso === "fin" ? PESTANAS.length - 1 : (i + paso + PESTANAS.length) % PESTANAS.length;
      activarPestana(PESTANAS[j], true);
    });
  });

  async function abrirHoja(caso, origen) {
    estado.hoja = { abierta: true, caso: caso, pestana: "campos", datos: null };
    $("h-hoja").textContent = "Cargando…";
    $("hoja-meta").textContent = ""; $("hoja-estado").hidden = true;
    $("abrir-en-asistente").disabled = true;
    activarPestana("campos", false);
    for (const p of PESTANAS) esqueleto($("panel-" + p), 5, "");
    mostrarPanel($("hoja-caso"));
    sincronizarOverlay(origen);
    $("cerrar-hoja").focus();
    await cargarHoja();
  }

  async function cargarHoja() {
    const caso = estado.hoja.caso;
    const r = await api("/api/casos/" + encodeURIComponent(caso) + "?" + q());
    if (!estado.hoja.abierta || estado.hoja.caso !== caso) return;
    if (!r.ok) {
      $("h-hoja").textContent = "No pude cargar el caso";
      for (const p of PESTANAS) {
        const c = $("panel-" + p); c.textContent = ""; c.removeAttribute("aria-busy");
        const e = el("div", "estado-vacio-vista estado-error"); e.setAttribute("role", "alert");
        e.appendChild(icono("triangle-alert")); e.appendChild(el("p", "", r.data.error || "No pude cargar el caso."));
        e.appendChild(boton("Reintentar", "refresh-cw", "", () => { for (const q2 of PESTANAS) esqueleto($("panel-" + q2), 5, ""); cargarHoja(); }));
        c.appendChild(e);
      }
      iconos();
      return;
    }
    estado.hoja.datos = r.data;
    renderHoja(r.data);
  }

  function renderHoja(v) {
    const info = ESTADOS[v.estado];
    $("h-hoja").textContent = v.cliente;
    $("hoja-meta").textContent = [PAISES[v.pais] || v.pais, FORMATOS[v.formato] || v.formato, "Solicitud del " + fechaCorta(v.fechaSolicitud)].join(" · ");
    const e = $("hoja-estado");
    e.className = "estado estado-" + info.clase;
    e.textContent = v.estadoTexto + (v.enviado && v.enviadoIncompleto ? " (marcado como incompleto)" : "");
    e.hidden = false;
    $("abrir-en-asistente").disabled = false;

    // Campos
    const pc = $("panel-campos"); pc.textContent = ""; pc.removeAttribute("aria-busy");
    if (!v.procesado) pc.appendChild(vacioHoja("file-text", "Este caso todavía no se procesó. Ábrelo en el asistente para llenarlo."));
    else {
      const t = tablaSimple(["Campo", "Valor", "Origen", "Estado"], "Campos del caso, con su valor, de dónde sale y su estado");
      for (const c of v.campos) {
        const tr = el("tr");
        tr.appendChild(el("td", "", c.etiqueta));
        tr.appendChild(el("td", "val" + (/\b(NIT|RUC|RTN)\b/i.test(c.etiqueta) && c.valor !== null ? " mono" : ""), c.valor !== null ? c.valor : "Sin dato"));
        tr.appendChild(el("td", "val", c.estado === "faltante" ? "No existe en el maestro" : c.origen));
        const ce = el("td"), info2 = ESTADO_CAMPO[c.estado], sp = el("span", "est " + info2.clase);
        sp.append(icono(info2.icono), document.createTextNode(info2.texto)); ce.appendChild(sp); tr.appendChild(ce);
        t.tBodies[0].appendChild(tr);
      }
      pc.appendChild(envolver(t));
    }

    // Soportes
    const ps = $("panel-soportes"); ps.textContent = ""; ps.removeAttribute("aria-busy");
    const ts = tablaSimple(["Soporte", "Vigencia", "Vence", "Nota"], "Soportes exigidos y su vigencia a la fecha de referencia");
    for (const so of v.soportes) {
      const tr = el("tr");
      tr.appendChild(el("td", "", so.nombre[0].toUpperCase() + so.nombre.slice(1)));
      const cv = el("td"), sp = el("span", "est soporte-" + so.alerta);
      sp.append(icono(SEMAFORO[so.alerta]), document.createTextNode(so.estadoTexto)); cv.appendChild(sp); tr.appendChild(cv);
      let vence = "—";
      if (so.estado === "vigente" && so.vigenciaHasta) vence = fechaCorta(so.vigenciaHasta) + " (quedan " + so.diasRestantes + " días)";
      else if (so.estado === "vencido") vence = "Venció el " + fechaCorta(so.vigenciaHasta);
      else if (so.estado === "vigente") vence = "Sin vencimiento";
      tr.appendChild(el("td", "", vence));
      tr.appendChild(el("td", "val", so.advertencia ? so.advertencia.charAt(0).toUpperCase() + so.advertencia.slice(1) : "—"));
      ts.tBodies[0].appendChild(tr);
    }
    ps.appendChild(envolver(ts));

    // Decisiones
    const pd = $("panel-decisiones"); pd.textContent = ""; pd.removeAttribute("aria-busy");
    if (v.decisiones.length === 0) pd.appendChild(vacioHoja("circle-check", "Todavía no has confirmado ni mandado a revisar ningún valor en este caso."));
    else {
      const ul = el("ul", "dec-lista");
      for (const d of v.decisiones) {
        const li = el("li", "dec-fila");
        li.appendChild(el("strong", "", d.etiqueta));
        if (d.valor !== null) li.appendChild(el("span", "mono", d.valor));
        li.appendChild(el("span", "", d.decision === "confirmado" ? "Lo confirmaste." : "Lo mandaste a revisar con el cliente."));
        li.appendChild(el("span", "meta", d.fechaColombia));
        ul.appendChild(li);
      }
      pd.appendChild(ul);
    }
    iconos();
  }
  function vacioHoja(nombreIcono, texto) { const e = el("div", "estado-vacio-vista"); e.appendChild(icono(nombreIcono)); e.appendChild(el("p", "", texto)); return e; }
  function tablaSimple(titulos, descripcion) {
    const t = el("table", "tabla-simple");
    t.appendChild(el("caption", "solo-lector", descripcion));
    const th = el("thead"), tr = el("tr");
    for (const x of titulos) { const c = el("th", "", x); c.scope = "col"; tr.appendChild(c); }
    th.appendChild(tr); t.appendChild(th); t.appendChild(el("tbody"));
    return t;
  }
  function envolver(t) { const w = el("div", "tabla-scroll"); w.tabIndex = 0; w.setAttribute("role", "region"); w.setAttribute("aria-label", t.querySelector("caption").textContent + " (con desplazamiento)"); w.appendChild(t); return w; }

  function cerrarHoja(devolverFoco) {
    const caso = estado.hoja.caso;
    estado.hoja = { abierta: false, caso: null, pestana: "campos", datos: null };
    ocultarPanel($("hoja-caso"));
    sincronizarOverlay();
    // La tabla se repinta mientras la hoja está abierta: si el botón de origen ya no existe, el foco vuelve a la fila de ese caso.
    if (devolverFoco !== false && caso && (!document.activeElement || document.activeElement === document.body)) {
      const b = document.querySelector('#casos-cuerpo [data-caso="' + caso + '"] .fila-cliente, #casos-cuerpo [data-caso="' + caso + '"].fila-movil');
      if (b) b.focus();
    }
  }
  $("cerrar-hoja").addEventListener("click", () => cerrarHoja());
  $("abrir-en-asistente").addEventListener("click", async () => {
    const caso = estado.hoja.caso;
    if (!caso) return;
    cerrarHoja();
    navegar("#/");
    await seleccionar(caso, false, false, true);   // el caso queda en foco en el chat (y se restaura su última conversación); no se envía nada al modelo
    if ($("entrada").disabled) { $("h-chat").tabIndex = -1; $("h-chat").focus(); } else $("entrada").focus();
  });

  // ---------- fecha de referencia ----------
  async function refrescarListas() { await Promise.all([cargarResumen(true), cargarSesiones()]); }
  async function refrescar() {
    await refrescarListas();
    if (estado.vista === "reporte") await verReporte();
    else if (estado.seleccion) await cargarCaso(false);
  }
  function fijarFecha(f) {
    if (!f) return;
    estado.fecha = f;
    $("fecha").value = f;
    $("fecha-texto").textContent = "Fecha de referencia: " + fechaCorta(f);
    almacen("set", "fecha", f);
    refrescar();
    anunciar("Fecha de referencia: " + fechaCorta(f));
  }
  $("fecha").addEventListener("change", (e) => fijarFecha(e.target.value));
  $("fecha-reto").addEventListener("click", () => fijarFecha(estado.fechaDefecto));
  $("fecha-hoy").addEventListener("click", () => fijarFecha(hoyLocal()));
  $("ver-reporte").addEventListener("click", verReporte);
  $("form-chat").addEventListener("submit", (e) => { e.preventDefault(); enviar($("entrada").value, false); });
  $("entrada").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar($("entrada").value, false); } });
  async function conversacionNueva(opc) {
    // El historial no se borra: la conversación anterior sigue en la lista del Historial.
    estado.sessionId = nuevoId(); almacen("set", claveSesion(), estado.sessionId); mostrarAviso("");
    await iniciarChat();
    enfocarChatEnCaso();   // el caso en foco se conserva: la conversación nueva parte limpia, para ese mismo caso
    renderConversaciones();
    if (opc && opc.sinFoco) return;
    if (estado.bandejaAbierta) cerrarBandeja();
    $("entrada").focus();
  }
  $("nueva").addEventListener("click", () => conversacionNueva());

  // ---------- ingreso y sesión ----------
  const claveSesion = () => "sessionId" + (estado.auth.usuario ? ":" + estado.auth.usuario.id : "");

  function mostrarIngreso(mensaje) {
    $("app").hidden = true;
    $("ingreso").hidden = false;
    const e = $("error-ingreso");
    e.hidden = !mensaje; e.textContent = mensaje || "";
    $("clave").value = "";
    document.title = "Ingresar · Registro de proveedor";
    iconos();
    setTimeout(() => { if (!$("ingreso").hidden) $("correo").focus(); }, 50);
  }

  $("form-ingreso").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const correo = $("correo").value.trim(), clave = $("clave").value;
    if (!correo || !clave) { const e = $("error-ingreso"); e.hidden = false; e.textContent = "Escribe tu correo y tu contraseña."; return; }
    const boton = $("entrar");
    boton.disabled = true;
    $("error-ingreso").hidden = true;
    try {
      const r = await estado.auth.cliente.auth.signInWithPassword({ email: correo, password: clave });
      if (r.error) {
        const e = $("error-ingreso"); e.hidden = false;
        e.textContent = r.error.status === 400 || r.error.status === 401 || /invalid/i.test(r.error.message) ? "El correo o la contraseña no son correctos." : "No pude iniciar sesión. Inténtalo de nuevo en un momento.";
        $("clave").value = ""; $("clave").focus(); // el correo se conserva; la contraseña se vuelve a escribir
      } else { $("clave").value = ""; await entrarConSesion(r.data.session); }
    } catch (e) {
      const m = $("error-ingreso"); m.hidden = false; m.textContent = "No pude conectar con el servidor. Revisa tu conexión.";
    }
    boton.disabled = false;
  });

  async function salir() {
    if (estado.hoja.abierta) cerrarHoja(false);
    if (estado.detalleAbierto) cerrarDetalle();
    if (estado.bandejaAbierta) cerrarBandeja();
    if (estado.auth.cliente) await estado.auth.cliente.auth.signOut();
    estado.auth.usuario = null; estado.filtroConv = null; estado.vistaSesion = null; estado.resumen = null; estado.casos = []; estado.sesiones = null; estado.seleccion = null; estado.detalle = null; estado.vista = "caso"; $("caso-foco").textContent = "";
    $("mensajes").textContent = ""; limpiarPrincipal();
    mostrarIngreso("");
    anunciar("Cerraste sesión.");
  }
  $("salir").addEventListener("click", salir);

  async function entrarConSesion(sesion) {
    estado.auth.usuario = sesion && sesion.user ? { id: sesion.user.id, email: sesion.user.email } : null;
    $("ingreso").hidden = true;
    $("app").hidden = false;
    document.title = "Registro de proveedor";
    const u = $("usuario"), b = $("salir");
    u.hidden = !estado.auth.usuario; u.textContent = estado.auth.usuario ? estado.auth.usuario.email : "";
    b.hidden = !estado.auth.habilitada;
    await iniciarApp();
  }

  // ---------- conversaciones (en la bandeja) ----------
  const ESTADOS_SESION = { en_curso: "En curso", listo: "Listo", bloqueado: "Bloqueado", incompleto: "Incompleto" };

  function estadoSesion(clave, texto) {
    const e = el("span", "hist-estado es-" + clave);
    e.appendChild(el("span", "punto"));
    e.appendChild(document.createTextNode(texto));
    return e;
  }

  async function cargarSesiones() {
    const r = await api("/api/sessions");
    estado.sesiones = r.ok ? r.data.sesiones : null;
    renderConversaciones();
  }

  function renderConversaciones() {
    const cont = $("lista-conv");
    const focoConv = recordarFoco(cont, "id");
    cont.textContent = "";
    const sesiones = estado.sesiones;
    cont.removeAttribute("aria-busy");
    if (sesiones === null) { esqueleto(cont, 3, "sk-fila"); return; }
    if (sesiones.length === 0) {
      const v = el("div", "vacio-amable");
      v.appendChild(icono("message-square"));
      v.appendChild(el("p", "", "Todavía no tienes conversaciones."));
      cont.appendChild(v);
      iconos();
      return;
    }
    const visibles = estado.filtroConv ? sesiones.filter((x) => x.caso === estado.filtroConv) : sesiones;
    if (visibles.length === 0) {
      const v = el("div", "vacio-amable");
      v.appendChild(icono("message-square"));
      v.appendChild(el("p", "", "No tienes conversaciones de este caso."));
      cont.appendChild(v);
      iconos();
      actualizarFiltroConv();
      return;
    }
    const idActivo = estado.soloLectura ? estado.vistaSesion : estado.sessionId;
    const ul = el("ul", "lista-hist");
    for (const se of visibles) {
      const li = el("li");
      const b = el("button", "hist-item");
      b.type = "button";
      b.dataset.id = se.id;
      if (se.id === idActivo) b.setAttribute("aria-current", "true");
      const cliente = (estado.casos.find((c) => c.caso === se.caso) || {}).cliente;
      const nombre = se.caso ? (cliente || se.caso) : "Sin caso todavía";
      b.title = se.fechaColombia + " · " + nombre;
      const l1 = el("span", "fila-1");
      l1.appendChild(el("span", "hist-fecha trunc", se.fechaColombia));
      l1.appendChild(estadoSesion(se.estado, se.estadoTexto || ESTADOS_SESION[se.estado] || "En curso"));
      b.appendChild(l1);
      b.appendChild(el("span", "meta trunc", nombre));
      b.appendChild(el("span", "solo-lector", se.estado === "en_curso" ? ". Se retoma." : ". Solo lectura."));
      b.addEventListener("click", () => abrirConversacion(se));
      li.appendChild(b); ul.appendChild(li);
    }
    cont.appendChild(ul);
    devolverFoco(cont, "id", focoConv);
    actualizarFiltroConv();
  }

  // ---------- conversaciones de un caso: restaurar la última y filtrar el historial ----------
  const sesionesDeCaso = (caso) => (estado.sesiones || []).filter((x) => x.caso === caso);

  /** Al abrir un caso: carga su conversación más reciente; si no tiene ninguna, deja el saludo (o uno limpio si el chat era de otro caso). */
  async function restaurarConversacion(caso) {
    if (estado.ocupado || !estado.sesiones) return;
    const idMostrado = estado.soloLectura ? estado.vistaSesion : estado.sessionId;
    const mostrada = estado.sesiones.find((x) => x.id === idMostrado);
    if (mostrada && mostrada.caso === caso) return;   // ya está en pantalla
    const propias = sesionesDeCaso(caso);
    if (propias.length) { await abrirConversacion(propias[0], { sinCaso: true, sinFoco: true }); return; }
    if (mostrada && mostrada.caso) await conversacionNueva({ sinFoco: true });   // el chat era de otro caso: saludo limpio
  }

  /** Enlace fantasma bajo el encabezado del chat: «Ver conversaciones de este caso (N)» y su forma de quitar el filtro. */
  function actualizarFiltroConv() {
    const caja = $("chat-sub"), b = $("filtro-conv");
    const caso = estado.vista === "caso" ? estado.seleccion : null;
    const n = caso ? sesionesDeCaso(caso).length : 0;
    const activo = Boolean(estado.filtroConv);
    caja.hidden = !(caso && (n > 1 || activo));
    if (caja.hidden) return;
    const texto = activo ? "Quitar el filtro de conversaciones" : "Ver conversaciones de este caso (" + n + ")";
    b.setAttribute("aria-pressed", activo ? "true" : "false");
    if (b.dataset.texto === texto) return;
    b.dataset.texto = texto;
    b.textContent = "";
    b.append(icono(activo ? "filter-x" : "list-filter"), document.createTextNode(texto));
    iconos();
  }
  $("filtro-conv").addEventListener("click", () => {
    estado.filtroConv = estado.filtroConv ? null : estado.seleccion;
    renderConversaciones();
    if (estado.filtroConv && mqBandeja.matches && !estado.bandejaAbierta) abrirBandeja();
    anunciar(estado.filtroConv ? "Conversaciones filtradas por este caso." : "Filtro de conversaciones quitado.");
  });

  /** Abre la conversación en el chat central: en lectura si terminó, retomándola si sigue en curso. */
  async function abrirConversacion(se, opc) {
    opc = opc || {};
    if (estado.ruta === "casos") navegar("#/");
    const r = await api("/api/sessions/" + encodeURIComponent(se.id));
    if (!r.ok) { estado.sesiones = null; renderConversaciones(); cargarSesiones(); return; }
    if (estado.bandejaAbierta) cerrarBandeja();
    $("mensajes").textContent = "";
    const terminada = r.data.resumen && r.data.resumen.estado !== "en_curso";
    if (!terminada) { estado.sessionId = se.id; almacen("set", claveSesion(), se.id); modoLectura(false); }
    else { estado.vistaSesion = se.id; modoLectura(true, se.fechaColombia); }
    if (!opc.sinCaso && r.data.resumen && r.data.resumen.caso) await seleccionar(r.data.resumen.caso, false, false, false);
    r.data.historial.forEach((m, i) => pintarMensaje(m, i === r.data.historial.length - 1 && Boolean(r.data.pendiente)));
    renderConversaciones();
    anunciar(terminada ? "Conversación abierta en modo lectura." : "Conversación retomada.");
    if (!opc.sinFoco) { $("h-chat").tabIndex = -1; $("h-chat").focus(); }
  }

  // ---------- arranque ----------
  async function iniciarApp() {
    estado.sessionId = almacen("get", claveSesion()) || nuevoId();
    almacen("set", claveSesion(), estado.sessionId);
    const h = await api("/api/health");
    estado.fechaDefecto = (h.data && h.data.fechaReferencia) || hoyLocal();
    const guardada = almacen("get", "fecha");
    estado.fecha = guardada && /^\d{4}-\d{2}-\d{2}$/.test(guardada) ? guardada : estado.fechaDefecto;
    $("fecha").value = estado.fecha;
    $("fecha-texto").textContent = "Fecha de referencia: " + fechaCorta(estado.fecha);
    mostrarAviso(h.data && h.data.modo === "sin_modelo" ? "No hay modelo configurado: el asistente trabaja en modo sin modelo." : "");
    sincronizarLayout();
    esqueleto($("lista-casos"), 4, "sk-fila");
    esqueleto($("lista-conv"), 3, "sk-fila");
    await Promise.all([cargarBandeja(), cargarSesiones()]);
    await iniciarChat();
    iconos();
    aplicarRuta(true);
    if (estado.ruta === "asistente") $("entrada").focus();
  }

  async function arrancar() {
    iconos();
    let cfg = { authEnabled: false };
    try { cfg = await (await fetch("/api/config")).json(); } catch (e) { /* sin red: se intenta sin login */ }
    estado.auth.habilitada = Boolean(cfg.authEnabled);
    if (!estado.auth.habilitada) { await entrarConSesion(null); return; }
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) { mostrarIngreso("No pude cargar el inicio de sesión. Recarga la página."); return; }
    // Solo la clave pública (anon): la service role nunca llega al navegador.
    estado.auth.cliente = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    estado.auth.cliente.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT" && estado.auth.usuario) salir(); });
    const r = await estado.auth.cliente.auth.getSession();
    if (r.data && r.data.session) await entrarConSesion(r.data.session);
    else mostrarIngreso("");
  }
  arrancar();
})();
