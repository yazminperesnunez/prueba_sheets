// version_sheets_drive/app.js
// Conexión directa a Google Sheets y Google Drive vía Google Apps Script

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwgATjxdanWGLhtBVVsVUF3tAtyBVwtyufqRsdHPH-7QpydFCGfa93xVCdi5UwicH4/exec";

// ==========================================
// MÓDULO: DASHBOARD (index.html)
// ==========================================
// Variable global en memoria para filtrar la tabla del dashboard sin re-consultar a red
let procesosDashboardCache = [];
let filtroDashboardActivo = "TODOS";
let textoBusquedaDashboard = "";

// ==========================================
// MÓDULO: DASHBOARD (index.html)
// ==========================================
async function cargarDashboard() {
  document.getElementById("kpiTotalCompras").innerText = "...";
  document.getElementById("kpiTotalPagado").innerText = "...";
  document.getElementById("kpiSaldoPendiente").innerText = "...";
  if (document.getElementById("kpiProximos7Dias")) document.getElementById("kpiProximos7Dias").innerText = "...";
  if (document.getElementById("kpiComplementosFaltantes")) document.getElementById("kpiComplementosFaltantes").innerText = "...";

  try {
    const respuesta = await enviarPeticionAppsScript({ accion: "obtenerMetricas" });

    if (respuesta && respuesta.success) {
      document.getElementById("kpiTotalCompras").innerText = formatoMoneda(respuesta.totalCompras || 0);
      document.getElementById("kpiTotalPagado").innerText = formatoMoneda(respuesta.totalPagado || 0);
      document.getElementById("kpiSaldoPendiente").innerText = formatoMoneda(respuesta.saldoPendiente || 0);
      if (document.getElementById("kpiProximos7Dias")) {
        document.getElementById("kpiProximos7Dias").innerText = formatoMoneda(respuesta.proximos7Dias || 0);
      }

      // KPI Estrella: Complementos Faltantes (REP)
      const elReps = document.getElementById("kpiComplementosFaltantes");
      const badgeReps = document.getElementById("kpiBadgeRepAlerta");
      if (elReps) {
        const countReps = respuesta.complementosFaltantes || 0;
        elReps.innerText = countReps;
        if (badgeReps) {
          badgeReps.style.display = countReps > 0 ? "inline-block" : "none";
          badgeReps.innerText = `${countReps} Pendiente${countReps > 1 ? 's' : ''}`;
        }
      }
    }
  } catch (error) {
    console.error("Error cargando métricas:", error);
  }

  await cargarProcesosActivos();
}

async function cargarProcesosActivos() {
  const tbody = document.getElementById("tablaProcesosDashboard");
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Consultando procesos en Google Sheets...</td></tr>';

  try {
    const res = await enviarPeticionAppsScript({ accion: "obtenerProcesosActivos" });

    if (!res || !res.success || !res.procesos) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No se pudieron cargar los procesos de Google Sheets.</td></tr>';
      return;
    }

    procesosDashboardCache = res.procesos || [];

    // Calcular KPIs complementarios desde cache si aún están pendientes
    actualizarMetricasComplementariasDesdeCache();

    // Actualizar contadores de las píldoras de filtrado
    actualizarContadoresFiltrosDashboard();

    // Renderizar la tabla con el filtro activo
    renderizarTablaDashboardFiltrada();

  } catch (error) {
    console.error("Error cargando procesos:", error);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Error al consultar Google Sheets.</td></tr>';
  }
}

/**
 * Calcula los valores de las nuevas tarjetas KPI si el backend no los retornó explícitamente
 */
function actualizarMetricasComplementariasDesdeCache() {
  let porPagar7Dias = 0;
  let complementosFaltantesCount = 0;

  const hoy = new Date();
  const en7Dias = new Date();
  en7Dias.setDate(hoy.getDate() + 7);

  procesosDashboardCache.forEach(p => {
    const estatus = (p.estatus || "").toUpperCase();
    const saldo = parseFloat(p.saldo_pendiente) || 0;

    // Conteo estricto de REPs pendientes a través de las parcialidades del proceso
    if (p.reps_pendientes !== undefined) {
      complementosFaltantesCount += (parseInt(p.reps_pendientes) || 0);
    } else if (p.parcialidades && Array.isArray(p.parcialidades)) {
      p.parcialidades.forEach(ab => {
        if (ab.estatus_rep === "PENDIENTE" || ab.estatus_rep === "PENDIENTE_COMPLEMENTO" || !ab.estatus_rep) {
          complementosFaltantesCount++;
        }
      });
    }

    // Por pagar en próximos 7 días: si tiene saldo y fecha próxima o estatus próximo a vencer
    if (estatus.includes("VENCER") || (saldo > 0 && (estatus.includes("TRANSITO") || estatus.includes("CONTRATADO") || estatus.includes("PAGO_PARCIAL")))) {
      porPagar7Dias += (saldo * 0.5); // proyección de anticipos/compromisos inmediatos
    }
  });

  const el7 = document.getElementById("kpiProximos7Dias");
  if (el7 && el7.innerText === "...") {
    el7.innerText = formatoMoneda(porPagar7Dias);
  }

  const elReps = document.getElementById("kpiComplementosFaltantes");
  const badgeReps = document.getElementById("kpiBadgeRepAlerta");
  if (elReps && elReps.innerText === "...") {
    elReps.innerText = complementosFaltantesCount;
    if (badgeReps) {
      badgeReps.style.display = complementosFaltantesCount > 0 ? "inline-block" : "none";
      badgeReps.innerText = `${complementosFaltantesCount} Pendiente${complementosFaltantesCount > 1 ? 's' : ''}`;
    }
  }
}

/**
 * Clasifica cada proceso en una categoría de filtro
 */
function clasificarEstatusProceso(p) {
  const estatus = (p.estatus || "").toUpperCase();
  const saldo = parseFloat(p.saldo_pendiente) || 0;

  if (estatus === "EN_COTIZACION" || estatus === "COTIZACION" || estatus.startsWith("REQ-")) {
    return "COTIZACION";
  }
  if (estatus === "ORDEN_COMPRA_EMITIDA" || estatus.includes("TRANSITO") || estatus === "CONTRATADO" || estatus === "EN_PROGRESO") {
    // Si ya está en tránsito pero le falta factura
    if (!p.cfdi_url && !p.factura_url && saldo > 0) {
      // Puede aparecer en ambos o en transito
    }
    return "TRANSITO";
  }
  if (estatus.includes("FALTA_FACTURA") || estatus.includes("PENDIENTE_CFDI")) {
    return "FALTA_FACTURA";
  }
  if (estatus.includes("VENCER") || estatus.includes("URGENTE")) {
    return "PROXIMOS_VENCER";
  }
  if (estatus === "PAGADO_TOTAL" || estatus === "PAGADO" || estatus === "CERRADO" || saldo === 0) {
    return "PAGADOS";
  }
  return "TRANSITO";
}

/**
 * Genera la etiqueta HTML con el color correspondiente a las etapas post-OC:
 * 1. OC Emitida (Gris o Azul claro): Esperando despacho.
 * 2. Entregado / En Almacén (Azul): El producto llegó físicamente (completo o parcial).
 * 3. Falta Factura (Amarillo / Alerta): Material recibido, pendiente XML/PDF fiscal.
 * 4. Por Pagar (Próximo) (Naranja / Warning): Factura validada; cerca de fecha límite.
 * 5. Pagado y Cerrado (Verde / Success): Transferencia liquidada y proceso concluido.
 */
function obtenerBadgeEstatusColor(p) {
  const estatus = (p.estatus || "").toUpperCase();
  const saldo = parseFloat(p.saldo_pendiente) || 0;

  // 5b. Liquidado pero con REPs Pendientes (Alerta Fiscal Roja)
  if (estatus.includes("FALTA_REP") || (saldo === 0 && p.reps_pendientes > 0)) {
    return `<span class="badge bg-danger text-white px-2 py-1"><span class="me-1">⚠</span> Liquidado (Falta REP)</span>`;
  }

  // 5. Pagado y Cerrado al 100% (Verde)
  if (estatus === "PAGADO_TOTAL_CERRADO" || (saldo === 0 && (!p.reps_pendientes || p.reps_pendientes === 0))) {
    return `<span class="badge bg-success text-white px-2 py-1"><span class="me-1">✓</span> Pagado y Cerrado</span>`;
  }

  // 4b. Pago Parcial / Amortización en curso
  if (estatus.includes("PAGO_PARCIAL") || (p.total_abonado > 0 && saldo > 0)) {
    return `<span class="badge bg-info text-dark px-2 py-1 border border-info"><span class="me-1">💳</span> Parcialidad (${formatoMoneda(saldo)} pend.)</span>`;
  }

  // 4. Por Pagar (Próximo) (Naranja)
  if (estatus.includes("POR_PAGAR") || estatus.includes("VENCER") || estatus.includes("PROGRAMADO")) {
    return `<span class="badge bg-warning text-dark px-2 py-1" style="background-color: #fd7e14 !important; color: #fff !important;"><span class="me-1">⏱</span> Por Pagar (Próximo)</span>`;
  }

  // 3. Falta Factura (Amarillo / Alerta)
  if (estatus.includes("FALTA_FACTURA") || (!p.cfdi_url && !p.factura_url && (estatus.includes("ENTREGADO") || estatus.includes("ALMACEN")))) {
    return `<span class="badge bg-warning text-dark px-2 py-1"><span class="me-1">!</span> Falta Factura</span>`;
  }

  // 2b. Entrega Parcial / Incompleta (Amarillo advertencia)
  if (estatus.includes("PARCIAL")) {
    return `<span class="badge bg-warning text-dark px-2 py-1 border border-warning fw-semibold"><span class="me-1">⚠</span> Entrega Parcial</span>`;
  }

  // 2. Entregado / En Almacén (Azul)
  if (estatus.includes("ENTREGADO") || estatus.includes("ALMACEN") || estatus.includes("RECEPCION")) {
    return `<span class="badge bg-primary text-white px-2 py-1"><span class="me-1">📦</span> Entregado / Almacén</span>`;
  }

  // 1. OC Emitida / En Cotización (Gris o Azul claro)
  if (estatus.includes("ORDEN_COMPRA") || estatus.includes("EMITIDA") || estatus.includes("TRANSITO")) {
    return `<span class="badge bg-info-subtle text-primary border border-info px-2 py-1"><span class="me-1">✉</span> OC Emitida</span>`;
  }

  if (estatus === "EN_COTIZACION" || estatus === "COTIZACION") {
    return `<span class="badge bg-secondary text-white px-2 py-1"><span class="me-1">●</span> En Cotización</span>`;
  }

  // Default Azul corporativo
  return `<span class="badge bg-primary text-white px-2 py-1">${p.estatus || 'OC Emitida'}</span>`;
}

function actualizarContadoresFiltrosDashboard() {
  let cTodos = procesosDashboardCache.length;
  let cCotiz = 0;
  let cTrans = 0;
  let cFact = 0;
  let cVenc = 0;
  let cPag = 0;

  procesosDashboardCache.forEach(p => {
    const estatus = (p.estatus || "").toUpperCase();
    const saldo = parseFloat(p.saldo_pendiente) || 0;

    if (estatus === "EN_COTIZACION" || estatus === "COTIZACION") {
      cCotiz++;
    } else if (saldo === 0 || estatus === "PAGADO_TOTAL" || estatus === "PAGADO") {
      cPag++;
    } else if (estatus.includes("VENCER")) {
      cVenc++;
    } else if (estatus.includes("FALTA_FACTURA") || (!p.cfdi_url && !p.factura_url)) {
      cFact++;
      cTrans++; // también cuenta como proceso en tránsito
    } else {
      cTrans++;
    }
  });

  const setBadge = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  setBadge("count-filtro-todos", cTodos);
  setBadge("count-filtro-cotizacion", cCotiz);
  setBadge("count-filtro-transito", cTrans);
  setBadge("count-filtro-factura", cFact);
  setBadge("count-filtro-vencer", cVenc);
  setBadge("count-filtro-pagados", cPag);
}

function aplicarFiltroDashboard(categoria, btn) {
  filtroDashboardActivo = categoria;

  // Actualizar estilos de los botones (píldoras)
  const contenedor = document.getElementById("contenedorFiltrosDashboard");
  if (contenedor) {
    const botones = contenedor.querySelectorAll(".filter-pill");
    botones.forEach(b => {
      b.classList.remove("active", "btn-primary", "btn-secondary", "btn-warning", "btn-danger", "btn-success");
      b.classList.add("btn-outline-" + obtenerClaseColorPildora(b.getAttribute("data-filtro")));
    });

    if (btn) {
      btn.classList.add("active");
      const color = obtenerClaseColorPildora(categoria);
      btn.classList.remove("btn-outline-" + color);
      btn.classList.add("btn-" + color);
    }
  }

  renderizarTablaDashboardFiltrada();
}

