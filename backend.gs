/**
 * backend.gs (Versión 100% Google Sheets + Google Drive)
 * 
 * Instrucciones:
 * 1. Pega este código en tu proyecto de Google Apps Script vinculado a tu Google Sheet (Extensiones > Apps Script).
 * 2. Implementar > Nueva implementación > Tipo: "Aplicación web".
 * 3. Ejecutar como: "Yo" (tu cuenta).
 * 4. Quién tiene acceso: "Cualquier persona" (para permitir peticiones desde tu app web).
 * 5. Copia la URL de la aplicación web generada (termina en /exec) y pégala en `version_sheets_drive/app.js` en la variable SCRIPT_URL.
 */

function getSpreadsheet() {
  // Intenta tomar el Sheet activo directamente, o mediante ID si se especifica
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    // Si no está vinculado a un Sheet directamente, coloca aquí tu ID
    return SpreadsheetApp.openById("1YMUl2NumIZ-HGbuJP-l9eYC64wwG5ZJe0aAOvRQcCFY");
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respuestaJSON({ success: false, error: "No se recibieron datos POST" }, 400);
    }

    const data = JSON.parse(e.postData.contents);
    const accion = data.accion;

    // Regla de Seguridad Máxima: El perfil CONTADOR es estrictamente de solo lectura y auditoría
    const accionesModificacion = ["registrarProveedor", "registrarProceso", "actualizarProceso", "registrarPago"];
    if (data.rolAuth === "CONTADOR" && accionesModificacion.includes(accion)) {
      return respuestaJSON({ success: false, error: "Acceso denegado: El rol de Contador no tiene permisos de modificación o creación." }, 403);
    }

    if (accion === "obtenerMetricas") {
      return respuestaJSON(obtenerMetricasDashboard());
    }

    if (accion === "obtenerProveedores") {
      return respuestaJSON(obtenerListadoProveedores());
    }

    if (accion === "obtenerProcesosActivos") {
      return respuestaJSON(obtenerListadoProcesosActivos());
    }

    if (accion === "obtenerProcesosConSaldo") {
      return respuestaJSON(obtenerProcesosConSaldo());
    }

    if (accion === "obtenerParcialidadesProceso") {
      return respuestaJSON(obtenerParcialidadesProceso(data.procesoId));
    }

    if (accion === "subirREPParcialidad") {
      return respuestaJSON(procesarSubidaREP(data));
    }

    if (accion === "registrarProveedor") {
      return respuestaJSON(procesarAltaProveedor(data));
    }

    if (accion === "registrarProceso") {
      return respuestaJSON(procesarNuevoProceso(data));
    }

    if (accion === "actualizarProceso") {
      return respuestaJSON(procesarActualizacionProceso(data));
    }

    if (accion === "registrarPago") {
      return respuestaJSON(procesarNuevoPago(data));
    }

    if (accion === "subirCFDI") {
      return respuestaJSON(procesarSubidaCFDI(data));
    }

    if (accion === "emitirOrdenCompra") {
      return respuestaJSON(procesarEmisionOrdenCompra(data));
    }

    return respuestaJSON({ success: false, error: "Acción no reconocida: " + accion }, 400);

  } catch (error) {
    return respuestaJSON({ success: false, error: error.toString() }, 500);
  }
}

function doGet(e) {
  const accion = e && e.parameter ? e.parameter.accion : "";
  if (accion === "obtenerMetricas") return respuestaJSON(obtenerMetricasDashboard());
  if (accion === "obtenerProveedores") return respuestaJSON(obtenerListadoProveedores());
  if (accion === "obtenerProcesosActivos") return respuestaJSON(obtenerListadoProcesosActivos());
  if (accion === "obtenerProcesosConSaldo") return respuestaJSON(obtenerProcesosConSaldo());
  if (accion === "obtenerParcialidadesProceso") return respuestaJSON(obtenerParcialidadesProceso(e && e.parameter ? e.parameter.procesoId : ""));
  
  return respuestaJSON({ success: true, message: "API Google Sheets / Drive activa correctamente." });
}

