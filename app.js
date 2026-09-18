// app scrip/app.js

// 1. INICIALIZAR SUPABASE
const SUPABASE_URL = "https://ngrlretmgxbgnmoanfke.supabase.co";
// ATENCIÓN: Debes reemplazar esta cadena por tu clave 'anon' pública real de Supabase.
const SUPABASE_ANON_KEY = "Qypv4yA5XA0iljRXkRPpiw_vwGDdpFi";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// MÓDULO: DASHBOARD (index.html)
// ==========================================
async function cargarDashboard() {
  document.getElementById("kpiTotalCompras").innerText = "...";
  document.getElementById("kpiTotalPagado").innerText = "...";
  document.getElementById("kpiSaldoPendiente").innerText = "...";
  document.getElementById("kpiComplementos").innerText = "...";

  try {
    // Obtener Procesos que no estén CERRADOS
    const { data: procesos, error: errProcesos } = await supabase
      .from('procesos')
      .select('monto_acordado, saldo_pendiente')
      .neq('estatus', 'CERRADO');

    if (errProcesos) throw errProcesos;

    let totalCompras = 0;
    let saldoPendiente = 0;
    procesos.forEach(p => {
      totalCompras += p.monto_acordado;
      saldoPendiente += p.saldo_pendiente;
    });

    // Obtener Pagos para calcular total pagado y complementos faltantes
    const { data: pagos, error: errPagos } = await supabase
      .from('pagos')
      .select('monto_abono, estatus_cfdi');

    if (errPagos) throw errPagos;

    let totalPagado = 0;
    let complementosFaltantes = 0;
    pagos.forEach(p => {
      totalPagado += p.monto_abono;
      if (p.estatus_cfdi === 'PENDIENTE_COMPLEMENTO') {
        complementosFaltantes++;
      }
    });

    // Actualizar UI
    document.getElementById("kpiTotalCompras").innerText = formatoMoneda(totalCompras);
    document.getElementById("kpiTotalPagado").innerText = formatoMoneda(totalPagado);
    document.getElementById("kpiSaldoPendiente").innerText = formatoMoneda(saldoPendiente);
    document.getElementById("kpiComplementos").innerText = complementosFaltantes;

    cargarProcesosActivos();

  } catch (error) {
    console.error("Error cargando dashboard:", error);
    alert("No se pudo cargar la información del Dashboard desde Supabase.");
  }
}

async function cargarProcesosActivos() {
  const tbody = document.getElementById("tablaProcesosDashboard");
  if (!tbody) return;

  try {
    const { data: procesos, error } = await supabase
      .from('procesos')
      .select('*, proveedores(razon_social)')
      .neq('estatus', 'CERRADO')
      .order('created_at', { ascending: false });

    if (error) throw error;

    tbody.innerHTML = '';
    if (procesos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay procesos activos.</td></tr>';
      return;
    }

    procesos.forEach(p => {
      const proveedorNombre = p.proveedores ? p.proveedores.razon_social : 'Desconocido';
      const fila = `
        <tr>
          <td><span class="fw-medium">PR-${p.id}</span><br><small class="text-secondary">${p.concepto}</small></td>
          <td>${proveedorNombre}</td>
          <td>${formatoMoneda(p.monto_acordado)}</td>
          <td><span class="text-danger fw-medium">${formatoMoneda(p.saldo_pendiente)}</span></td>
          <td><span class="badge bg-primary">${p.estatus}</span></td>
        </tr>
      `;
      tbody.innerHTML += fila;
    });

  } catch (error) {
    console.error("Error cargando procesos:", error);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error al cargar procesos.</td></tr>';
  }
}