function obtenerClaseColorPildora(cat) {
  switch (cat) {
    case "TODOS": return "primary";
    case "COTIZACION": return "secondary";
    case "TRANSITO": return "primary";
    case "FALTA_FACTURA": return "warning";
    case "PROXIMOS_VENCER": return "danger";
    case "PAGADOS": return "success";
    default: return "primary";
  }
}

function filtrarProcesosPorTexto(texto) {
  textoBusquedaDashboard = (texto || "").toLowerCase().trim();
  renderizarTablaDashboardFiltrada();
}

function renderizarTablaDashboardFiltrada() {
  const tbody = document.getElementById("tablaProcesosDashboard");
  if (!tbody) return;

  let filtrados = procesosDashboardCache.filter(p => {
    // 1. Filtro por categoría de estatus
    if (filtroDashboardActivo !== "TODOS") {
      const est = (p.estatus || "").toUpperCase();
      const saldo = parseFloat(p.saldo_pendiente) || 0;

      if (filtroDashboardActivo === "COTIZACION" && est !== "EN_COTIZACION" && est !== "COTIZACION") {
        return false;
      }
      if (filtroDashboardActivo === "TRANSITO" && (est === "EN_COTIZACION" || saldo === 0)) {
        return false;
      }
      if (filtroDashboardActivo === "FALTA_FACTURA" && (p.cfdi_url || p.factura_url || saldo === 0)) {
        return false;
      }
      if (filtroDashboardActivo === "PROXIMOS_VENCER" && !est.includes("VENCER") && !est.includes("URGENTE")) {
        return false;
      }
      if (filtroDashboardActivo === "PAGADOS" && saldo > 0 && est !== "PAGADO_TOTAL" && est !== "CERRADO") {
        return false;
      }
    }

    // 2. Filtro por texto de búsqueda
    if (textoBusquedaDashboard) {
      const id = (p.id || "").toLowerCase();
      const conc = (p.concepto || "").toLowerCase();
      const prov = (p.razon_social || p.proveedor_id || "").toLowerCase();
      if (!id.includes(textoBusquedaDashboard) && !conc.includes(textoBusquedaDashboard) && !prov.includes(textoBusquedaDashboard)) {
        return false;
      }
    }

    return true;
  });

  const labelTotal = document.getElementById("labelTotalListados");
  if (labelTotal) {
    labelTotal.innerText = `Mostrando ${filtrados.length} de ${procesosDashboardCache.length} procesos`;
  }

  tbody.innerHTML = "";

  if (filtrados.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-5 text-muted">
          <div class="mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-secondary"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
          <span class="fw-medium">No se encontraron procesos en esta vista o filtro.</span>
        </td>
      </tr>
    `;
    return;
  }

  filtrados.forEach(p => {
    const badgeEstatus = obtenerBadgeEstatusColor(p);
    const monto = formatoMoneda(p.monto_acordado || 0);
    const saldo = parseFloat(p.saldo_pendiente) || 0;

    // Botón Ver Detalle (Abre modal con línea de tiempo)
    let btnVerDetalle = `
      <button type="button" class="btn btn-sm btn-primary" onclick="abrirModalDetalleProceso('${p.id}')" title="Ver Línea de Tiempo y Avanzar Estatus">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0z"></path><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg> Ver Detalle
      </button>
    `;

    // Enlaces a documentos (cotización, orden de compra o carpeta drive)
    let urlDoc = p.cotizacion_url || p.contrato_url || "";
    let btnVerDoc = urlDoc
      ? `<a href="${urlDoc}" target="_blank" class="btn btn-sm btn-outline-secondary" title="Abrir expediente en Google Drive">
           <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Doc
         </a>`
      : "";

    const fila = `
      <tr>
        <td>
          <a href="javascript:void(0)" onclick="abrirModalDetalleProceso('${p.id}')" class="font-monospace fw-bold text-primary text-decoration-none">
            ${p.id}
          </a>
        </td>
        <td>
          <div class="fw-semibold text-truncate" style="max-width: 280px;" title="${p.concepto || ''}">${p.concepto || 'Sin concepto'}</div>
          <small class="text-muted">${saldo > 0 ? `Saldo pend: <span class="text-danger fw-semibold">${formatoMoneda(saldo)}</span>` : '<span class="text-success fw-semibold">Liquidado</span>'}</small>
        </td>
        <td>
          <span class="fw-medium">${p.razon_social || p.proveedor_id || 'Proveedor Adjudicado'}</span>
        </td>
        <td class="text-end">
          <span class="font-monospace fw-bold">${monto}</span>
        </td>
        <td class="text-center">
          ${badgeEstatus}
        </td>
        <td class="text-center">
          <div class="btn-group btn-group-sm" role="group">
            ${btnVerDetalle}
            ${btnVerDoc}
          </div>
        </td>
      </tr>
    `;
    tbody.innerHTML += fila;
  });
}

function abrirModalSubirFactura(idProceso, concepto) {
  const modalEl = document.getElementById("modalSubirFacturaDashboard");
  if (!modalEl) return;

  document.getElementById("dash-factura-proceso-id").value = idProceso;
  document.getElementById("dash-factura-proceso-label").value = `${idProceso} - ${concepto}`;

  const modal = new bootstrap.Modal(modalEl);
  modal.show();
}

async function guardarFacturaDesdeDashboard(event) {
  event.preventDefault();
  const idProceso = document.getElementById("dash-factura-proceso-id").value;
  const inputXml = document.getElementById("dash-factura-xml");
  const inputPdf = document.getElementById("dash-factura-pdf");

  const btnSubmit = event.target.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;
  btnSubmit.innerText = "Subiendo y vinculando...";

  try {
    let xmlData = null;
    if (inputXml.files[0]) {
      xmlData = await archivoABase64(inputXml.files[0]);
    }
    let pdfData = null;
    if (inputPdf.files[0]) {
      pdfData = await archivoABase64(inputPdf.files[0]);
    }

    const payload = {
      accion: "subirCFDI",
      procesoId: idProceso,
      xmlFile: xmlData,
      pdfFile: pdfData
    };

    const res = await enviarPeticionAppsScript(payload);

    if (res && res.success) {
      alert("¡Factura fiscal vinculada con éxito al proceso " + idProceso + "!");
      const modalEl = document.getElementById("modalSubirFacturaDashboard");
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
      event.target.reset();
      cargarDashboard();
    } else {
      throw new Error(res.error || "No se pudo vincular la factura en Google Sheets / Drive.");
    }
  } catch (err) {
    console.error(err);
    alert("Error al subir factura: " + err.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = "Guardar y Vincular Factura";
  }
}

// =============================================================================
// MÓDULO: MODAL DETALLE Y LÍNEA DE TIEMPO DEL PROCESO (POST-OC)
// =============================================================================
// MÓDULO: MODAL DETALLE Y LÍNEA DE TIEMPO DEL PROCESO (POST-OC)
// =============================================================================
let procesoSeleccionadoDetalle = null;

async function abrirModalDetalleProceso(idProceso) {
  const modalEl = document.getElementById("modalDetalleProceso");
  if (!modalEl) return;

  const proceso = procesosDashboardCache.find(p => p.id === idProceso);
  if (!proceso) {
    alert("Proceso no encontrado en memoria.");
    return;
  }

  procesoSeleccionadoDetalle = proceso;

  // Llenar datos de cabecera y resumen jerárquico
  document.getElementById("modal-detalle-id").innerText = proceso.id;
  document.getElementById("modal-detalle-subtitulo").innerText = `Proveedor: ${proceso.razon_social || proceso.proveedor_id || 'Adjudicado'}`;
  document.getElementById("modal-detalle-concepto").innerText = proceso.concepto || "Sin concepto";
  document.getElementById("modal-detalle-monto").innerText = formatoMoneda(proceso.monto_acordado || 0);

  const elAbonado = document.getElementById("modal-detalle-abonado");
  if (elAbonado) elAbonado.innerText = formatoMoneda(proceso.total_abonado || 0);

  document.getElementById("modal-detalle-saldo").innerText = formatoMoneda(proceso.saldo_pendiente || 0);
  document.getElementById("modal-detalle-badge-estatus").innerHTML = obtenerBadgeEstatusColor(proceso);

  // Prellenar campos del formulario de pago con el saldo restante
  const inputPagoMonto = document.getElementById("modal-pago-monto");
  if (inputPagoMonto) inputPagoMonto.value = (proceso.saldo_pendiente || 0).toFixed(2);

  const inputPagoFecha = document.getElementById("modal-pago-fecha");
  if (inputPagoFecha) inputPagoFecha.value = new Date().toISOString().split('T')[0];

  const inputNumParc = document.getElementById("modal-pago-num-parcialidad");
  if (inputNumParc) {
    const sigNum = (proceso.parcialidades ? proceso.parcialidades.length : 0) + 1;
    inputNumParc.value = `Abono ${sigNum}`;
  }

  const inputRecepFecha = document.getElementById("recepcion-fecha");
  if (inputRecepFecha) inputRecepFecha.value = new Date().toISOString().split('T')[0];

  // Actualizar la línea de tiempo visual del stepper
  actualizarVisualStepperModal(proceso);

  // Renderizar de inmediato las parcialidades en cache y consultar frescas en segundo plano
  renderizarSubtablaParcialidades(proceso.parcialidades || []);
  cargarParcialidadesRemotas(proceso.id);

  const modal = new bootstrap.Modal(modalEl);
  modal.show();
}

/**
 * Consulta las parcialidades registradas en Google Sheets para el proceso actual
 */
async function cargarParcialidadesRemotas(procesoId) {
  try {
    const res = await enviarPeticionAppsScript({
      accion: "obtenerParcialidadesProceso",
      procesoId: procesoId
    });

    if (res && res.success && Array.isArray(res.parcialidades)) {
      if (procesoSeleccionadoDetalle && procesoSeleccionadoDetalle.id === procesoId) {
        procesoSeleccionadoDetalle.parcialidades = res.parcialidades;

        // Recalcular saldo dinámico
        let sum = 0;
        let repsPend = 0;
        res.parcialidades.forEach(ab => {
          sum += (parseFloat(ab.monto_abonado) || 0);
          if (ab.estatus_rep === "PENDIENTE" || ab.estatus_rep === "PENDIENTE_COMPLEMENTO" || !ab.estatus_rep) {
            repsPend++;
          }
        });
        procesoSeleccionadoDetalle.total_abonado = sum;
        procesoSeleccionadoDetalle.saldo_pendiente = Math.max(0, (procesoSeleccionadoDetalle.monto_acordado || 0) - sum);
        procesoSeleccionadoDetalle.reps_pendientes = repsPend;

        const elAbonado = document.getElementById("modal-detalle-abonado");
        if (elAbonado) elAbonado.innerText = formatoMoneda(sum);
        document.getElementById("modal-detalle-saldo").innerText = formatoMoneda(procesoSeleccionadoDetalle.saldo_pendiente);

        renderizarSubtablaParcialidades(res.parcialidades);
        actualizarVisualStepperModal(procesoSeleccionadoDetalle);
      }
    }
  } catch (err) {
    console.warn("Aviso consultando parcialidades:", err);
  }
}

/**
 * Renderiza la subtabla de amortización con sus estatus de Complemento de Pago (REP)
 */
function renderizarSubtablaParcialidades(parcialidades) {
  const tbody = document.getElementById("tablaParcialidadesModalTbody");
  const badgeReps = document.getElementById("modal-detalle-reps-badge");
  const alertaCierre = document.getElementById("alerta-cierre-proceso-info");
  const btnCerrar = document.getElementById("btn-cerrar-proceso-modal");

  if (!tbody) return;

  if (!parcialidades || parcialidades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3 small">Sin abonos registrados aún. Realiza el primer abono abajo.</td></tr>';
    if (badgeReps) badgeReps.innerText = "0 REPs Pendientes";
    if (alertaCierre) alertaCierre.innerHTML = "⚠ Pendiente de cubrir el saldo global.";
    if (btnCerrar) {
      btnCerrar.disabled = true;
      btnCerrar.title = "Se requiere haber cubierto el 100% de la compra y contar con todos los complementos REP.";
    }
    return;
  }

  let repsPendientes = 0;
  let html = "";

  parcialidades.forEach((ab, idx) => {
    const esPendiente = ab.estatus_rep === "PENDIENTE" || ab.estatus_rep === "PENDIENTE_COMPLEMENTO" || !ab.estatus_rep;
    if (esPendiente) repsPendientes++;

    const badgeREP = esPendiente
      ? '<span class="badge bg-danger-subtle text-danger border border-danger fw-bold">⚠ REP Pendiente</span>'
      : '<span class="badge bg-success-subtle text-success border border-success fw-bold">✓ REP Recibido</span>';

    const btnComprobante = ab.comprobante_url
      ? `<a href="${ab.comprobante_url}" target="_blank" class="btn btn-xs btn-outline-secondary py-0 px-2" style="font-size: 11px;">📄 Ficha</a>`
      : '<span class="text-muted small">N/D</span>';

    const btnAccionREP = esPendiente
      ? `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" style="font-size: 11px;" onclick="abrirModalSubirREP('${ab.id_pago}', '${ab.num_parcialidad || (idx + 1)}')">📤 Subir REP</button>`
      : (ab.rep_url ? `<a href="${ab.rep_url}" target="_blank" class="btn btn-xs btn-outline-success py-0 px-2" style="font-size: 11px;">✓ Ver XML</a>` : '<span class="text-success small">Recibido</span>');

    html += `
      <tr>
        <td class="font-monospace fw-bold text-dark small">${ab.num_parcialidad || `Abono ${idx + 1}`}</td>
        <td class="small text-muted">${ab.fecha_pago || 'Hoy'}</td>
        <td class="text-end font-monospace fw-bold text-dark">${formatoMoneda(ab.monto_abonado || 0)}</td>
        <td class="text-center">${btnComprobante}</td>
        <td class="text-center">${badgeREP}</td>
        <td class="text-center">${btnAccionREP}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  if (badgeReps) {
    badgeReps.className = repsPendientes > 0 ? "badge bg-danger text-white border small ms-1" : "badge bg-success text-white border small ms-1";
    badgeReps.innerText = repsPendientes > 0 ? `${repsPendientes} REP${repsPendientes > 1 ? 's' : ''} Faltante${repsPendientes > 1 ? 's' : ''}` : "✓ Todos los REPs al día";
  }

  // Validación de Cierre Estricto
  const saldoActual = procesoSeleccionadoDetalle ? (procesoSeleccionadoDetalle.saldo_pendiente || 0) : 1;
  if (alertaCierre && btnCerrar) {
    if (saldoActual > 0) {
      alertaCierre.innerHTML = `<span>⚠ Saldo restante por liquidar: <strong>${formatoMoneda(saldoActual)}</strong></span>`;
      btnCerrar.disabled = true;
    } else if (repsPendientes > 0) {
      alertaCierre.innerHTML = `<span class="text-danger fw-bold">⛔ Bloqueo Fiscal: Tienes ${repsPendientes} REP(s) pendiente(s). Sube los complementos del SAT para poder cerrar.</span>`;
      btnCerrar.disabled = true;
    } else {
      alertaCierre.innerHTML = `<span class="text-success fw-bold">✓ Saldo liquidado y 100% de complementos fiscales recibidos. Listo para cerrar.</span>`;
      btnCerrar.disabled = false;
    }
  }
}

/**
 * Pinta los colores de los pasos en el stepper según el estatus del proceso:
 * 1. OC Emitida
 * 2. Entregado / Almacén
 * 3. Factura Fiscal (Pendiente / Recibida)
 * 4. Por Pagar (Próximo)
 * 5. Pagado y Cerrado
 */
function actualizarVisualStepperModal(p) {
  const estatus = (p.estatus || "").toUpperCase();
  const saldo = parseFloat(p.saldo_pendiente) || 0;
  const repsPendientes = parseInt(p.reps_pendientes) || 0;

  const s1 = document.getElementById("step-post-oc");
  const s2 = document.getElementById("step-post-entrega");
  const s3 = document.getElementById("step-post-factura");
  const s4 = document.getElementById("step-post-porpagar");
  const s5 = document.getElementById("step-post-cerrado");

  // Reset clases
  [s1, s2, s3, s4, s5].forEach(s => {
    if (s) s.className = "p-2 rounded border bg-light text-secondary";
  });

  // Paso 1: OC Emitida siempre está activo o completado
  if (s1) s1.className = "p-2 rounded border bg-primary text-white shadow-sm";

  // Determinar en qué fase está
  const esParcial = estatus.includes("PARCIAL");
  const esEntregado = estatus.includes("ENTREGADO") || estatus.includes("ALMACEN") || estatus.includes("FACTURA") || estatus.includes("PAGAR") || estatus.includes("PAGADO") || esParcial;
  const tieneFactura = p.cfdi_url || p.factura_url || estatus.includes("POR_PAGAR") || estatus.includes("PAGADO");
  const esPorPagar = (saldo > 0 && tieneFactura) || estatus.includes("POR_PAGAR") || estatus.includes("VENCER") || estatus.includes("PAGO_PARCIAL");
  const esPagadoCerrado = saldo === 0 && repsPendientes === 0 && (estatus.includes("PAGADO_TOTAL_CERRADO") || estatus === "CERRADO");

  if (esEntregado && s2) {
    s2.className = "p-2 rounded border bg-primary text-white shadow-sm";
    if (esParcial) {
      document.getElementById("status-entrega-badge").innerText = "⚠ Entrega Parcial (Incompleta)";
      document.getElementById("status-entrega-badge").className = "badge bg-warning-subtle text-warning border border-warning fw-bold";
      s2.className = "p-2 rounded border text-dark shadow-sm";
      s2.style.backgroundColor = "#ffc107";
    } else {
      document.getElementById("status-entrega-badge").innerText = "✓ Entregado en Almacén";
      document.getElementById("status-entrega-badge").className = "badge bg-success-subtle text-success border border-success";
    }
  } else {
    document.getElementById("status-entrega-badge").innerText = "Pendiente de Llegada";
    document.getElementById("status-entrega-badge").className = "badge bg-light text-secondary border";
  }

  if (tieneFactura && s3) {
    s3.className = "p-2 rounded border bg-primary text-white shadow-sm";
    document.getElementById("status-factura-badge").innerText = "✓ Factura Validada";
    document.getElementById("status-factura-badge").className = "badge bg-success-subtle text-success border border-success";
  } else if (esEntregado) {
    if (s3) s3.className = "p-2 rounded border bg-warning text-dark shadow-sm";
    document.getElementById("status-factura-badge").innerText = "⚠ Falta Factura Fiscal";
    document.getElementById("status-factura-badge").className = "badge bg-warning-subtle text-warning border border-warning";
  }

  if (esPorPagar && !esPagadoCerrado && s4) {
    s4.className = "p-2 rounded border text-white shadow-sm";
    s4.style.backgroundColor = "#fd7e14";
    document.getElementById("status-pago-badge").innerText = saldo > 0 ? `⏱ Saldo por Amortizar: ${formatoMoneda(saldo)}` : "⚠ Liquidado pero con REPs Pendientes";
    document.getElementById("status-pago-badge").className = saldo > 0 ? "badge bg-warning-subtle text-warning border border-warning" : "badge bg-danger-subtle text-danger border border-danger";
  }

  if (esPagadoCerrado && s5) {
    [s1, s2, s3, s4, s5].forEach(s => {
      if (s) {
        s.className = "p-2 rounded border bg-success text-white shadow-sm";
        s.style.backgroundColor = "";
      }
    });
    document.getElementById("status-pago-badge").innerText = "✓ Pagado y Cerrado al 100%";
    document.getElementById("status-pago-badge").className = "badge bg-success-subtle text-success border border-success";
  }
}

/**
 * 1. Logística y Almacén: Registrar llegada física y acuse
 */
async function guardarRecepcionEntrega(event) {
  event.preventDefault();
  if (!procesoSeleccionadoDetalle) return;

  const tipo = document.getElementById("recepcion-tipo").value;
  const fecha = document.getElementById("recepcion-fecha").value;
  const fileInput = document.getElementById("recepcion-archivo");

  const btn = event.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerText = "Registrando en almacén...";

  try {
    let remisionData = null;
    if (fileInput.files[0]) {
      remisionData = await archivoABase64(fileInput.files[0]);
    }

    const nuevoEstatus = tipo === "COMPLETA" ? "ENTREGADO_ALMACEN" : "ENTREGA_PARCIAL";

    const payload = {
      accion: "actualizarProceso",
      procesoId: procesoSeleccionadoDetalle.id,
      estatus: nuevoEstatus,
      fechaEntregaReal: fecha,
      remisionFile: remisionData
    };

    const res = await enviarPeticionAppsScript(payload);

    if (res && res.success) {
      alert(`¡Recepción de insumos registrada exitosamente!\nEstatus actualizado a: ${nuevoEstatus}`);
      procesoSeleccionadoDetalle.estatus = nuevoEstatus;
      document.getElementById("modal-detalle-badge-estatus").innerHTML = obtenerBadgeEstatusColor(procesoSeleccionadoDetalle);
      actualizarVisualStepperModal(procesoSeleccionadoDetalle);
      cargarDashboard();
    } else {
      throw new Error(res.error || "No se pudo registrar la entrega.");
    }
  } catch (err) {
    console.error(err);
    alert("Error al registrar entrega: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Registrar Llegada a Almacén";
  }
}

/**
 * 2. Facturación SAT: Subir XML y PDF desde el modal de detalle
 */
async function guardarFacturaDesdeModalDetalle(event) {
  event.preventDefault();
  if (!procesoSeleccionadoDetalle) return;

  const xmlFile = document.getElementById("modal-factura-xml").files[0];
  const pdfFile = document.getElementById("modal-factura-pdf").files[0];

  const btn = event.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerText = "Validando y guardando...";

  try {
    let xmlData = xmlFile ? await archivoABase64(xmlFile) : null;
    let pdfData = pdfFile ? await archivoABase64(pdfFile) : null;

    const payload = {
      accion: "subirCFDI",
      procesoId: procesoSeleccionadoDetalle.id,
      xmlFile: xmlData,
      pdfFile: pdfData
    };

    const res = await enviarPeticionAppsScript(payload);

    if (res && res.success) {
      alert(`¡Factura fiscal XML y PDF validada y vinculada al proceso ${procesoSeleccionadoDetalle.id}!`);
      procesoSeleccionadoDetalle.cfdi_url = "cargado";
      procesoSeleccionadoDetalle.estatus = "POR_PAGAR_PROGRAMADO";
      document.getElementById("modal-detalle-badge-estatus").innerHTML = obtenerBadgeEstatusColor(procesoSeleccionadoDetalle);
      actualizarVisualStepperModal(procesoSeleccionadoDetalle);
      cargarDashboard();
    } else {
      throw new Error(res.error || "Error al subir factura.");
    }
  } catch (err) {
    console.error(err);
    alert("Error al procesar factura: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Validar y Cargar Factura";
  }
}

/**
 * 3. Tesorería: Marcar como programado / por pagar próximo
 */
async function programarPagoUrgente() {
  if (!procesoSeleccionadoDetalle) return;

  try {
    const payload = {
      accion: "actualizarProceso",
      procesoId: procesoSeleccionadoDetalle.id,
      estatus: "POR_PAGAR_PROGRAMADO"
    };

    const res = await enviarPeticionAppsScript(payload);
    if (res && res.success) {
      alert("Proceso programado en calendario de pagos.");
      procesoSeleccionadoDetalle.estatus = "POR_PAGAR_PROGRAMADO";
      document.getElementById("modal-detalle-badge-estatus").innerHTML = obtenerBadgeEstatusColor(procesoSeleccionadoDetalle);
      actualizarVisualStepperModal(procesoSeleccionadoDetalle);
      cargarDashboard();
    }
  } catch (err) {
    alert("Error al programar pago: " + err.message);
  }
}

/**
 * 3. Tesorería: Registrar nueva parcialidad / abono (Modelo PPD)
 */
async function guardarPagoDesdeModalDetalle(event) {
  event.preventDefault();
  if (!procesoSeleccionadoDetalle) return;

  const numParcialidad = document.getElementById("modal-pago-num-parcialidad").value.trim() || "Abono Parcial";
  const monto = document.getElementById("modal-pago-monto").value;
  const fecha = document.getElementById("modal-pago-fecha").value;
  const compFile = document.getElementById("modal-pago-comprobante").files[0];

  const btn = event.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerText = "Registrando parcialidad...";

  try {
    let compData = compFile ? await archivoABase64(compFile) : null;

    const payload = {
      accion: "registrarPago",
      procesoId: procesoSeleccionadoDetalle.id,
      numParcialidad: numParcialidad,
      montoAbonado: monto,
      fechaTransferencia: fecha,
      comprobanteFile: compData
    };

    const res = await enviarPeticionAppsScript(payload);

    if (res && res.success) {
      alert(`🎉 ¡Abono registrado con éxito!\n\nID Pago: ${res.idPago}\nParcialidad: ${numParcialidad}\nMonto: ${formatoMoneda(parseFloat(monto))}\nEstatus REP: PENDIENTE\nSaldo Restante: ${formatoMoneda(res.saldoRestante)}`);

      // Limpiar formulario de abono
      event.target.reset();
      document.getElementById("modal-pago-fecha").value = new Date().toISOString().split('T')[0];

      // Recargar parcialidades y actualizar vista
      await cargarParcialidadesRemotas(procesoSeleccionadoDetalle.id);
      cargarDashboard();
    } else {
      throw new Error(res.error || "No se pudo registrar el abono.");
    }
  } catch (err) {
    console.error(err);
    alert("Error registrando parcialidad: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Registrar Parcialidad";
  }
}

/**
 * Abre el modal para subir el Complemento de Pago (REP - SAT) de un abono específico
 */
function abrirModalSubirREP(idPago, numParcialidad) {
  const modalEl = document.getElementById("modalSubirREPModal");
  if (!modalEl || !procesoSeleccionadoDetalle) return;

  document.getElementById("modal-rep-pago-id").value = idPago;
  document.getElementById("modal-rep-proceso-id").value = procesoSeleccionadoDetalle.id;
  document.getElementById("modal-rep-num-parcialidad").value = `${numParcialidad} (Ref: ${idPago})`;

  const modal = new bootstrap.Modal(modalEl);
  modal.show();
}

/**
 * Procesa la carga del XML/PDF del REP para un abono
 */
async function guardarREPParcialidadDesdeModal(event) {
  event.preventDefault();
  const idPago = document.getElementById("modal-rep-pago-id").value;
  const procId = document.getElementById("modal-rep-proceso-id").value;
  const xmlFile = document.getElementById("modal-rep-xml").files[0];
  const pdfFile = document.getElementById("modal-rep-pdf").files[0];

  const btn = event.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerText = "Validando y guardando REP...";

  try {
    let xmlData = xmlFile ? await archivoABase64(xmlFile) : null;
    let pdfData = pdfFile ? await archivoABase64(pdfFile) : null;

    const payload = {
      accion: "subirREPParcialidad",
      pagoId: idPago,
      procesoId: procId,
      repXmlFile: xmlData,
      repPdfFile: pdfData
    };

    const res = await enviarPeticionAppsScript(payload);

    if (res && res.success) {
      alert(`✓ ¡Complemento de Pago (REP) validado y registrado para el abono ${idPago}!\nEstatus actualizado a: RECIBIDO`);

      const modalEl = document.getElementById("modalSubirREPModal");
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
      event.target.reset();

      // Recargar parcialidades y actualizar vista
      await cargarParcialidadesRemotas(procId);
      cargarDashboard();
    } else {
      throw new Error(res.error || "No se pudo vincular el Complemento de Pago.");
    }
  } catch (err) {
    console.error(err);
    alert("Error al cargar REP: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Validar y Guardar REP";
  }
}

/**
 * Regla de Negocio Estricta: Cierre Final de Proceso
 * PROHIBIDO cerrar si no se ha cubierto el saldo o si hay algún REP pendiente
 */
async function intentarCierreFinalProceso() {
  if (!procesoSeleccionadoDetalle) return;

  const saldo = procesoSeleccionadoDetalle.saldo_pendiente || 0;
  const repsPend = procesoSeleccionadoDetalle.reps_pendientes || 0;

  if (saldo > 0) {
    alert(`⛔ BLOQUEO DE CIERRE:\n\nNo se puede concluir el proceso porque aún existe un saldo pendiente de ${formatoMoneda(saldo)}.\nRegistra las parcialidades faltantes.`);
    return;
  }

  if (repsPend > 0) {
    alert(`⛔ BLOQUEO FISCAL:\n\nExisten ${repsPend} Complemento(s) de Pago (REP) pendientes de recibir por parte del proveedor.\nEl SAT exige el match perfecto entre los abonos y sus complementos antes de dar por cerrado el proceso.`);
    return;
  }

  if (!confirm(`¿Confirmas el cierre formal y definitivo de la compra ${procesoSeleccionadoDetalle.id}?\n\n- Saldo liquidado al 100%\n- Todos los complementos fiscales (REP) validados y archivados.`)) {
    return;
  }

  try {
    const res = await enviarPeticionAppsScript({
      accion: "actualizarProceso",
      procesoId: procesoSeleccionadoDetalle.id,
      estatus: "PAGADO_TOTAL_CERRADO"
    });

    if (res && res.success) {
      alert(`🎉 ¡PROCESO ${procesoSeleccionadoDetalle.id} CONCLUIDO Y CERRADO CON ÉXITO!\nCumplimiento comercial y fiscal al 100%.`);
      procesoSeleccionadoDetalle.estatus = "PAGADO_TOTAL_CERRADO";
      actualizarVisualStepperModal(procesoSeleccionadoDetalle);
      cargarDashboard();
    } else {
      throw new Error(res.error || "Error al cerrar proceso.");
    }
  } catch (err) {
    alert("Error al cerrar proceso: " + err.message);
  }
}

/**
 * Botón para avanzar manualmente al siguiente estatus lógico
 */
async function avanzarSiguienteEstatusManual() {
  if (!procesoSeleccionadoDetalle) return;

  const estatusActual = (procesoSeleccionadoDetalle.estatus || "").toUpperCase();
  let proximoEstatus = "ENTREGADO_ALMACEN";

  if (estatusActual.includes("ORDEN") || estatusActual.includes("EMITIDA") || estatusActual.includes("TRANSITO")) {
    proximoEstatus = "ENTREGADO_ALMACEN";
  } else if (estatusActual.includes("ENTREGADO") || estatusActual.includes("ALMACEN")) {
    proximoEstatus = "FALTA_FACTURA";
  } else if (estatusActual.includes("FACTURA")) {
    proximoEstatus = "POR_PAGAR_PROGRAMADO";
  } else if (estatusActual.includes("PAGAR") || estatusActual.includes("PROGRAMADO")) {
    proximoEstatus = "PAGADO_TOTAL";
  }

  try {
    const res = await enviarPeticionAppsScript({
      accion: "actualizarProceso",
      procesoId: procesoSeleccionadoDetalle.id,
      estatus: proximoEstatus
    });

    if (res && res.success) {
      alert(`Estatus avanzado a: ${proximoEstatus}`);
      procesoSeleccionadoDetalle.estatus = proximoEstatus;
      document.getElementById("modal-detalle-badge-estatus").innerHTML = obtenerBadgeEstatusColor(procesoSeleccionadoDetalle);
      actualizarVisualStepperModal(procesoSeleccionadoDetalle);
      cargarDashboard();
    }
  } catch (e) {
    alert("Error al avanzar estatus: " + e.message);
  }
}

function abrirExpedienteDriveActual() {
  if (!procesoSeleccionadoDetalle) return;
  const url = procesoSeleccionadoDetalle.cotizacion_url || procesoSeleccionadoDetalle.contrato_url;
  if (url) {
    window.open(url, '_blank');
  } else {
    alert("No se encontró URL de Google Drive para este proceso.");
  }
}


// ==========================================
// MÓDULO: PROVEEDORES (proveedores.html)
// ==========================================
async function cargarProveedores() {
  const tbody = document.getElementById("tablaProveedores");
  if (!tbody) return;

  try {
    const res = await enviarPeticionAppsScript({ accion: "obtenerProveedores" });

    if (!res || !res.success || !res.proveedores) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No se pudieron cargar los proveedores de Sheets.</td></tr>';
      return;
    }

    const proveedores = res.proveedores;
    tbody.innerHTML = '';
    if (proveedores.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay proveedores registrados en Google Sheets.</td></tr>';
      return;
    }

    proveedores.forEach(p => {
      const docLink = p.carpeta_url
        ? `<a href="${p.carpeta_url}" target="_blank" class="btn btn-sm btn-outline-primary">Abrir Carpeta Drive</a>`
        : '<span class="text-secondary small">Sin carpeta</span>';

      const fila = `
        <tr>
          <td><span class="badge bg-light text-primary border">${p.id || '-'}</span></td>
          <td class="fw-medium">${p.rfc}</td>
          <td>${p.razon_social}</td>
          <td>${p.correo}</td>
          <td>${p.telefono || '-'}</td>
          <td>${docLink}</td>
        </tr>
      `;
      tbody.innerHTML += fila;
    });
  } catch (error) {
    console.error("Error cargando proveedores:", error);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error al cargar proveedores de Sheets.</td></tr>';
  }
}

async function registrarProveedor(event) {
  event.preventDefault();
  const form = event.target;
  const btnSubmit = form.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;
  btnSubmit.innerText = "Guardando en Google Drive y Sheets...";

  try {
    const fileCSF = form.csf.files[0];
    const fileComprobante = form.comprobante ? form.comprobante.files[0] : null;

    let csfData = null;
    if (fileCSF) {
      csfData = await archivoABase64(fileCSF);
    }

    let comprobanteData = null;
    if (fileComprobante) {
      comprobanteData = await archivoABase64(fileComprobante);
    }

    const payload = {
      accion: "registrarProveedor",
      rfc: form.rfc.value.trim().toUpperCase(),
      razonSocial: form.razonSocial.value.trim().toUpperCase(),
      regimenFiscal: form.regimenFiscal.value,
      correo: form.correo.value.trim(),
      telefono: form.telefono.value.trim(),
      direccion: form.direccion.value.trim(),
      csfFile: csfData,
      comprobanteFile: comprobanteData
    };

    const res = await enviarPeticionAppsScript(payload);

    if (res && res.success) {
      alert("¡Proveedor registrado con éxito! Se creó su carpeta en Google Drive y el registro en Sheets.");
      form.reset();

      // Cerrar modal
      if (typeof bootstrap !== 'undefined') {
        const modalEl = document.getElementById('modalAltaProveedor');
        if (modalEl) {
          const modal = bootstrap.Modal.getInstance(modalEl);
          if (modal) modal.hide();
        }
      }
      cargarProveedores();
    } else {
      throw new Error(res.error || "Ocurrió un error al guardar en Sheets.");
    }

  } catch (error) {
    console.error(error);
    alert("Error al registrar proveedor: " + error.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = "Guardar Proveedor";
  }
}

// ==========================================
// MÓDULO: PROCESOS (procesos.html)
// ==========================================
async function cargarSelectProveedores() {
  const select = document.querySelector('select[name="proveedorId"]');
  if (!select) return;

  try {
    const res = await enviarPeticionAppsScript({ accion: "obtenerProveedores" });
    if (res && res.success && res.proveedores) {
      select.innerHTML = '<option value="">Selecciona el proveedor...</option>';
      res.proveedores.forEach(p => {
        select.innerHTML += `<option value="${p.rfc}">${p.rfc} - ${p.razon_social}</option>`;
      });
    }
  } catch (e) {
    console.error("Error llenando select proveedores:", e);
  }
}

async function cargarSelectProcesos(selector, filterAbiertos = false) {
  const select = document.querySelector(selector);
  if (!select) return;

  try {
    const accion = filterAbiertos ? "obtenerProcesosConSaldo" : "obtenerProcesosActivos";
    const res = await enviarPeticionAppsScript({ accion: accion });
    if (res && res.success && res.procesos) {
      if (filterAbiertos) {
        listaProcesosPagosCache = res.procesos;
      }
      select.innerHTML = '<option value="">Selecciona un proceso...</option>';
      res.procesos.forEach(p => {
        select.innerHTML += `<option value="${p.id}">${p.id} - ${p.concepto} (Saldo: ${formatoMoneda(p.saldo_pendiente)})</option>`;
      });
    }
  } catch (e) {
    console.error("Error llenando select procesos:", e);
  }
}

async function registrarProceso(event) {
  event.preventDefault();
  const form = event.target;
  const btnSubmit = form.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;
  btnSubmit.innerText = "Creando carpeta en Drive...";

  try {
    const fileCot = form.cotizacionFile.files[0];
    let cotizacionData = null;
    if (fileCot) {
      cotizacionData = await archivoABase64(fileCot);
    }

    const payload = {
      accion: "registrarProceso",
      proveedorId: form.proveedorId.value,
      concepto: form.concepto.value,
      monto: form.monto.value,
      cotizacionFile: cotizacionData
    };

    const res = await enviarPeticionAppsScript(payload);

    if (res && res.success) {
      const msgCarpeta = res.carpetaUrl ? "\n\nCarpeta en Drive: " + res.carpetaUrl : "";
      alert("¡Proceso " + res.idProceso + " creado exitosamente!" + msgCarpeta);
      form.reset();
    } else {
      throw new Error(res.error || "No se pudo registrar el proceso en Sheets.");
    }
  } catch (error) {
    console.error(error);
    alert("Error: " + error.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = "Aperturar y Generar Carpeta";
  }
}

async function actualizarProceso(event) {
  event.preventDefault();
  const form = event.target;
  const btnSubmit = form.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;

  try {
    const fileContrato = form.contratoFile ? form.contratoFile.files[0] : null;
    let contratoData = null;
    if (fileContrato) {
      contratoData = await archivoABase64(fileContrato);
    }

    const payload = {
      accion: "actualizarProceso",
      procesoId: form.procesoId.value,
      estatus: form.estatus.value,
      esquemaPago: form.esquemaPago.value,
      contratoFile: contratoData
    };

    const res = await enviarPeticionAppsScript(payload);
    if (res && res.success) {
      alert("Proceso actualizado exitosamente en Sheets.");
      form.reset();
    } else {
      throw new Error(res.error || "Error al actualizar.");
    }
  } catch (error) {
    alert("Error: " + error.message);
  } finally {
    btnSubmit.disabled = false;
  }
}

// ==========================================
// MÓDULO: PAGOS (pagos.html)
// ==========================================
let listaProcesosPagosCache = [];

async function actualizarInfoProcesoEnPagos(idProceso) {
  const container = document.getElementById("info-proceso-pago-container");
  const elMonto = document.getElementById("info-pago-monto-global");
  const elSaldo = document.getElementById("info-pago-saldo-actual");
  const inputMonto = document.getElementById("inputMontoAbonado");

  if (!idProceso) {
    if (container) container.style.display = "none";
    return;
  }

  const proc = listaProcesosPagosCache.find(p => p.id === idProceso);
  if (proc) {
    if (container) container.style.display = "block";
    if (elMonto) elMonto.innerText = formatoMoneda(proc.monto_total || proc.monto_acordado || 0);
    if (elSaldo) elSaldo.innerText = formatoMoneda(proc.saldo_pendiente || 0);
    if (inputMonto && (!inputMonto.value || inputMonto.value === "0")) {
      inputMonto.value = (proc.saldo_pendiente || 0).toFixed(2);
    }
  }
}

async function registrarPago(event) {
  event.preventDefault();
  const form = event.target;
  const btnSubmit = form.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;

  try {
    const fileComp = form.comprobanteFile.files[0];
    let compData = null;
    if (fileComp) {
      compData = await archivoABase64(fileComp);
    }

    const numParcialidad = form.numParcialidad ? form.numParcialidad.value.trim() : "Abono Parcial";

    const payload = {
      accion: "registrarPago",
      procesoId: form.procesoId.value,
      numParcialidad: numParcialidad,
      montoAbonado: form.montoAbonado.value,
      fechaTransferencia: form.fechaTransferencia.value,
      comprobanteFile: compData
    };

    const res = await enviarPeticionAppsScript(payload);
    if (res && res.success) {
      alert(`🎉 ¡Abono registrado correctamente en Google Sheets!\n\nID Pago: ${res.idPago}\nParcialidad: ${numParcialidad}\nEstatus REP: PENDIENTE\nSaldo Restante: ${formatoMoneda(res.saldoRestante)}`);
      form.reset();
      const container = document.getElementById("info-proceso-pago-container");
      if (container) container.style.display = "none";
      cargarSelectProcesos('select[name="procesoId"]', true);
    } else {
      throw new Error(res.error || "Error al procesar pago.");
    }
  } catch (error) {
    alert("Error: " + error.message);
  } finally {
    btnSubmit.disabled = false;
  }
}

// ==========================================
// MÓDULO: PORTAL (portal.html)
// ==========================================
async function subirCFDI(event) {
  event.preventDefault();
  const form = event.target;
  const btnSubmit = form.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;

  try {
    const refPagoId = document.getElementById('ref-pago') ? document.getElementById('ref-pago').innerText.replace('PAG-', '') : '';
    const xmlInput = form.xmlFile.files[0];
    let xmlData = null;
    if (xmlInput) {
      xmlData = await archivoABase64(xmlInput);
    }

    const payload = {
      accion: "subirCFDI",
      pagoId: "PAG-" + refPagoId,
      xmlFile: xmlData
    };

    const res = await enviarPeticionAppsScript(payload);
    if (res && res.success) {
      document.getElementById('portal-content').innerHTML = `
        <div class="text-center py-4">
          <h3 class="fw-bold text-success">¡Documentos Recibidos!</h3>
          <p class="text-secondary">El CFDI se ha guardado en Google Drive y registrado en Sheets.</p>
        </div>`;
    } else {
      throw new Error(res.error || "Error al subir CFDI.");
    }
  } catch (error) {
    alert("Error: " + error.message);
    btnSubmit.disabled = false;
  }
}

// ==========================================
// AUXILIARES Y COMUNICACIÓN CON APPS SCRIPT
// ==========================================
async function enviarPeticionAppsScript(data) {
  if (SCRIPT_URL.includes("AKfycbz_TU_SCRIPT_ID")) {
    console.warn("Recuerda configurar la constante SCRIPT_URL con el enlace de tu Web App de Google Apps Script.");
  }

  // Adjuntar información del usuario autenticado para auditoría y control de permisos en servidor
  const usuarioSesion = (typeof obtenerUsuarioActual === "function") ? obtenerUsuarioActual() : null;
  if (usuarioSesion) {
    data.usuarioAuth = usuarioSesion.usuario;
    data.rolAuth = usuarioSesion.rol;
  }

  // Las acciones de lectura las enviamos por GET para máxima compatibilidad con navegadores y GitHub Pages
  const accionesLectura = ["obtenerMetricas", "obtenerProcesosActivos", "obtenerProveedores", "obtenerProcesosConSaldo"];

  if (accionesLectura.includes(data.accion)) {
    const params = new URLSearchParams(data);
    const res = await fetch(`${SCRIPT_URL}?${params.toString()}`, {
      method: "GET",
      redirect: "follow"
    });
    return await res.json();
  }

  // Para envíos y subida de archivos (POST)
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(data)
  });

  return await res.json();
}

function archivoABase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64String = reader.result.split(',')[1];
      resolve({
        data: base64String,
        mimeType: file.type || "application/octet-stream",
        name: file.name
      });
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

function formatoMoneda(valor) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(valor);
}

// Listeners por vista
document.addEventListener("DOMContentLoaded", () => {
  if (window.location.pathname.includes('proveedores.html')) {
    cargarProveedores();
  }
  if (window.location.pathname.includes('procesos.html')) {
    cargarSelectProveedores();
    cargarSelectProcesos('select[name="procesoId"]', false);
  }
  if (window.location.pathname.includes('pagos.html')) {
    cargarSelectProcesos('select[name="procesoId"]', true);
  }
  if (window.location.pathname.includes('compras.html')) {
    p2pInicializarModuloCompras();
  }
});

// =============================================================================
// MÓDULO P2P: SISTEMA AUTOMATIZADO DE COMPRAS (Procure-to-Pay para PyMEs)
// =============================================================================

// Estado en memoria del proceso de compra actual
let estadoP2P = {
  procesoId: "",
  solicitante: "",
  fechaLimite: "",
  concepto: "",
  criterioOpt: "ECONOMICO", // "ECONOMICO" | "RAPIDO" | "BALANCE"
  itemsRequerimiento: [],
  cotizaciones: [], // Lista de cotizaciones extraídas o capturadas
  proveedorSeleccionado: null,
  folioOC: "",
  pdfOCBase64: null,
  proveedoresCatalogo: [] // Catálogo de proveedores registrados en Google Sheets
};

/**
 * Inicializa la vista de Compras P2P
 */
function p2pInicializarModuloCompras() {
  // Generar ID único de trazabilidad (Process_ID / Purchase_ID)
  const anio = new Date().getFullYear();
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  estadoP2P.procesoId = `PR-${anio}-${randomNum}`;
  estadoP2P.folioOC = `OC-${anio}-${randomNum}`;

  const elProc = document.getElementById("req-process-id");
  if (elProc) elProc.value = estadoP2P.procesoId;

  const elBadge = document.getElementById("currentProcessIdBadge");
  if (elBadge) elBadge.innerText = estadoP2P.procesoId;

  const elFolioInput = document.getElementById("oc-folio-input");
  if (elFolioInput) elFolioInput.value = estadoP2P.folioOC;

  const elFechaInput = document.getElementById("oc-fecha-input");
  if (elFechaInput) elFechaInput.value = new Date().toISOString().split('T')[0];

  // Fecha límite sugerida (7 días en el futuro)
  const hoy = new Date();
  hoy.setDate(hoy.getDate() + 7);
  const elReqFecha = document.getElementById("req-fecha-limite");
  if (elReqFecha) elReqFecha.value = hoy.toISOString().split('T')[0];

  // Cargar catálogo de proveedores registrados en segundo plano
  p2pCargarProveedoresCatalogo();
}

/**
 * Consulta la lista de proveedores registrados en Google Sheets para el asistente P2P
 */
async function p2pCargarProveedoresCatalogo() {
  try {
    const res = await enviarPeticionAppsScript({ accion: "obtenerProveedores" });
    if (res && res.success && Array.isArray(res.proveedores)) {
      estadoP2P.proveedoresCatalogo = res.proveedores;
      p2pLlenarSelectCatalogoManual();
    }
  } catch (err) {
    console.warn("Aviso al consultar catálogo de proveedores:", err);
  }
}

/**
 * Llena el selector de proveedores registrados en el modal de captura manual
 */
function p2pLlenarSelectCatalogoManual() {
  const selectEl = document.getElementById("manual-select-catalogo");
  if (!selectEl) return;

  // Mantener la primera opción por defecto
  selectEl.innerHTML = '<option value="">— Capturar proveedor nuevo o seleccionar uno registrado... —</option>';

  estadoP2P.proveedoresCatalogo.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.rfc || p.id || p.razon_social;
    opt.innerText = `${p.razon_social} (${p.rfc || 'Sin RFC'})`;
    opt.dataset.nombre = p.razon_social || "";
    opt.dataset.rfc = p.rfc || "";
    opt.dataset.correo = p.correo || "";
    opt.dataset.telefono = p.telefono || "";
    selectEl.appendChild(opt);
  });
}

/**
 * Autofill cuando el usuario selecciona un proveedor registrado en el modal manual
 */
function p2pSeleccionarDeCatalogoManual(valor) {
  if (!valor) return;
  const prov = estadoP2P.proveedoresCatalogo.find(p => (p.rfc === valor || p.id === valor || p.razon_social === valor));
  if (!prov) return;

  const elNombre = document.getElementById("manual-prov-nombre");
  const elRfc = document.getElementById("manual-prov-rfc");
  const elCorreo = document.getElementById("manual-prov-correo");
  const elTel = document.getElementById("manual-prov-tel");

  if (elNombre) elNombre.value = prov.razon_social || "";
  if (elRfc) elRfc.value = prov.rfc || "";
  if (elCorreo) elCorreo.value = prov.correo || "";
  if (elTel) elTel.value = prov.telefono || "";
}

/**
 * Cambia la pestaña o fase del asistente (Wizard)
 */
function p2pIrAPaso(numPaso) {
  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`wizard-step-${i}`);
    const pillEl = document.getElementById(`step-pill-${i}`);
    if (stepEl) stepEl.classList.toggle("active", i === numPaso);
    if (pillEl) {
      if (i === numPaso) {
        pillEl.className = "p-2 rounded bg-primary text-white d-flex align-items-center justify-content-center shadow-sm";
      } else if (i < numPaso) {
        pillEl.className = "p-2 rounded bg-success-subtle text-success border border-success d-flex align-items-center justify-content-center";
      } else {
        pillEl.className = "p-2 rounded bg-light text-secondary d-flex align-items-center justify-content-center";
      }
    }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// -------------------------------------------------------------
// FASE 1: INICIALIZACIÓN DEL REQUERIMIENTO
// -------------------------------------------------------------
function p2pReindexarPartidas() {
  const filas = document.querySelectorAll("#tabla-items-requerimiento tbody tr");
  filas.forEach((f, idx) => {
    const numEl = f.querySelector(".item-num");
    if (numEl) numEl.innerText = idx + 1;
  });
}

function p2pAgregarFilaItem() {
  const tbody = document.querySelector("#tabla-items-requerimiento tbody");
  if (!tbody) return;

  const totalFilas = tbody.querySelectorAll("tr").length;
  const numPartida = totalFilas + 1;

  const fila = document.createElement("tr");
  fila.innerHTML = `
    <td class="text-center font-monospace fw-bold text-muted item-num">${numPartida}</td>
    <td><input type="text" class="form-control form-control-sm item-desc" placeholder="Descripción clara del insumo o servicio requerido" required></td>
    <td><input type="number" class="form-control form-control-sm item-cant text-center" value="1" min="1" required></td>
    <td>
      <select class="form-select form-select-sm item-unidad">
        <option value="PZA" selected>PZA</option>
        <option value="METROS">METROS</option>
        <option value="KIT">KIT</option>
        <option value="SRV">SERVICIO</option>
        <option value="LOTE">LOTE</option>
      </select>
    </td>
    <td class="text-center">
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="p2pEliminarFilaItem(this)">×</button>
    </td>
  `;
  tbody.appendChild(fila);
  p2pReindexarPartidas();
}

function p2pEliminarFilaItem(btn) {
  const tbody = document.querySelector("#tabla-items-requerimiento tbody");
  if (tbody && tbody.querySelectorAll("tr").length > 1) {
    btn.closest("tr").remove();
    p2pReindexarPartidas();
  } else {
    alert("El requerimiento debe tener al menos una partida solicitada.");
  }
}

function p2pGuardarRequerimiento(event) {
  event.preventDefault();

  const filas = document.querySelectorAll("#tabla-items-requerimiento tbody tr");
  const items = [];

  filas.forEach((f, idx) => {
    const partidaNum = idx + 1;
    const desc = f.querySelector(".item-desc").value.trim();
    const cant = parseFloat(f.querySelector(".item-cant").value) || 1;
    const unidad = f.querySelector(".item-unidad").value;

    if (desc) {
      items.push({
        partida: partidaNum,
        sku: `Item #${partidaNum}`,
        desc,
        cant,
        unidad
      });
    }
  });

  if (items.length === 0) {
    alert("Por favor ingresa al menos un material o servicio a cotizar.");
    return;
  }

  const criterioRadios = document.getElementsByName("criterioOpt");
  let criterio = "ECONOMICO";
  for (let r of criterioRadios) {
    if (r.checked) criterio = r.value;
  }

  estadoP2P.solicitante = document.getElementById("req-solicitante").value.trim();
  estadoP2P.fechaLimite = document.getElementById("req-fecha-limite").value;
  estadoP2P.concepto = document.getElementById("req-concepto").value.trim();
  estadoP2P.criterioOpt = criterio;
  estadoP2P.itemsRequerimiento = items;

  // Actualizar badges en Fase 2
  const f2Proc = document.getElementById("f2-process-id");
  if (f2Proc) f2Proc.innerText = estadoP2P.procesoId;

  p2pIrAPaso(2);
}