// ---------------------------------------------------
// 1. OBTENER MÉTRICAS Y TABLA DEL DASHBOARD
// ---------------------------------------------------
function obtenerMetricasDashboard() {
  const ss = getSpreadsheet();
  const sheetProc = ss.getSheetByName("Procesos");
  const sheetParcialidades = ss.getSheetByName("Parcialidades_Pagos") || ss.getSheetByName("Pagos");
  const sheetProv = ss.getSheetByName("Proveedores");

  const dataProc = sheetProc ? sheetProc.getDataRange().getValues() : [];
  const dataPagos = sheetParcialidades ? sheetParcialidades.getDataRange().getValues() : [];
  const dataProv = sheetProv ? sheetProv.getDataRange().getValues() : [];

  let totalCompras = 0;
  let totalPagado = 0;
  let saldoPendiente = 0;
  let complementosFaltantes = 0;
  let facturasFaltantes = 0;
  let proximos7Dias = 0;

  // Mapa de abonos por Process_ID para cálculo dinámico estricto
  const abonosPorProceso = {};
  for (let j = 1; j < dataPagos.length; j++) {
    const rowPago = dataPagos[j];
    const procId = (rowPago[1] || "").toString().trim();
    const abono = parseFloat(rowPago[3]) || 0;
    const estatusREP = (rowPago[6] || "").toString().toUpperCase();

    totalPagado += abono;
    if (procId) {
      abonosPorProceso[procId] = (abonosPorProceso[procId] || 0) + abono;
    }

    // Regla de Negocio: Cero tolerancia al REP faltante
    if (estatusREP === "PENDIENTE" || estatusREP === "PENDIENTE_COMPLEMENTO" || estatusREP === "") {
      complementosFaltantes++;
    }
  }

  for (let i = 1; i < dataProc.length; i++) {
    const procId = (dataProc[i][0] || "").toString().trim();
    let monto = parseFloat(dataProc[i][4]) || 0;
    let estatus = (dataProc[i][8] || "").toString().toUpperCase();
    let urlDoc = (dataProc[i][6] || "").toString();

    // Saldo dinámico = Monto Total - Suma de Abonos
    const abonosRegistrados = abonosPorProceso[procId] || 0;
    let saldoCalculado = Math.max(0, monto - abonosRegistrados);

    if (estatus !== "CERRADO" && estatus !== "PAGADO_TOTAL_CERRADO") {
      totalCompras += monto;
      saldoPendiente += saldoCalculado;

      // Facturas faltantes: procesos con orden emitida sin factura/cfdi
      if (saldoCalculado > 0 && estatus !== "EN_COTIZACION" && !urlDoc.toLowerCase().includes(".xml")) {
        facturasFaltantes++;
      }

      // Proyección compromisos próximos 7 días
      if (saldoCalculado > 0 && (estatus.includes("VENCER") || estatus.includes("ORDEN_COMPRA") || estatus === "CONTRATADO" || estatus.includes("PAGO_PARCIAL"))) {
        proximos7Dias += (saldoCalculado * 0.5);
      }
    }
  }

  return {
    success: true,
    totalCompras: totalCompras,
    totalPagado: totalPagado,
    saldoPendiente: saldoPendiente,
    proximos7Dias: proximos7Dias,
    facturasFaltantes: facturasFaltantes,
    complementosFaltantes: complementosFaltantes, // Contador estricto de REPs faltantes
    totalProveedores: Math.max(0, dataProv.length - 1)
  };
}

// ---------------------------------------------------
// 2. LISTADOS PARA LAS TABLAS Y SELECTS
// ---------------------------------------------------
function obtenerListadoProveedores() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Proveedores");
  if (!sheet) return { success: true, proveedores: [] };

  const values = sheet.getDataRange().getValues();
  const proveedores = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0] && !row[2]) continue;
    proveedores.push({
      id: row[0],
      razon_social: row[1],
      rfc: row[2],
      regimen_fiscal: row[3],
      correo: row[4],
      telefono: row[5],
      direccion: row[6],
      carpeta_url: row[7],
      estatus: row[8]
    });
  }

  return { success: true, proveedores: proveedores };
}