// ==========================================
// MÓDULO: PROVEEDORES (proveedores.html)
// ==========================================
async function registrarProveedor(event) {
  event.preventDefault();
  const form = event.target;
  const btnSubmit = form.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;
  btnSubmit.innerText = "Procesando...";

  try {
    const rfc = form.rfc.value.trim().toUpperCase();

    // Subir CSF a Supabase Storage (bucket 'expedientes')
    const fileInput = form.csf.files[0];
    let csfUrl = "";
    if (fileInput) {
      const filePath = `proveedores/${rfc}/${Date.now()}_csf_${fileInput.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('expedientes')
        .upload(filePath, fileInput);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('expedientes').getPublicUrl(filePath);
      csfUrl = publicUrl;
    }

    // Insertar en tabla proveedores
    const { data, error } = await supabase
      .from('proveedores')
      .insert([
        {
          rfc: rfc,
          razon_social: form.razonSocial.value.toUpperCase(),
          regimen_fiscal: form.regimenFiscal.value,
          correo: form.correo.value,
          telefono: form.telefono.value,
          direccion: form.direccion.value,
          carpeta_url: csfUrl, // Usamos este campo temporalmente para el doc, o agregas uno nuevo
          estatus: 'ACTIVO'
        }
      ]);

    if (error) throw error;

    alert("Proveedor registrado exitosamente en Supabase.");
    form.reset();
    
    // Cerrar modal si existe
    if (typeof bootstrap !== 'undefined') {
      const modalEl = document.getElementById('modalAltaProveedor');
      if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }
    }
    
    // Recargar tabla de proveedores
    cargarProveedores();
    
  } catch (error) {
    console.error(error);
    alert("Error al registrar proveedor: " + error.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = "Guardar Proveedor"; 
  }
}

async function cargarProveedores() {
  const tbody = document.getElementById("tablaProveedores");
  if (!tbody) return;

  try {
    const { data: proveedores, error } = await supabase
      .from('proveedores')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    tbody.innerHTML = '';
    if (proveedores.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay proveedores registrados.</td></tr>';
      return;
    }

    proveedores.forEach(p => {
      const docLink = p.carpeta_url 
        ? `<a href="${p.carpeta_url}" target="_blank" class="btn btn-sm btn-outline-primary">Ver Documentos</a>` 
        : '<span class="text-secondary small">Sin documentos</span>';
        
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
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error al cargar proveedores.</td></tr>';
  }
}

// ==========================================
// MÓDULO: PROCESOS (procesos.html)
// ==========================================
async function cargarSelectProveedores() {
  const select = document.querySelector('select[name="proveedorId"]');
  if (!select) return;

  const { data, error } = await supabase
    .from('proveedores')
    .select('id, rfc, razon_social')
    .eq('estatus', 'ACTIVO');

  if (error) {
    console.error(error);
    return;
  }

  select.innerHTML = '<option value="">Selecciona el proveedor...</option>';
  data.forEach(p => {
    select.innerHTML += `<option value="${p.id}">${p.rfc} - ${p.razon_social}</option>`;
  });
}

async function cargarSelectProcesos(selector, filterAbiertos = false) {
  const select = document.querySelector(selector);
  if (!select) return;

  let query = supabase.from('procesos').select('id, concepto, saldo_pendiente');
  if (filterAbiertos) {
    query = query.gt('saldo_pendiente', 0).neq('estatus', 'CERRADO');
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return;
  }

  select.innerHTML = '<option value="">Selecciona un proceso...</option>';
  data.forEach(p => {
    select.innerHTML += `<option value="${p.id}">PR-${p.id} - ${p.concepto} (Saldo: $${p.saldo_pendiente})</option>`;
  });
}

async function registrarProceso(event) {
  event.preventDefault();
  const form = event.target;
  const btnSubmit = form.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;
  btnSubmit.innerText = "Procesando...";

  try {
    const proveedorId = form.proveedorId.value;
    const monto = parseFloat(form.monto.value);

    // Subir Cotización a Supabase Storage
    const fileInput = form.cotizacionFile.files[0];
    let cotizacionUrl = "";
    if (fileInput) {
      const filePath = `procesos/nuevo/${Date.now()}_${fileInput.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('expedientes')
        .upload(filePath, fileInput);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('expedientes').getPublicUrl(filePath);
      cotizacionUrl = publicUrl;
    }

    const { error } = await supabase
      .from('procesos')
      .insert([{
        proveedor_id: proveedorId,
        concepto: form.concepto.value,
        monto_acordado: monto,
        saldo_pendiente: monto, // Inicialmente el saldo es el monto total
        cotizacion_url: cotizacionUrl,
        estatus: 'EN_COTIZACION'
      }]);

    if (error) throw error;
    alert("Proceso aperturado correctamente en Supabase.");
    form.reset();
  } catch (error) {
    alert("Error: " + error.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = "Aperturar";
  }
}

async function actualizarProceso(event) {
  event.preventDefault();
  const form = event.target;
  const btnSubmit = form.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;

  try {
    const procesoId = form.procesoId.value;

    let contratoUrl = "";
    const fileInput = form.contratoFile.files[0];
    if (fileInput) {
      const filePath = `procesos/${procesoId}/${Date.now()}_contrato_${fileInput.name}`;
      const { error: uploadError } = await supabase.storage.from('expedientes').upload(filePath, fileInput);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('expedientes').getPublicUrl(filePath);
      contratoUrl = publicUrl;
    }

    const updates = {
      estatus: form.estatus.value,
      esquema_pago: form.esquemaPago.value
    };
    if (contratoUrl) updates.contrato_url = contratoUrl;

    const { error } = await supabase
      .from('procesos')
      .update(updates)
      .eq('id', procesoId);

    if (error) throw error;
    alert("Proceso actualizado exitosamente.");
    form.reset();
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
    const procesoId = form.procesoId.value;
    const montoAbono = parseFloat(form.montoAbonado.value);

    // 1. Subir Ficha de pago a Supabase Storage
    const fileInput = form.comprobanteFile.files[0];
    let comprobanteUrl = "";
    if (fileInput) {
      const filePath = `pagos/${procesoId}/${Date.now()}_ficha_${fileInput.name}`;
      const { error: uploadError } = await supabase.storage.from('expedientes').upload(filePath, fileInput);
      if (uploadError) throw uploadError;
      comprobanteUrl = supabase.storage.from('expedientes').getPublicUrl(filePath).data.publicUrl;
    }

    // 2. Obtener saldo actual del proceso
    const { data: proceso, error: procError } = await supabase
      .from('procesos')
      .select('saldo_pendiente')
      .eq('id', procesoId)
      .single();

    if (procError) throw procError;
    if (montoAbono > proceso.saldo_pendiente) throw new Error("El abono no puede ser mayor al saldo.");

    const nuevoSaldo = proceso.saldo_pendiente - montoAbono;
    const nuevoEstatusProc = (nuevoSaldo <= 0) ? 'PAGADO_TOTAL' : 'EN_PROGRESO';

    // 3. Insertar Pago
    const { data: nuevoPago, error: insertPagoError } = await supabase
      .from('pagos')
      .insert([{
        proceso_id: procesoId,
        monto_abono: montoAbono,
        fecha_pago: form.fechaTransferencia.value,
        comprobante_url: comprobanteUrl,
        estatus_cfdi: 'PENDIENTE_COMPLEMENTO'
      }])
      .select('id')
      .single();

    if (insertPagoError) throw insertPagoError;

    // 4. Actualizar Saldo de Proceso
    const { error: updateProcError } = await supabase
      .from('procesos')
      .update({ saldo_pendiente: nuevoSaldo, estatus: nuevoEstatusProc })
      .eq('id', procesoId);

    if (updateProcError) throw updateProcError;

    alert(`Pago registrado. Saldo actual del proceso: $${nuevoSaldo}`);
    form.reset();
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

    if (!refPagoId) throw new Error("No hay referencia de pago válida.");

    const xmlInput = form.xmlFile.files[0];
    const pdfInput = form.pdfFile ? form.pdfFile.files[0] : null;

    let xmlUrl = "";
    if (xmlInput) {
      const filePath = `cfdis/${refPagoId}/${Date.now()}_${xmlInput.name}`;
      const { error: uploadError } = await supabase.storage.from('expedientes').upload(filePath, xmlInput);
      if (uploadError) throw uploadError;
      xmlUrl = supabase.storage.from('expedientes').getPublicUrl(filePath).data.publicUrl;
    }

    const { error: updateError } = await supabase
      .from('pagos')
      .update({
        estatus_cfdi: 'COMPLETO',
        cfdi_url: xmlUrl
      })
      .eq('id', refPagoId);

    if (updateError) throw updateError;

    document.getElementById('portal-content').innerHTML = `
      <div class="text-center py-4">
        <h3 class="fw-bold text-success">¡Documentos Recibidos!</h3>
        <p class="text-secondary">El CFDI ha sido validado en Supabase.</p>
      </div>`;

  } catch (error) {
    alert("Error: " + error.message);
    btnSubmit.disabled = false;
  }
}

// ==========================================
// UTILIDADES
// ==========================================
function formatoMoneda(valor) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(valor);
}

// Al cargar la página, ejecutar funciones según la vista
document.addEventListener("DOMContentLoaded", () => {
  if (window.location.pathname.includes('proveedores.html')) {
    cargarProveedores();
  }
  if (window.location.pathname.includes('procesos.html')) {
    cargarSelectProveedores();
    cargarSelectProcesos('select[name="procesoId"]', false); // Para seguimiento
  }
  if (window.location.pathname.includes('pagos.html')) {
    cargarSelectProcesos('select[name="procesoId"]', true); // Solo con saldo pendiente
  }
});