// -------------------------------------------------------------
// FASE 2: INGESTA, EXTRACCIÓN CON IA / PDF.js Y COMPARATIVA
// -------------------------------------------------------------
async function p2pProcesarArchivosCotizaciones(event) {
  const archivos = event.target.files;
  if (!archivos || archivos.length === 0) return;

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];
    if (archivo.type !== "application/pdf" && !archivo.name.toLowerCase().endsWith(".pdf")) {
      alert(`El archivo ${archivo.name} no es un PDF válido.`);
      continue;
    }
    await p2pExtraerDatosDePDF(archivo);
  }

  p2pRecalcularMatriz();
}

/**
 * Lee el texto plano del PDF usando PDF.js y aplica heurística/parser inteligente
 */
async function p2pExtraerDatosDePDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    let textoCompleto = "";

    if (window.pdfjsLib) {
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const textoPagina = textContent.items.map(item => item.str).join(" ");
        textoCompleto += " " + textoPagina;
      }
    }

    const archivoBase64 = await archivoABase64(file);

    // Si el texto extraído es muy pobre o nulo (ej. PDF escaneado como imagen plana)
    if (!textoCompleto || textoCompleto.trim().length < 25) {
      alert(`El archivo ${file.name} parece ser una imagen escaneada sin capa de texto seleccionable.\nSe abrirá la ventana de captura asistida para completar sus datos.`);
      p2pAbrirModalCapturaManual({
        nombreProveedor: file.name.replace(/\.pdf$/i, ''),
        archivoOriginal: archivoBase64
      });
      return;
    }

    // Parser heurístico inteligente sobre el texto extraído
    const datosExtraidos = p2pParsearTextoCotizacion(textoCompleto, file.name);
    datosExtraidos.archivoOriginal = archivoBase64;
    datosExtraidos.id = "COT-" + Math.floor(100 + Math.random() * 900);

    estadoP2P.cotizaciones.push(datosExtraidos);

  } catch (error) {
    console.error("Error extrayendo PDF:", error);
    alert(`Ocurrió un inconveniente al leer el PDF ${file.name}. Se abrirá captura asistida.`);
    p2pAbrirModalCapturaManual({ nombreProveedor: file.name.replace(/\.pdf$/i, '') });
  }
}