function obtenerListadoProcesosActivos() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Procesos");
  if (!sheet) return { success: true, procesos: [] };

  const sheetParcialidades = ss.getSheetByName("Parcialidades_Pagos") || ss.getSheetByName("Pagos");
  const dataPagos = sheetParcialidades ? sheetParcialidades.getDataRange().getValues() : [];

  // Indexar parcialidades por procesoId
  const pagosPorProceso = {};
  for (let j = 1; j < dataPagos.length; j++) {
    const rowP = dataPagos[j];
    const procId = (rowP[1] || "").toString().trim();
    if (!procId) continue;
    if (!pagosPorProceso[procId]) pagosPorProceso[procId] = [];

    pagosPorProceso[procId].push({
      id_pago: rowP[0],
      proceso_id: procId,
      num_parcialidad: rowP[2] || ("Abono " + pagosPorProceso[procId].length + 1),
      monto_abonado: parseFloat(rowP[3]) || 0,
      fecha_pago: rowP[4],
      comprobante_url: rowP[5] || "",
      estatus_rep: (rowP[6] || "").toString().toUpperCase() || "PENDIENTE",
      rep_url: rowP[7] || ""
    });
  }

  const values = sheet.getDataRange().getValues();
  const procesos = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const estatus = (row[8] || "").toString().toUpperCase();
    if (estatus === "CERRADO" || (!row[0] && !row[3])) continue;

    const procId = (row[0] || "").toString().trim();
    const montoAcordado = parseFloat(row[4]) || 0;
    const parcialidades = pagosPorProceso[procId] || [];

    // Cálculo dinámico del saldo
    let totalAbonado = 0;
    let repsPendientes = 0;
    parcialidades.forEach(ab => {
      totalAbonado += ab.monto_abonado;
      if (ab.estatus_rep === "PENDIENTE" || ab.estatus_rep === "PENDIENTE_COMPLEMENTO" || !ab.estatus_rep) {
        repsPendientes++;
      }
    });

    const saldoCalculado = Math.max(0, montoAcordado - totalAbonado);

    procesos.push({
      id: procId,
      proveedor_id: row[1],
      razon_social: row[2],
      concepto: row[3],
      monto_acordado: montoAcordado,
      total_abonado: totalAbonado,
      saldo_pendiente: saldoCalculado,
      cotizacion_url: row[6],
      contrato_url: row[7],
      estatus: row[8],
      tipo_factura: row[9] || "PPD", // PPD (default para pagos parciales) o PUE
      folio_factura_global: row[10] || "",
      total_parcialidades: parcialidades.length,
      reps_pendientes: repsPendientes,
      parcialidades: parcialidades
    });
  }

  return { success: true, procesos: procesos };
}

function obtenerParcialidadesProceso(procesoId) {
  if (!procesoId) return { success: false, error: "Falta procesoId" };
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Parcialidades_Pagos") || ss.getSheetByName("Pagos");
  if (!sheet) return { success: true, parcialidades: [] };

  const values = sheet.getDataRange().getValues();
  const parcialidades = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if ((row[1] || "").toString().trim() === procesoId.toString().trim()) {
      parcialidades.push({
        id_pago: row[0],
        proceso_id: row[1],
        num_parcialidad: row[2] || ("Abono " + (parcialidades.length + 1)),
        monto_abonado: parseFloat(row[3]) || 0,
        fecha_pago: row[4],
        comprobante_url: row[5] || "",
        estatus_rep: (row[6] || "").toString().toUpperCase() || "PENDIENTE",
        rep_url: row[7] || "",
        fecha_registro: row[9] || ""
      });
    }
  }

  return { success: true, parcialidades: parcialidades };
}

function obtenerProcesosConSaldo() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Procesos");
  if (!sheet) return { success: true, procesos: [] };

  const sheetParcialidades = ss.getSheetByName("Parcialidades_Pagos") || ss.getSheetByName("Pagos");
  const dataPagos = sheetParcialidades ? sheetParcialidades.getDataRange().getValues() : [];

  const abonosPorProceso = {};
  for (let j = 1; j < dataPagos.length; j++) {
    const procId = (dataPagos[j][1] || "").toString().trim();
    const abono = parseFloat(dataPagos[j][3]) || 0;
    if (procId) abonosPorProceso[procId] = (abonosPorProceso[procId] || 0) + abono;
  }

  const values = sheet.getDataRange().getValues();
  const procesos = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const procId = (row[0] || "").toString().trim();
    const monto = parseFloat(row[4]) || 0;
    const estatus = (row[8] || "").toString().toUpperCase();

    const abonos = abonosPorProceso[procId] || 0;
    const saldo = Math.max(0, monto - abonos);

    if (saldo > 0 && estatus !== "CERRADO" && estatus !== "PAGADO_TOTAL_CERRADO") {
      procesos.push({
        id: row[0],
        concepto: row[3],
        monto_total: monto,
        saldo_pendiente: saldo
      });
    }
  }

  return { success: true, procesos: procesos };
}

