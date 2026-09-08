// version_sheets_drive/app.js
// Conexión directa a Google Sheets y Google Drive vía Google Apps Script

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxlejf90BKS-0hUI9PuujVBf40sb02rIRQIaFyVRElMrkpzlRBv2tbPRV-XwhpcO6-P/exec";

// ==========================================
// MÓDULO: DASHBOARD (index.html)
// ==========================================
async function cargarDashboard() {
  document.getElementById("kpiTotalCompras").innerText = "...";
  document.getElementById("kpiTotalPagado").innerText = "...";
  document.getElementById("kpiSaldoPendiente").innerText = "...";
  document.getElementById("kpiComplementos").innerText = "...";

  try {
    const respuesta = await enviarPeticionAppsScript({ accion: "obtenerMetricas" });

    if (respuesta && respuesta.success) {
      document.getElementById("kpiTotalCompras").innerText = formatoMoneda(respuesta.totalCompras || 0);
      document.getElementById("kpiTotalPagado").innerText = formatoMoneda(respuesta.totalPagado || 0);
      document.getElementById("kpiSaldoPendiente").innerText = formatoMoneda(respuesta.saldoPendiente || 0);
      document.getElementById("kpiComplementos").innerText = respuesta.complementosFaltantes || 0;
    }
  } catch (error) {
    console.error("Error cargando métricas:", error);
  }

  cargarProcesosActivos();
}

async function cargarProcesosActivos() {
  const tbody = document.getElementById("tablaProcesosDashboard");
  if (!tbody) return;

  try {
    const res = await enviarPeticionAppsScript({ accion: "obtenerProcesosActivos" });

    if (!res || !res.success || !res.procesos) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No se pudieron cargar los procesos de Google Sheets.</td></tr>';
      return;
    }

    const procesos = res.procesos;
    tbody.innerHTML = '';
    if (procesos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay procesos activos en Sheets.</td></tr>';
      return;
    }

    procesos.forEach(p => {
      const cotLink = p.cotizacion_url ? `<br><a href="${p.cotizacion_url}" target="_blank" class="small text-primary">Ver Cotización en Drive</a>` : '';
      const fila = `
        <tr>
          <td><span class="fw-medium">${p.id}</span><br><small class="text-secondary">${p.concepto}</small>${cotLink}</td>
          <td>${p.razon_social || p.proveedor_id}</td>
          <td>${formatoMoneda(p.monto_acordado)}</td>
          <td><span class="text-danger fw-medium">${formatoMoneda(p.saldo_pendiente)}</span></td>
          <td><span class="badge bg-primary">${p.estatus}</span></td>
        </tr>
      `;
      tbody.innerHTML += fila;
    });

  } catch (error) {
    console.error("Error cargando procesos:", error);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error al consultar Google Sheets.</td></tr>';
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
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay proveedores registrados en Google Sheets.</td></tr>';
      return;
    }

    proveedores.forEach(p => {
      const docLink = p.carpeta_url 
        ? `<a href="${p.carpeta_url}" target="_blank" class="btn btn-sm btn-outline-primary">Abrir Carpeta Drive</a>` 
        : '<span class="text-secondary small">Sin carpeta</span>';

      const fila = `
        <tr>
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
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error al cargar proveedores de Sheets.</td></tr>';
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
      alert("¡Proceso creado exitosamente! Se creó la subcarpeta dentro de la carpeta del proveedor en Google Drive.");
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

    const payload = {
      accion: "registrarPago",
      procesoId: form.procesoId.value,
      montoAbonado: form.montoAbonado.value,
      fechaTransferencia: form.fechaTransferencia.value,
      comprobanteFile: compData
    };

    const res = await enviarPeticionAppsScript(payload);
    if (res && res.success) {
      alert("Pago registrado correctamente en Google Sheets.");
      form.reset();
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
});