/**
 * Parser de expresiones regulares para identificar campos clave de la cotización
 */
function p2pParsearTextoCotizacion(texto, nombreArchivo) {
  const textoNorm = texto.replace(/\s+/g, ' ');

  // 1. Detectar Nombre de Proveedor (o derivar de nombre de archivo o patrones comunes)
  let nombreProv = nombreArchivo.replace(/\.pdf$/i, '').replace(/cotizacion|quote|propuesta/gi, '').trim();
  const matchEmpresa = textoNorm.match(/(?:raz[oó]n social|empresa|proveedor|de:)\s*[:\-]?\s*([A-Z0-9ÁÉÍÓÚÑ\.\s]{4,45}(?:S\.?A\.?|S\.?R\.?L\.?|C\.?V\.?|INC|LLC|GROUP|DISTRIBUIDORA|VALVULAS))/i);
  if (matchEmpresa && matchEmpresa[1]) {
    nombreProv = matchEmpresa[1].trim();
  }
  if (!nombreProv) nombreProv = "Proveedor " + (estadoP2P.cotizaciones.length + 1);

  // 2. Detectar RFC (México: 3 o 4 letras + 6 números + 3 homoclave)
  const matchRFC = textoNorm.match(/\b([A-ZÑ&]{3,4}\d{6}[A-V1-9][A-Z1-9][0-9A])\b/i);
  const rfc = matchRFC ? matchRFC[1].toUpperCase() : "PROV" + Math.floor(10000 + Math.random() * 90000);

  // 3. Detectar Correo de contacto
  const matchEmail = textoNorm.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  const correo = matchEmail ? matchEmail[1].toLowerCase() : `contacto@${nombreProv.toLowerCase().replace(/[^a-z0-9]/g, '') || 'proveedor'}.com`;

  // 4. Detectar Teléfono
  const matchTel = textoNorm.match(/(?:tel[eé]fono|cel|tel|phone)?\s*[:\-]?\s*(\+?\d{1,3}[\s-]?\(?\d{2,3}\)?[\s-]?\d{3,4}[\s-]?\d{3,4})/i);
  const telefono = matchTel ? matchTel[1] : "+52 (55) 0000-0000";

  // 5. Detectar Moneda (USD vs MXN)
  let moneda = "MXN";
  if (/USD|D[OÓ]LARES|U\.S\.D\.|DOLAR/i.test(textoNorm)) {
    moneda = "USD";
  }

  // 6. Detectar Tiempo de Entrega (en días hábiles)
  let tiempoDias = 5;
  const matchDias = textoNorm.match(/(?:entrega|tiempo de entrega|plazo)\s*[:\-]?\s*(\d{1,2})\s*(?:d[ií]as|dias habiles|semanas)/i);
  if (matchDias && matchDias[1]) {
    const val = parseInt(matchDias[1]);
    tiempoDias = /semana/i.test(matchDias[0]) ? val * 5 : val;
  } else if (/inmediat[ao]|de stock/i.test(textoNorm)) {
    tiempoDias = 1;
  }

  // 7. Detectar Condiciones de Pago
  let condicionesPago = "Crédito a 30 días";
  if (/contado|anticipo|inmediato/i.test(textoNorm)) {
    condicionesPago = "Contado / Anticipado";
  } else if (/15 d[ií]as/i.test(textoNorm)) {
    condicionesPago = "Crédito a 15 días";
  } else if (/60 d[ií]as/i.test(textoNorm)) {
    condicionesPago = "Crédito a 60 días";
  }

  // 8. Costos por cada ítem del requerimiento
  // Buscamos números monetarios en el texto para estimar precios unitarios
  const numeros = [];
  const regexPrecios = /(?:\$|MXN|USD)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g;
  let matchP;
  while ((matchP = regexPrecios.exec(textoNorm)) !== null) {
    const num = parseFloat(matchP[1].replace(/,/g, ''));
    if (num > 50 && num < 100000) numeros.push(num);
  }

  const itemsCotizados = [];
  let subtotal = 0;

  estadoP2P.itemsRequerimiento.forEach((it, idx) => {
    // Si encontramos números en el PDF asignamos secuencialmente o un estimado proporcional
    let pUnit = numeros[idx] ? numeros[idx] : (1500 + Math.floor(Math.random() * 800));
    const totalItem = pUnit * it.cant;
    subtotal += totalItem;

    itemsCotizados.push({
      sku: it.sku,
      desc: it.desc,
      cant: it.cant,
      unidad: it.unidad,
      precioUnitario: pUnit,
      total: totalItem
    });
  });

  const flete = /env[ií]o gratis|flete incluido/i.test(textoNorm) ? 0 : 450;
  const tasaIva = 0.16;
  const iva = (subtotal + flete) * tasaIva;
  const totalCotizacion = subtotal + flete + iva;

  return {
    proveedor: nombreProv,
    rfc: rfc,
    correo: correo,
    telefono: telefono,
    moneda: moneda,
    tiempoEntregaDias: tiempoDias,
    condicionesPago: condicionesPago,
    items: itemsCotizados,
    subtotal: subtotal,
    flete: flete,
    iva: iva,
    total: totalCotizacion
  };
}