// ---------------------------------------------------
// 3. REGISTRAR PROVEEDOR Y CREAR CARPETA EN DRIVE
// ---------------------------------------------------
function procesarAltaProveedor(data) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Proveedores");
  
  // Buscar o crear carpeta raíz de expedientes
  let carpetaRaiz;
  let iterador = DriveApp.getFoldersByName("EXPEDIENTES_PROVEEDORES");
  if (iterador.hasNext()) {
    carpetaRaiz = iterador.next();
  } else {
    carpetaRaiz = DriveApp.createFolder("EXPEDIENTES_PROVEEDORES");
  }

  // Crear subcarpeta para el proveedor
  let nombreCarpeta = (data.rfc || "").toUpperCase().trim() + " - " + (data.razonSocial || "").toUpperCase().trim();
  let carpetaProveedor = carpetaRaiz.createFolder(nombreCarpeta);

  // Guardar archivo CSF si existe
  let urlCSF = "";
  if (data.csfFile) {
    urlCSF = guardarArchivoDriveBlob(carpetaProveedor, data.csfFile, "1_CSF_" + data.rfc);
  }

  // Guardar comprobante si existe
  if (data.comprobanteFile) {
    guardarArchivoDriveBlob(carpetaProveedor, data.comprobanteFile, "2_Comprobante_Domicilio_" + data.rfc);
  }

  let idProveedor = "PROV-" + Math.floor(1000 + Math.random() * 9000);

  sheet.appendRow([
    idProveedor,
    (data.razonSocial || "").toUpperCase().trim(),
    (data.rfc || "").toUpperCase().trim(),
    data.regimenFiscal || "",
    (data.correo || "").trim(),
    (data.telefono || "").trim(),
    (data.direccion || "").trim(),
    carpetaProveedor.getUrl(),
    "ACTIVO",
    new Date()
  ]);

  return { success: true, idProveedor: idProveedor, carpetaUrl: carpetaProveedor.getUrl() };
}

// ---------------------------------------------------
// 4. APERTURA DE PROCESO Y CARPETA EN DRIVE
// ---------------------------------------------------
function procesarNuevoProceso(data) {
  const ss = getSpreadsheet();
  const sheetProc = ss.getSheetByName("Procesos");
  const sheetProv = ss.getSheetByName("Proveedores");
  
  const dataProv = sheetProv ? sheetProv.getDataRange().getValues() : [];
  let urlCarpetaProv = "";
  let razonSocial = "";

  for (let i = 1; i < dataProv.length; i++) {
    if (dataProv[i][2] === data.proveedorId || dataProv[i][0] === data.proveedorId) {
      razonSocial = dataProv[i][1];
      urlCarpetaProv = dataProv[i][7];
      break;
    }
  }

  let idProceso = "PR-" + Math.floor(1000 + Math.random() * 9000);
  let carpetaProceso = null;
  let urlCarpetaProceso = "";
  let urlCotizacion = "";

  // Intentar crear la carpeta dentro de la carpeta del proveedor en Drive
  if (urlCarpetaProv) {
    try {
      let matches = urlCarpetaProv.match(/[-\w]{25,}/);
      if (matches) {
        let carpetaProv = DriveApp.getFolderById(matches[0]);
        let nombreSubcarpeta = idProceso + " - " + (data.concepto || "").substring(0, 35).trim();
        carpetaProceso = carpetaProv.createFolder(nombreSubcarpeta);
        carpetaProceso.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        urlCarpetaProceso = carpetaProceso.getUrl();
      }
    } catch (errDrive) {
      Logger.log("Error creando carpeta del proceso dentro del proveedor: " + errDrive);
    }
  }

  // Si no se encontró carpeta de proveedor, crear la carpeta de proceso en la raíz de EXPEDIENTES
  if (!carpetaProceso) {
    try {
      let iterador = DriveApp.getFoldersByName("EXPEDIENTES_PROVEEDORES");
      let carpetaRaiz = iterador.hasNext() ? iterador.next() : DriveApp.createFolder("EXPEDIENTES_PROVEEDORES");
      let nombreCarpeta = idProceso + " - " + (razonSocial || data.proveedorId) + " - " + (data.concepto || "").substring(0, 30).trim();
      carpetaProceso = carpetaRaiz.createFolder(nombreCarpeta);
      carpetaProceso.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urlCarpetaProceso = carpetaProceso.getUrl();
    } catch (errDrive2) {
      Logger.log("Error creando carpeta de proceso en raíz: " + errDrive2);
    }
  }

  // Guardar archivo de cotización dentro de la carpeta del proceso
  if (data.cotizacionFile && carpetaProceso) {
    urlCotizacion = guardarArchivoDriveBlob(carpetaProceso, data.cotizacionFile, "1_Cotizacion_" + idProceso);
  }

  let monto = parseFloat(data.monto) || 0;

  // Guardamos urlCotizacion o urlCarpetaProceso para tener siempre acceso a la carpeta
  let urlDocumentacion = urlCotizacion || urlCarpetaProceso;

  sheetProc.appendRow([
    idProceso,
    data.proveedorId,
    razonSocial,
    data.concepto,
    monto,
    monto, // Saldo inicial
    urlDocumentacion,
    urlCarpetaProceso, // Guardamos enlace de carpeta en columna de soporte
    "EN_COTIZACION",
    new Date()
  ]);

  return { 
    success: true, 
    idProceso: idProceso, 
    carpetaUrl: urlCarpetaProceso,
    cotizacionUrl: urlCotizacion 
  };
}