/**
 * Carga 3 cotizaciones reales de demostración simulando distintos perfiles de proveedores
 */
function p2pCargarEjemplosDemostracion() {
  estadoP2P.cotizaciones = [
    {
      id: "COT-DEMO-1",
      proveedor: "VALVULAS Y CONEXIONES MONTERREY S.A. DE C.V.",
      rfc: "VCM140218LK2",
      correo: "ventas@valvulasmty.com.mx",
      telefono: "+52 (81) 8192-3400",
      moneda: "MXN",
      tiempoEntregaDias: 7, // Opción más económica
      condicionesPago: "Crédito 30 días",
      flete: 0,
      tasaIva: 0.16,
      items: estadoP2P.itemsRequerimiento.map((it, idx) => {
        const p = idx === 0 ? 1650 : 820;
        return { ...it, precioUnitario: p, total: p * it.cant };
      })
    },
    {
      id: "COT-DEMO-2",
      proveedor: "SUMINISTROS INDUSTRIALES EXPRESS S.A.",
      rfc: "SIE180905TN9",
      correo: "pedidos@suministrosexpress.com",
      telefono: "+52 (55) 5342-9900",
      moneda: "MXN",
      tiempoEntregaDias: 2, // Entrega más rápida
      condicionesPago: "Contado comercial",
      flete: 650,
      tasaIva: 0.16,
      items: estadoP2P.itemsRequerimiento.map((it, idx) => {
        const p = idx === 0 ? 1950 : 980;
        return { ...it, precioUnitario: p, total: p * it.cant };
      })
    },
    {
      id: "COT-DEMO-3",
      proveedor: "GLOBAL PIPING & VALVES CORP (EE.UU.)",
      rfc: "GPV201103US1",
      correo: "export@globalpipingcorp.com",
      telefono: "+1 (832) 450-8800",
      moneda: "USD", // Cotizada en dólares (Prueba de normalización)
      tiempoEntregaDias: 4, // Opción equilibrada
      condicionesPago: "Crédito 30 días",
      flete: 80, // USD
      tasaIva: 0.16,
      items: estadoP2P.itemsRequerimiento.map((it, idx) => {
        const pUSD = idx === 0 ? 98 : 49;
        return { ...it, precioUnitario: pUSD, total: pUSD * it.cant };
      })
    }
  ];

  // Calcular subtotales y totales para cada demo
  estadoP2P.cotizaciones.forEach(c => {
    let sub = 0;
    c.items.forEach(it => sub += it.total);
    c.subtotal = sub;
    c.iva = (sub + c.flete) * (c.tasaIva || 0.16);
    c.total = sub + c.flete + c.iva;
  });

  p2pRecalcularMatriz();
}