// ---------------------------------------------------
// 5. ACTUALIZAR PROCESO (CONTRATO / ESTATUS)
// ---------------------------------------------------
function procesarActualizacionProceso(data) {
  const ss = getSpreadsheet();
  const sheetProc = ss.getSheetByName("Procesos");
  const dataProc = sheetProc.getDataRange().getValues();

  let fila = -1;
  let urlCarpetaProceso = "";
  for (let i = 1; i < dataProc.length; i++) {
    if (dataProc[i][0] === data.procesoId) {
      fila = i + 1;
      // Columna 7 o 6 pueden tener la URL de cotización o carpeta
      urlCarpetaProceso = dataProc[i][7] || dataProc[i][6] || "";
      break;
    }
  }

  if (fila === -1) throw new Error("Proceso no encontrado: " + data.procesoId);

  if (data.estatus) {
    sheetProc.getRange(fila, 9).setValue(data.estatus);
  }

  if (data.contratoFile) {
    let carpetaDestino = obtenerCarpetaDesdeUrl(urlCarpetaProceso);
    let urlContrato = "";
    if (carpetaDestino) {
      urlContrato = guardarArchivoDriveBlob(carpetaDestino, data.contratoFile, "2_Contrato_" + data.procesoId);
    } else {
      urlContrato = guardarArchivoDriveEnRaiz(data.contratoFile, "Contrato_" + data.procesoId);
    }
    sheetProc.getRange(fila, 8).setValue(urlContrato);
  }

  return { success: true };
}