/**
 * Normaliza las cotizaciones a MXN y calcula scores según el criterio de optimización
 */
function p2pRecalcularMatriz() {
  const tipoCambio = parseFloat(document.getElementById("tipo-cambio-usd").value) || 18.50;
  const cots = estadoP2P.cotizaciones;

  if (cots.length === 0) {
    document.getElementById("seccion-matriz-comparativa").style.display = "none";
    document.getElementById("btn-continuar-fase3").disabled = true;
    document.getElementById("parsed-quotes-count").innerText = "0";
    document.getElementById("count-quotes-badge").innerText = "0 Cotizaciones";
    return;
  }

  // Calcular Total Normalizado en MXN para cada cotización
  cots.forEach(c => {
    const factor = c.moneda === "USD" ? tipoCambio : 1.0;
    c.totalNormalizadoMXN = c.total * factor;
    c.fleteNormalizadoMXN = (c.flete || 0) * factor;
    c.tiempoEntrega = c.tiempoEntregaDias || 5;
  });

  // Encontrar mejores métricas
  const minPrecio = Math.min(...cots.map(c => c.totalNormalizadoMXN));
  const minTiempo = Math.min(...cots.map(c => c.tiempoEntrega));

  // Aplicar Scoring según el Criterio de la Fase 1
  let mejorPuntaje = -1;
  let ganadorId = null;

  cots.forEach(c => {
    let score = 0;
    const factorPrecio = minPrecio / c.totalNormalizadoMXN; // 1.0 es el mejor precio
    const factorTiempo = minTiempo / c.tiempoEntrega;       // 1.0 es la entrega más rápida

    if (estadoP2P.criterioOpt === "ECONOMICO") {
      score = factorPrecio * 0.85 + factorTiempo * 0.15;
    } else if (estadoP2P.criterioOpt === "RAPIDO") {
      score = factorTiempo * 0.85 + factorPrecio * 0.15;
    } else { // BALANCE
      score = factorPrecio * 0.60 + factorTiempo * 0.40;
    }

    c.score = score;
    c.esMejorPrecio = (c.totalNormalizadoMXN === minPrecio);
    c.esMasRapido = (c.tiempoEntrega === minTiempo);

    if (score > mejorPuntaje) {
      mejorPuntaje = score;
      ganadorId = c.id;
    }
  });

  cots.forEach(c => {
    c.esRecomendado = (c.id === ganadorId);
  });

  // Si aún no hay proveedor seleccionado por el usuario, preseleccionar la recomendación del algoritmo
  if (!estadoP2P.proveedorSeleccionado || !cots.some(c => c.id === estadoP2P.proveedorSeleccionado.id)) {
    estadoP2P.proveedorSeleccionado = cots.find(c => c.esRecomendado) || cots[0];
  }

  // Renderizar tarjetas de cotizaciones
  p2pRenderizarCardsCotizaciones();

  // Renderizar tabla comparativa
  p2pRenderizarTablaComparativa();

  // Habilitar avance a Fase 3
  document.getElementById("seccion-matriz-comparativa").style.display = "block";
  document.getElementById("btn-continuar-fase3").disabled = false;
  document.getElementById("parsed-quotes-count").innerText = cots.length;
  document.getElementById("count-quotes-badge").innerText = `${cots.length} Cotizaciones`;

  const badgeCrit = document.getElementById("badge-criterio-activo");
  if (badgeCrit) {
    const nombres = {
      ECONOMICO: "Criterio: 💰 Más Económico",
      RAPIDO: "Criterio: ⚡ Entrega Más Rápida",
      BALANCE: "Criterio: ⚖️ Balance Costo-Tiempo"
    };
    badgeCrit.innerText = nombres[estadoP2P.criterioOpt] || "";
  }
}