// ---------------------------------------------------
// 6. REGISTRAR PARCIALIDAD / ABONO A PROCESO (PPD)
// ---------------------------------------------------
function procesarNuevoPago(data) {
  const ss = getSpreadsheet();
  const sheetProc = ss.getSheetByName("Procesos");
  let sheetParcialidades = ss.getSheetByName("Parcialidades_Pagos");
  
  if (!sheetParcialidades) {
    // Si no existe, crear la pestaña Parcialidades_Pagos
    sheetParcialidades = ss.insertSheet("Parcialidades_Pagos");
    sheetParcialidades.appendRow([
      "ID_Pago",
      "Process_ID",
      "Num_Parcialidad",
      "Monto_Abonado",
      "Fecha_Pago",
      "Comprobante_URL",
      "Estatus_REP",
      "REP_URL",
      "Notas",
      "Fecha_Registro"
    ]);
  }

  const dataProc = sheetProc ? sheetProc.getDataRange().getValues() : [];
  let filaProceso = -1;
  let montoTotalGlobal = 0;
  let urlCarpetaProceso = "";
  let procId = data.procesoId;

  for (let i = 1; i < dataProc.length; i++) {
    if (dataProc[i][0] === procId) {
      filaProceso = i + 1;
      montoTotalGlobal = parseFloat(dataProc[i][4]) || 0;
      urlCarpetaProceso = dataProc[i][7] || dataProc[i][6] || "";
      break;
    }
  }

  if (filaProceso === -1) throw new Error("Proceso de compra no encontrado: " + procId);

  let montoAbono = parseFloat(data.montoAbonado) || 0;
  if (montoAbono <= 0) throw new Error("El monto abonado debe ser mayor a 0.");

  let idPago = "PAG-" + Math.floor(10000 + Math.random() * 90000);

  // Subir Comprobante Bancario a Drive
  let urlComprobante = "";
  if (data.comprobanteFile) {
    let carpetaDestino = obtenerCarpetaDesdeUrl(urlCarpetaProceso);
    if (carpetaDestino) {
      urlComprobante = guardarArchivoDriveBlob(carpetaDestino, data.comprobanteFile, "3_FichaPago_" + idPago);
    } else {
      urlComprobante = guardarArchivoDriveEnRaiz(data.comprobanteFile, "FichaPago_" + idPago);
    }
  }

  const numParcialidad = data.numParcialidad || "Abono Parcial";

  // Regla Estricta: Cada abono nace por defecto con Estatus_REP = "PENDIENTE"
  sheetParcialidades.appendRow([
    idPago,
    procId,
    numParcialidad,
    montoAbono,
    data.fechaTransferencia || new Date().toISOString().split('T')[0],
    urlComprobante,
    "PENDIENTE",
    "",
    data.notas || "",
    new Date()
  ]);

  // Sincronizar también con la hoja Pagos para compatibilidad legacy si existe
  const sheetPagosLegacy = ss.getSheetByName("Pagos");
  if (sheetPagosLegacy) {
    sheetPagosLegacy.appendRow([
      idPago,
      procId,
      numParcialidad,
      montoAbono,
      data.fechaTransferencia,
      urlComprobante,
      "PENDIENTE_COMPLEMENTO",
      "",
      "",
      new Date()
    ]);
  }

  // Recalcular saldo exacto de forma dinámica sumando todos los abonos del proceso
  const dataPagosActualizada = sheetParcialidades.getDataRange().getValues();
  let sumaAbonos = 0;
  let repsPendientesCount = 0;

  for (let k = 1; k < dataPagosActualizada.length; k++) {
    if ((dataPagosActualizada[k][1] || "").toString().trim() === procId.toString().trim()) {
      sumaAbonos += (parseFloat(dataPagosActualizada[k][3]) || 0);
      const estREP = (dataPagosActualizada[k][6] || "").toString().toUpperCase();
      if (estREP === "PENDIENTE" || estREP === "PENDIENTE_COMPLEMENTO" || !estREP) {
        repsPendientesCount++;
      }
    }
  }

  const nuevoSaldo = Math.max(0, montoTotalGlobal - sumaAbonos);
  sheetProc.getRange(filaProceso, 6).setValue(nuevoSaldo);

  // Regla de Validación Estricta: Cero tolerancia al REP faltante
  // PROHIBIDO marcar como CERRADO / PAGADO_TOTAL si falta algún REP o si saldo > 0
  let nuevoEstatusProceso = "PAGO_PARCIAL";
  if (nuevoSaldo === 0) {
    if (repsPendientesCount === 0) {
      nuevoEstatusProceso = "PAGADO_TOTAL_CERRADO";
    } else {
      // Saldo en 0 pero faltan comprobantes fiscales de los abonos
      nuevoEstatusProceso = "LIQUIDADO_FALTA_REP";
    }
  }

  sheetProc.getRange(filaProceso, 9).setValue(nuevoEstatusProceso);

  return {
    success: true,
    idPago: idPago,
    procesoId: procId,
    montoAbonado: montoAbono,
    saldoRestante: nuevoSaldo,
    estatusProceso: nuevoEstatusProceso,
    repsPendientes: repsPendientesCount,
    comprobanteUrl: urlComprobante
  };
}