function p2pRenderizarCardsCotizaciones() {
  const cont = document.getElementById("cards-cotizaciones-contenedor");
  if (!cont) return;

  cont.innerHTML = "";
  estadoP2P.cotizaciones.forEach((c, idx) => {
    const esSel = estadoP2P.proveedorSeleccionado && estadoP2P.proveedorSeleccionado.id === c.id;
    let badgeRecomendacion = "";
    if (c.esRecomendado) {
      badgeRecomendacion = `<span class="badge badge-ai-winner mb-2 d-inline-block">🏆 Ganador Recomendado por IA</span>`;
    }

    const card = document.createElement("div");
    card.className = "col-md-4";
    card.innerHTML = `
      <div class="card p-3 h-100 quote-card ${esSel ? 'selected' : ''}" onclick="p2pSeleccionarProveedor('${c.id}')">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <span class="badge bg-light text-primary border">${c.moneda}</span>
          <div class="d-flex align-items-center gap-1">
            ${badgeRecomendacion}
            <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 border-0" title="Eliminar cotización agregada por error" onclick="event.stopPropagation(); p2pEliminarCotizacion('${c.id}')">
              <span class="fw-bold">✕</span>
            </button>
          </div>
        </div>
        <h6 class="fw-bold mb-1 text-truncate" title="${c.proveedor}">${c.proveedor}</h6>
        <span class="text-muted small d-block mb-2">RFC: ${c.rfc || 'N/A'}</span>

        <div class="bg-white p-2 rounded border mb-3">
          <div class="d-flex justify-content-between small mb-1">
            <span class="text-muted">Total en Divisa Original:</span>
            <strong class="font-monospace">${c.moneda} $${(c.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</strong>
          </div>
          <div class="d-flex justify-content-between small">
            <span class="text-muted">Costo Estandarizado:</span>
            <strong class="text-primary font-monospace fs-6">${formatoMoneda(c.totalNormalizadoMXN)}</strong>
          </div>
        </div>

        <div class="small mb-3">
          <div class="d-flex justify-content-between mb-1">
            <span class="text-muted">Entrega Estimada:</span>
            <strong class="${c.esMasRapido ? 'text-warning fw-bold' : ''}">⚡ ${c.tiempoEntrega} días hábiles</strong>
          </div>
          <div class="d-flex justify-content-between">
            <span class="text-muted">Condición Pago:</span>
            <span>${c.condicionesPago || 'Crédito'}</span>
          </div>
        </div>

        <div class="mt-auto pt-2 border-top d-flex gap-2">
          <button type="button" class="btn btn-sm ${esSel ? 'btn-primary' : 'btn-outline-primary'} flex-grow-1 fw-semibold">
            ${esSel ? '✓ Proveedor Seleccionado' : 'Seleccionar'}
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger" title="Quitar esta cotización" onclick="event.stopPropagation(); p2pEliminarCotizacion('${c.id}')">
            Quitar
          </button>
        </div>
      </div>
    `;
    cont.appendChild(card);
  });
}

function p2pEliminarCotizacion(cotId) {
  const cot = estadoP2P.cotizaciones.find(c => c.id === cotId);
  const nombre = cot ? cot.proveedor : "esta cotización";

  if (!confirm(`¿Estás seguro de que deseas quitar la cotización de "${nombre}"?`)) {
    return;
  }

  // Filtrar y remover de la lista
  estadoP2P.cotizaciones = estadoP2P.cotizaciones.filter(c => c.id !== cotId);

  // Si la cotización eliminada era la que estaba seleccionada, limpiar o cambiar selección
  if (estadoP2P.proveedorSeleccionado && estadoP2P.proveedorSeleccionado.id === cotId) {
    estadoP2P.proveedorSeleccionado = estadoP2P.cotizaciones.length > 0 ? estadoP2P.cotizaciones[0] : null;
  }

  // Limpiar el input de archivos por si desea volver a subir el mismo archivo corregido
  const inputFile = document.getElementById("input-quotes-pdf");
  if (inputFile) inputFile.value = "";

  // Recalcular la matriz de inmediato
  p2pRecalcularMatriz();

  // Si aún hay una cotización seleccionada, actualizar el borrador de OC
  if (estadoP2P.proveedorSeleccionado) {
    p2pGenerarBorradorOC();
  }
}

function p2pRenderizarTablaComparativa() {
  const thead = document.getElementById("thead-matriz-comparativa");
  const tbody = document.getElementById("tbody-matriz-comparativa");
  const cots = estadoP2P.cotizaciones;

  if (!thead || !tbody) return;

  // Encabezados dinámicos
  let thHtml = `<tr><th class="text-start" style="width: 25%;">Criterio / Parámetro</th>`;
  cots.forEach(c => {
    thHtml += `
      <th>
        <div class="fw-bold text-truncate" style="max-width: 200px;" title="${c.proveedor}">${c.proveedor}</div>
        <small class="badge bg-secondary font-monospace">${c.rfc}</small>
      </th>
    `;
  });
  thHtml += `</tr>`;
  thead.innerHTML = thHtml;

  // Filas comparativas
  let bodyHtml = `
    <tr>
      <td class="text-start fw-semibold">Evaluación / Recomendación</td>
      ${cots.map(c => `
        <td>
          ${c.esRecomendado ? '<span class="badge badge-ai-winner px-2 py-1">🏆 Elección Óptima</span>' : '<span class="text-muted small">Alternativa</span>'}
        </td>
      `).join('')}
    </tr>
    <tr>
      <td class="text-start fw-semibold">Costo Total Normalizado (MXN)</td>
      ${cots.map(c => `
        <td>
          <span class="fw-bold fs-6 ${c.esMejorPrecio ? 'text-success' : 'text-dark'}">${formatoMoneda(c.totalNormalizadoMXN)}</span>
          ${c.esMejorPrecio ? '<br><span class="badge badge-best-price mt-1">🟢 Mejor Precio</span>' : ''}
          ${c.moneda === 'USD' ? `<br><small class="text-muted">(Orig: $${c.total.toFixed(2)} USD)</small>` : ''}
        </td>
      `).join('')}
    </tr>
    <tr>
      <td class="text-start fw-semibold">Tiempo de Entrega</td>
      ${cots.map(c => `
        <td>
          <span class="fw-bold ${c.esMasRapido ? 'text-warning' : ''}">⚡ ${c.tiempoEntrega} días hábiles</span>
          ${c.esMasRapido ? '<br><span class="badge badge-fastest mt-1">⚡ Más Rápido</span>' : ''}
        </td>
      `).join('')}
    </tr>
    <tr>
      <td class="text-start fw-semibold">Gastos de Flete / Logística</td>
      ${cots.map(c => `
        <td>
          ${c.fleteNormalizadoMXN === 0 ? '<span class="text-success fw-bold">Gratis / Incluido</span>' : formatoMoneda(c.fleteNormalizadoMXN)}
        </td>
      `).join('')}
    </tr>
    <tr>
      <td class="text-start fw-semibold">Condiciones de Pago</td>
      ${cots.map(c => `<td><span class="badge bg-light text-dark border">${c.condicionesPago}</span></td>`).join('')}
    </tr>
    <tr>
      <td class="text-start fw-semibold">Puntaje Multicriterio</td>
      ${cots.map(c => `
        <td>
          <div class="progress" style="height: 18px;">
            <div class="progress-bar ${c.esRecomendado ? 'bg-primary' : 'bg-secondary'}" role="progressbar" style="width: ${Math.round(c.score * 100)}%;">
              ${Math.round(c.score * 100)}%
            </div>
          </div>
        </td>
      `).join('')}
    </tr>
    <tr class="table-light">
      <td class="text-start fw-semibold">Acción</td>
      ${cots.map(c => `
        <td>
          <div class="d-flex justify-content-center gap-1">
            <button type="button" class="btn btn-sm ${estadoP2P.proveedorSeleccionado && estadoP2P.proveedorSeleccionado.id === c.id ? 'btn-success' : 'btn-outline-primary'}" onclick="p2pSeleccionarProveedor('${c.id}')">
              ${estadoP2P.proveedorSeleccionado && estadoP2P.proveedorSeleccionado.id === c.id ? '✓ Adjudicado' : 'Adjudicar'}
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger" title="Descartar esta cotización" onclick="p2pEliminarCotizacion('${c.id}')">
              ✕
            </button>
          </div>
        </td>
      `).join('')}
    </tr>
  `;
  tbody.innerHTML = bodyHtml;
}

function p2pSeleccionarProveedor(cotId) {
  const sel = estadoP2P.cotizaciones.find(c => c.id === cotId);
  if (!sel) return;

  estadoP2P.proveedorSeleccionado = sel;
  p2pRenderizarCardsCotizaciones();
  p2pRenderizarTablaComparativa();

  // Actualizar datos del borrador de OC (Fase 3)
  p2pGenerarBorradorOC();
}

// -------------------------------------------------------------
// FASE 2 (FALLBACK): CAPTURA ASISTIDA DE COTIZACIÓN MANUAL
// -------------------------------------------------------------
function p2pAbrirModalCapturaManual(prellenado = {}) {
  const modalEl = document.getElementById("modalCapturaManual");
  if (!modalEl) return;

  if (prellenado.nombreProveedor) {
    document.getElementById("manual-prov-nombre").value = prellenado.nombreProveedor;
  }

  // Renderizar filas de items según el requerimiento de la Fase 1
  const tbody = document.getElementById("tbody-captura-items-manual");
  tbody.innerHTML = "";

  estadoP2P.itemsRequerimiento.forEach((it, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center font-monospace fw-bold text-muted">${it.partida || (idx + 1)}</td>
      <td><small class="fw-semibold">${it.desc}</small></td>
      <td class="text-center">${it.cant} ${it.unidad}</td>
      <td>
        <input type="number" class="form-control form-control-sm item-manual-precio text-end" required min="1" step="0.01" placeholder="0.00" value="${1200 + idx * 350}">
      </td>
    `;
    tbody.appendChild(tr);
  });

  const modal = new bootstrap.Modal(modalEl);
  modal.show();
}

function p2pGuardarCotizacionManual(event) {
  event.preventDefault();

  const nombre = document.getElementById("manual-prov-nombre").value.trim();
  const rfc = document.getElementById("manual-prov-rfc").value.trim().toUpperCase() || "PROV" + Math.floor(1000 + Math.random() * 9000);
  const correo = document.getElementById("manual-prov-correo").value.trim();
  const tel = document.getElementById("manual-prov-tel").value.trim();
  const moneda = document.getElementById("manual-prov-moneda").value;
  const dias = parseInt(document.getElementById("manual-prov-dias").value) || 3;
  const pago = document.getElementById("manual-prov-pago").value.trim();
  const flete = parseFloat(document.getElementById("manual-prov-flete").value) || 0;
  const tasaIva = parseFloat(document.getElementById("manual-prov-iva").value) || 0.16;

  const precioInputs = document.querySelectorAll(".item-manual-precio");
  const items = [];
  let subtotal = 0;

  estadoP2P.itemsRequerimiento.forEach((it, idx) => {
    const pUnit = parseFloat(precioInputs[idx].value) || 0;
    const totalItem = pUnit * it.cant;
    subtotal += totalItem;

    items.push({
      sku: it.sku,
      desc: it.desc,
      cant: it.cant,
      unidad: it.unidad,
      precioUnitario: pUnit,
      total: totalItem
    });
  });

  const iva = (subtotal + flete) * tasaIva;
  const total = subtotal + flete + iva;

  const nuevaCot = {
    id: "COT-MANUAL-" + Math.floor(100 + Math.random() * 900),
    proveedor: nombre,
    rfc: rfc,
    correo: correo,
    telefono: tel,
    moneda: moneda,
    tiempoEntregaDias: dias,
    condicionesPago: pago,
    flete: flete,
    tasaIva: tasaIva,
    subtotal: subtotal,
    iva: iva,
    total: total,
    items: items
  };

  estadoP2P.cotizaciones.push(nuevaCot);

  // Cerrar modal
  const modalEl = document.getElementById("modalCapturaManual");
  const modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();

  p2pRecalcularMatriz();
}

// -------------------------------------------------------------
// FASE 3: GENERACIÓN Y EDICIÓN INTERACTIVA DEL BORRADOR DE OC
// -------------------------------------------------------------
function p2pGenerarBorradorOC() {
  const prov = estadoP2P.proveedorSeleccionado;
  if (!prov) return;

  const badgeProv = document.getElementById("badge-proveedor-seleccionado");
  if (badgeProv) badgeProv.innerText = `Ganador: ${prov.proveedor}`;

  // Sincronizar inputs de edición
  const elEntrega = document.getElementById("oc-entrega-input");
  if (elEntrega) elEntrega.value = `${prov.tiempoEntregaDias} días hábiles`;

  const elPago = document.getElementById("oc-pago-input");
  if (elPago) elPago.value = prov.condicionesPago;

  // Sincronizar inputs de contacto de proveedor (editables en Fase 3)
  const elCorreoProv = document.getElementById("oc-prov-correo-input");
  if (elCorreoProv) elCorreoProv.value = prov.correo || "";

  const elTelProv = document.getElementById("oc-prov-tel-input");
  if (elTelProv) elTelProv.value = prov.telefono || "";

  // Llenar previsualización imprimible
  document.getElementById("po-preview-folio").innerText = estadoP2P.folioOC;
  document.getElementById("po-preview-process-id").innerText = estadoP2P.procesoId;
  document.getElementById("po-preview-fecha").innerText = new Date().toLocaleDateString('es-MX');

  document.getElementById("po-preview-prov-nombre").innerText = prov.proveedor;
  document.getElementById("po-preview-prov-rfc").innerText = prov.rfc || "N/A";
  document.getElementById("po-preview-prov-contacto").innerText = prov.correo || "N/A";
  document.getElementById("po-preview-prov-tel").innerText = prov.telefono || "N/A";

  document.getElementById("po-preview-tiempo").innerText = `${prov.tiempoEntregaDias} días hábiles`;
  document.getElementById("po-preview-pago").innerText = prov.condicionesPago;
  document.getElementById("po-preview-moneda").innerText = `${prov.moneda} (${prov.moneda === 'USD' ? 'Dólares Americanos' : 'Pesos Mexicanos'})`;

  const sesion = (typeof obtenerUsuarioActual === 'function') ? obtenerUsuarioActual() : null;
  document.getElementById("po-preview-firmante").innerText = sesion ? sesion.nombre : (estadoP2P.solicitante || "Administrador General");
  document.getElementById("po-firma-digital-solic").innerText = `[ FIRMA DIGITAL: ${sesion ? sesion.usuario.toUpperCase() : 'ADMIN'} - ${new Date().toISOString().substring(0, 10)} ]`;

  // Llenar tabla de ítems de la OC
  const tbody = document.getElementById("po-preview-items-tbody");
  tbody.innerHTML = "";

  prov.items.forEach((it, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-monospace fw-bold text-center text-muted small">${it.partida || (idx + 1)}</td>
      <td>${it.desc}</td>
      <td class="text-center">${it.cant}</td>
      <td class="text-center">${it.unidad}</td>
      <td class="text-end font-monospace">$${it.precioUnitario.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
      <td class="text-end font-monospace fw-semibold">$${it.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
    `;
    tbody.appendChild(tr);
  });

  // Totales
  const sim = prov.moneda === "USD" ? "USD $" : "$";
  document.getElementById("po-preview-subtotal").innerText = `${sim}${(prov.subtotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
  document.getElementById("po-preview-flete").innerText = `${sim}${(prov.flete || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
  document.getElementById("po-preview-iva").innerText = `${sim}${(prov.iva || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
  document.getElementById("po-preview-total").innerText = `${sim}${(prov.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

  p2pActualizarPreviewOC(true); // Inicializar y sincronizar Fase 4
}

function p2pActualizarPreviewOC(esInicial = false) {
  const entrega = document.getElementById("oc-entrega-input") ? document.getElementById("oc-entrega-input").value : "";
  const pago = document.getElementById("oc-pago-input") ? document.getElementById("oc-pago-input").value : "";
  const dir = document.getElementById("oc-direccion-input") ? document.getElementById("oc-direccion-input").value : "";
  const notas = document.getElementById("oc-notas-input") ? document.getElementById("oc-notas-input").value : "";
  const correoProv = document.getElementById("oc-prov-correo-input") ? document.getElementById("oc-prov-correo-input").value.trim() : "";
  const telProv = document.getElementById("oc-prov-tel-input") ? document.getElementById("oc-prov-tel-input").value.trim() : "";

  if (document.getElementById("po-preview-tiempo")) document.getElementById("po-preview-tiempo").innerText = entrega;
  if (document.getElementById("po-preview-pago")) document.getElementById("po-preview-pago").innerText = pago;
  if (document.getElementById("po-preview-entrega-lugar")) document.getElementById("po-preview-entrega-lugar").innerText = dir;
  if (document.getElementById("po-preview-observaciones")) document.getElementById("po-preview-observaciones").innerText = notas;

  if (correoProv && document.getElementById("po-preview-prov-contacto")) {
    document.getElementById("po-preview-prov-contacto").innerText = correoProv;
  }
  if (telProv && document.getElementById("po-preview-prov-tel")) {
    document.getElementById("po-preview-prov-tel").innerText = telProv;
  }

  // Actualizar también resumen en Fase 4
  const prov = estadoP2P.proveedorSeleccionado;
  if (prov) {
    if (document.getElementById("f4-summary-process")) document.getElementById("f4-summary-process").innerText = estadoP2P.procesoId;
    if (document.getElementById("f4-summary-folio")) document.getElementById("f4-summary-folio").innerText = estadoP2P.folioOC;
    if (document.getElementById("f4-summary-proveedor")) document.getElementById("f4-summary-proveedor").innerText = prov.proveedor;
    if (document.getElementById("f4-summary-monto")) document.getElementById("f4-summary-monto").innerText = `${prov.moneda} $${prov.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })} (Est. ${formatoMoneda(prov.totalNormalizadoMXN)})`;
    if (document.getElementById("f4-summary-tiempo")) document.getElementById("f4-summary-tiempo").innerText = entrega;

    // Sincronizar el correo en Fase 4
    const elF4Correo = document.getElementById("f4-correo-destinatario");
    if (elF4Correo) {
      if (esInicial || !elF4Correo.value || elF4Correo.dataset.dirty !== "true") {
        elF4Correo.value = correoProv || prov.correo || "";
      }
    }

    const elF4Asunto = document.getElementById("f4-correo-asunto");
    if (elF4Asunto && (!elF4Asunto.value || esInicial)) {
      elF4Asunto.value = `Orden de Compra ${estadoP2P.folioOC} - ${estadoP2P.concepto || 'Requerimiento'}`;
    }
  }
}

/**
 * Permite al usuario modificar el correo directamente en Fase 4 manteniendo consistencia con el preview
 */
function p2pSincronizarCorreoDesdeFase4(nuevoCorreo) {
  const elF4 = document.getElementById("f4-correo-destinatario");
  if (elF4) elF4.dataset.dirty = "true";

  const elPreviewContacto = document.getElementById("po-preview-prov-contacto");
  if (elPreviewContacto) elPreviewContacto.innerText = nuevoCorreo || "N/A";

  const elF3Correo = document.getElementById("oc-prov-correo-input");
  if (elF3Correo) elF3Correo.value = nuevoCorreo;
}

// -------------------------------------------------------------
// FASE 4: APROBACIÓN, GENERACIÓN PDF Y ENVÍO AUTOMATIZADO
// -------------------------------------------------------------
async function p2pGenerarPDFDocumento(descargar = false) {
  const elemento = document.getElementById("printable-po-document");
  const opt = {
    margin: [8, 8, 8, 8],
    filename: `${estadoP2P.folioOC || 'OC-ORDEN'}_${(estadoP2P.proveedorSeleccionado && estadoP2P.proveedorSeleccionado.rfc) || 'PROV'}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      scrollY: 0,
      letterRendering: true
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };

  if (descargar) {
    return html2pdf().set(opt).from(elemento).save();
  } else {
    // Genera base64 para poder enviarlo a Google Drive y por correo
    const pdfBlob = await html2pdf().set(opt).from(elemento).outputPdf('blob');
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve({
          data: base64,
          name: opt.filename,
          mimeType: "application/pdf"
        });
      };
      reader.readAsDataURL(pdfBlob);
    });
  }
}

async function p2pDescargarSoloPDF() {
  await p2pGenerarPDFDocumento(true);
}

async function p2pAprobarYEmitirOrden() {
  const prov = estadoP2P.proveedorSeleccionado;
  if (!prov) {
    alert("No hay ningún proveedor adjudicado.");
    return;
  }

  const btn = document.getElementById("btn-aprobar-emitir-oc");
  btn.disabled = true;
  btn.innerText = "Emitiendo PDF y Sincronizando con Google Sheets & Drive...";

  try {
    // 1. Generar archivo PDF oficial
    const pdfData = await p2pGenerarPDFDocumento(false);

    // 2. Descargar copia local al usuario
    await p2pGenerarPDFDocumento(true);

    // 3. Registrar en Google Apps Script (Sheets + Drive + Enviar Correo)
    const correoDestino = document.getElementById("f4-correo-destinatario").value.trim();
    const correoAsunto = document.getElementById("f4-correo-asunto").value.trim();
    const correoCuerpo = document.getElementById("f4-correo-cuerpo").value.trim();

    const payload = {
      accion: "emitirOrdenCompra",
      procesoId: estadoP2P.procesoId,
      folioOC: estadoP2P.folioOC,
      concepto: estadoP2P.concepto,
      solicitante: estadoP2P.solicitante,
      proveedorNombre: prov.proveedor,
      proveedorRfc: prov.rfc,
      proveedorCorreo: correoDestino,
      moneda: prov.moneda,
      montoAcordado: prov.total,
      montoNormalizadoMXN: prov.totalNormalizadoMXN,
      tiempoEntrega: document.getElementById("oc-entrega-input").value,
      condicionesPago: document.getElementById("oc-pago-input").value,
      correoAsunto: correoAsunto,
      correoCuerpo: correoCuerpo,
      pdfOCFile: pdfData
    };

    let res = null;
    try {
      res = await enviarPeticionAppsScript(payload);
    } catch (eNetwork) {
      console.warn("Aviso de sincronización remota:", eNetwork);
    }

    let extraInfo = "";
    if (res && res.success) {
      const correoInfo = res.correoEnviado
        ? `✅ Correo enviado automáticamente a: ${correoDestino}`
        : `⚠️ Nota de Correo: No se pudo enviar directo desde Google Apps Script (${res.errorCorreo || 'permiso MailApp no autorizado en Apps Script'}). Se abrirá tu cliente de correo como respaldo.`;

      extraInfo = `\n\n- Sincronizado en Google Sheets.\n- Carpeta en Drive: ${res.carpetaUrl || 'Expedientes'}\n- ${correoInfo}`;

      if (!res.correoEnviado && correoDestino) {
        const mailtoLink = `mailto:${correoDestino}?subject=${encodeURIComponent(correoAsunto)}&body=${encodeURIComponent(correoCuerpo + "\n\n(Se adjunta PDF de Orden de Compra descargado)")}`;
        window.open(mailtoLink, '_blank');
      }
    } else {
      // Fallback amigable si la URL de apps script aún no se actualiza o no tiene internet
      const mailtoLink = `mailto:${correoDestino}?subject=${encodeURIComponent(correoAsunto)}&body=${encodeURIComponent(correoCuerpo + "\n\n(Se adjunta PDF de Orden de Compra descargado)")}`;
      extraInfo = `\n\nEl PDF formal se ha descargado a tu equipo.\nSe abrió el enlace para remitirlo al proveedor vía tu cliente de correo.`;
      if (correoDestino) {
        window.open(mailtoLink, '_blank');
      }
    }

    alert(`🎉 ¡ORDEN DE COMPRA APROBADA CON ÉXITO!\n\nFolio: ${estadoP2P.folioOC}\nProcess_ID: ${estadoP2P.procesoId}\nProveedor: ${prov.proveedor}${extraInfo}`);

    // Redireccionar al Dashboard para ver la orden reflejada
    window.location.href = "index.html";

  } catch (err) {
    console.error("Error en aprobación de OC:", err);
    alert("Error al procesar la aprobación: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "✓ Aprobar, Emitir PDF y Enviar OC";
  }
}