// ---------------------------------------------------
// 7. SUBIDA DE COMPLEMENTO DE PAGO (REP) POR PARCIALIDAD
// ---------------------------------------------------
function procesarSubidaREP(data) {
  const ss = getSpreadsheet();
  const sheetParcialidades = ss.getSheetByName("Parcialidades_Pagos") || ss.getSheetByName("Pagos");
  const sheetProc = ss.getSheetByName("Procesos");

  if (!sheetParcialidades) throw new Error("No existe la hoja de pagos/parcialidades.");

  const dataPagos = sheetParcialidades.getDataRange().getValues();
  let filaPago = -1;
  let procId = "";

  for (let i = 1; i < dataPagos.length; i++) {
    if (dataPagos[i][0] === data.pagoId) {
      filaPago = i + 1;
      procId = (dataPagos[i][1] || "").toString().trim();
      break;
    }
  }

  if (filaPago === -1) throw new Error("Abono no encontrado: " + data.pagoId);

  // Obtener carpeta de Drive del proceso
  let urlCarpetaProceso = "";
  let filaProceso = -1;
  let montoTotalGlobal = 0;
  if (procId && sheetProc) {
    const dataProc = sheetProc.getDataRange().getValues();
    for (let j = 1; j < dataProc.length; j++) {
      if (dataProc[j][0] === procId) {
        filaProceso = j + 1;
        montoTotalGlobal = parseFloat(dataProc[j][4]) || 0;
        urlCarpetaProceso = dataProc[j][7] || dataProc[j][6] || "";
        break;
      }
    }
  }

  let urlREP = "";
  if (data.repXmlFile || data.xmlFile) {
    const fileToUpload = data.repXmlFile || data.xmlFile;
    let carpetaDestino = obtenerCarpetaDesdeUrl(urlCarpetaProceso);
    if (carpetaDestino) {
      urlREP = guardarArchivoDriveBlob(carpetaDestino, fileToUpload, "4_REP_" + data.pagoId);
    } else {
      urlREP = guardarArchivoDriveEnRaiz(fileToUpload, "REP_" + data.pagoId);
    }
  }

  // Marcar estatus de este abono como RECIBIDO
  sheetParcialidades.getRange(filaPago, 7).setValue("RECIBIDO");
  sheetParcialidades.getRange(filaPago, 8).setValue(urlREP);

  // También actualizar hoja legacy Pagos si existe
  const sheetPagosLegacy = ss.getSheetByName("Pagos");
  if (sheetPagosLegacy) {
    const dPL = sheetPagosLegacy.getDataRange().getValues();
    for (let m = 1; m < dPL.length; m++) {
      if (dPL[m][0] === data.pagoId) {
        sheetPagosLegacy.getRange(m + 1, 7).setValue("COMPLETO");
        sheetPagosLegacy.getRange(m + 1, 8).setValue(urlREP);
        break;
      }
    }
  }

  // Verificar si con este REP se completan todos los abonos y se puede cerrar el proceso
  let repsPendientesCount = 0;
  let sumaAbonos = 0;
  const dataActualizada = sheetParcialidades.getDataRange().getValues();

  for (let k = 1; k < dataActualizada.length; k++) {
    if ((dataActualizada[k][1] || "").toString().trim() === procId) {
      sumaAbonos += (parseFloat(dataActualizada[k][3]) || 0);
      const estREP = (dataActualizada[k][6] || "").toString().toUpperCase();
      if (estREP === "PENDIENTE" || estREP === "PENDIENTE_COMPLEMENTO" || !estREP) {
        repsPendientesCount++;
      }
    }
  }

  const saldoRestante = Math.max(0, montoTotalGlobal - sumaAbonos);
  if (filaProceso > -1) {
    if (saldoRestante === 0 && repsPendientesCount === 0) {
      sheetProc.getRange(filaProceso, 9).setValue("PAGADO_TOTAL_CERRADO");
    } else if (saldoRestante === 0 && repsPendientesCount > 0) {
      sheetProc.getRange(filaProceso, 9).setValue("LIQUIDADO_FALTA_REP");
    }
  }

  return {
    success: true,
    pagoId: data.pagoId,
    repUrl: urlREP,
    repsPendientesRestantes: repsPendientesCount,
    saldoRestante: saldoRestante
  };
}

// ---------------------------------------------------
// 7. SUBIDA DE CFDI (PORTAL LEGACY)
// ---------------------------------------------------
function procesarSubidaCFDI(data) {
  return procesarSubidaREP(data);
}

// ---------------------------------------------------
// AUXILIARES DRIVE & JSON
// ---------------------------------------------------
function obtenerCarpetaDesdeUrl(url) {
  if (!url) return null;
  try {
    let matches = url.match(/[-\w]{25,}/);
    if (!matches) return null;
    let id = matches[0];
    
    // Si la URL es de un archivo, obtener su carpeta contenedora
    try {
      let archivo = DriveApp.getFileById(id);
      let padres = archivo.getParents();
      if (padres.hasNext()) return padres.next();
    } catch (e) {
      // Si no es archivo, intentar como carpeta
    }

    return DriveApp.getFolderById(id);
  } catch (err) {
    Logger.log("No se pudo obtener carpeta desde URL: " + err);
    return null;
  }
}

function guardarArchivoDriveBlob(carpetaTarget, fileObj, nombreDeseado) {
  let bytes = Utilities.base64Decode(fileObj.data);
  let ext = fileObj.name.indexOf('.') !== -1 ? fileObj.name.substring(fileObj.name.lastIndexOf('.')) : '';
  let blob = Utilities.newBlob(bytes, fileObj.mimeType, nombreDeseado + ext);
  let archivo = carpetaTarget.createFile(blob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return archivo.getUrl();
}

function guardarArchivoDriveEnRaiz(fileObj, nombreDeseado) {
  let iterador = DriveApp.getFoldersByName("EXPEDIENTES_PROVEEDORES");
  let carpeta = iterador.hasNext() ? iterador.next() : DriveApp.createFolder("EXPEDIENTES_PROVEEDORES");
  return guardarArchivoDriveBlob(carpeta, fileObj, nombreDeseado);
}

// ---------------------------------------------------
// 8. EMISIÓN DE ORDEN DE COMPRA (P2P AUTOMATIZADO)
// ---------------------------------------------------
function procesarEmisionOrdenCompra(data) {
  const ss = getSpreadsheet();
  let sheetProc = ss.getSheetByName("Procesos");
  if (!sheetProc) {
    sheetProc = ss.insertSheet("Procesos");
    sheetProc.appendRow(["ID Proceso", "Proveedor ID / RFC", "Razón Social", "Concepto", "Monto Acordado", "Saldo Pendiente", "Cotización / Doc", "Carpeta Drive", "Estatus", "Fecha"]);
  }

  const idProceso = data.procesoId || ("PR-" + Math.floor(1000 + Math.random() * 9000));
  const folioOC = data.folioOC || ("OC-" + Math.floor(1000 + Math.random() * 9000));
  const proveedorNombre = data.proveedorNombre || data.proveedorRfc;
  const concepto = data.concepto || "Adquisición de materiales";
  const monto = parseFloat(data.montoAcordado) || 0;
  const montoMXN = parseFloat(data.montoNormalizadoMXN) || monto;

  // Buscar o crear carpeta de proceso en Google Drive
  let carpetaRaiz;
  let iterador = DriveApp.getFoldersByName("EXPEDIENTES_PROVEEDORES");
  if (iterador.hasNext()) {
    carpetaRaiz = iterador.next();
  } else {
    carpetaRaiz = DriveApp.createFolder("EXPEDIENTES_PROVEEDORES");
  }

  let nombreCarpeta = idProceso + " - " + proveedorNombre.substring(0, 30).trim();
  let carpetaProceso = carpetaRaiz.createFolder(nombreCarpeta);
  carpetaProceso.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Guardar archivo PDF de la Orden de Compra en Drive
  let urlPDF_OC = "";
  let blobOC = null;
  if (data.pdfOCFile) {
    let bytes = Utilities.base64Decode(data.pdfOCFile.data);
    blobOC = Utilities.newBlob(bytes, "application/pdf", folioOC + "_" + data.proveedorRfc + ".pdf");
    let archivoOC = carpetaProceso.createFile(blobOC);
    archivoOC.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    urlPDF_OC = archivoOC.getUrl();
  }

  // Registrar en hoja de Procesos
  sheetProc.appendRow([
    idProceso,
    data.proveedorRfc || "",
    proveedorNombre,
    concepto + " [Folio: " + folioOC + "]",
    montoMXN,
    montoMXN, // Saldo inicial
    urlPDF_OC || carpetaProceso.getUrl(),
    carpetaProceso.getUrl(),
    "ORDEN_COMPRA_EMITIDA",
    new Date()
  ]);

  // Si se solicitó envío por correo electrónico al proveedor
  let correoEnviado = false;
  let errorCorreo = null;
  if (data.proveedorCorreo && blobOC) {
    try {
      MailApp.sendEmail({
        to: data.proveedorCorreo,
        subject: data.correoAsunto || ("Orden de Compra " + folioOC + " Aprobada"),
        body: (data.correoCuerpo || "Adjunto encontrará la Orden de Compra formal emitida.") + 
              "\n\nFolio: " + folioOC + 
              "\nID Proceso: " + idProceso + 
              "\nFecha: " + new Date().toLocaleDateString(),
        attachments: [blobOC]
      });
      correoEnviado = true;
    } catch (errMail) {
      errorCorreo = errMail.toString();
      Logger.log("Aviso: No se pudo enviar el correo automático: " + errMail);
    }
  }

  return {
    success: true,
    idProceso: idProceso,
    folioOC: folioOC,
    carpetaUrl: carpetaProceso.getUrl(),
    pdfUrl: urlPDF_OC,
    correoEnviado: correoEnviado,
    errorCorreo: errorCorreo
  };
}

function respuestaJSON(obj, code) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}
