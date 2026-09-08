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
  
  return respuestaJSON({ success: true, message: "API Google Sheets / Drive activa correctamente." });
}

// ---------------------------------------------------
// 1. OBTENER MÉTRICAS Y TABLA DEL DASHBOARD
// ---------------------------------------------------
function obtenerMetricasDashboard() {
  const ss = getSpreadsheet();
  const sheetProc = ss.getSheetByName("Procesos");
  const sheetPagos = ss.getSheetByName("Pagos");
  const sheetProv = ss.getSheetByName("Proveedores");

  const dataProc = sheetProc ? sheetProc.getDataRange().getValues() : [];
  const dataPagos = sheetPagos ? sheetPagos.getDataRange().getValues() : [];
  const dataProv = sheetProv ? sheetProv.getDataRange().getValues() : [];

  let totalCompras = 0;
  let totalPagado = 0;
  let saldoPendiente = 0;
  let complementosFaltantes = 0;

  for (let i = 1; i < dataProc.length; i++) {
    let monto = parseFloat(dataProc[i][4]) || 0;
    let saldo = parseFloat(dataProc[i][5]) || 0;
    let estatus = (dataProc[i][8] || "").toString().toUpperCase();

    if (estatus !== "CERRADO") {
      totalCompras += monto;
      saldoPendiente += saldo;
    }
  }

  for (let j = 1; j < dataPagos.length; j++) {
    let abono = parseFloat(dataPagos[j][3]) || 0;
    let estatusCFDI = (dataPagos[j][6] || "").toString();

    totalPagado += abono;
    if (estatusCFDI === "PENDIENTE_COMPLEMENTO") {
      complementosFaltantes++;
    }
  }

  return {
    success: true,
    totalCompras: totalCompras,
    totalPagado: totalPagado,
    saldoPendiente: saldoPendiente,
    complementosFaltantes: complementosFaltantes,
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

  const values = sheet.getDataRange().getValues();
  const procesos = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const estatus = (row[8] || "").toString().toUpperCase();
    if (estatus === "CERRADO" || (!row[0] && !row[3])) continue;

    procesos.push({
      id: row[0],
      proveedor_id: row[1],
      razon_social: row[2],
      concepto: row[3],
      monto_acordado: parseFloat(row[4]) || 0,
      saldo_pendiente: parseFloat(row[5]) || 0,
      cotizacion_url: row[6],
      contrato_url: row[7],
      estatus: row[8]
    });
  }

  return { success: true, procesos: procesos };
}

function obtenerProcesosConSaldo() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Procesos");
  if (!sheet) return { success: true, procesos: [] };

  const values = sheet.getDataRange().getValues();
  const procesos = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const saldo = parseFloat(row[5]) || 0;
    const estatus = (row[8] || "").toString().toUpperCase();
    if (saldo > 0 && estatus !== "CERRADO") {
      procesos.push({
        id: row[0],
        concepto: row[3],
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
// 6. REGISTRAR PAGO
// ---------------------------------------------------
function procesarNuevoPago(data) {
  const ss = getSpreadsheet();
  const sheetProc = ss.getSheetByName("Procesos");
  const sheetPagos = ss.getSheetByName("Pagos");
  const dataProc = sheetProc.getDataRange().getValues();

  let filaProceso = -1;
  let saldoActual = 0;
  let urlCarpetaProceso = "";

  for (let i = 1; i < dataProc.length; i++) {
    if (dataProc[i][0] === data.procesoId) {
      filaProceso = i + 1;
      saldoActual = parseFloat(dataProc[i][5]) || 0;
      urlCarpetaProceso = dataProc[i][7] || dataProc[i][6] || "";
      break;
    }
  }

  let montoAbono = parseFloat(data.montoAbonado) || 0;
  let idPago = "PAG-" + Math.floor(10000 + Math.random() * 90000);

  let urlComprobante = "";
  if (data.comprobanteFile) {
    let carpetaDestino = obtenerCarpetaDesdeUrl(urlCarpetaProceso);
    if (carpetaDestino) {
      urlComprobante = guardarArchivoDriveBlob(carpetaDestino, data.comprobanteFile, "3_FichaPago_" + idPago);
    } else {
      urlComprobante = guardarArchivoDriveEnRaiz(data.comprobanteFile, "FichaPago_" + idPago);
    }
  }

  sheetPagos.appendRow([
    idPago,
    data.procesoId,
    "",
    montoAbono,
    data.fechaTransferencia,
    urlComprobante,
    "PENDIENTE_COMPLEMENTO",
    "",
    "",
    new Date()
  ]);

  if (filaProceso > -1) {
    let nuevoSaldo = Math.max(0, saldoActual - montoAbono);
    sheetProc.getRange(filaProceso, 6).setValue(nuevoSaldo);
    if (nuevoSaldo <= 0) {
      sheetProc.getRange(filaProceso, 9).setValue("PAGADO_TOTAL");
    }
  }

  return { success: true, idPago: idPago };
}

// ---------------------------------------------------
// 7. SUBIDA DE CFDI (PORTAL)
// ---------------------------------------------------
function procesarSubidaCFDI(data) {
  const ss = getSpreadsheet();
  const sheetPagos = ss.getSheetByName("Pagos");
  const sheetProc = ss.getSheetByName("Procesos");
  const dataPagos = sheetPagos.getDataRange().getValues();

  let filaPago = -1;
  let procesoId = "";
  for (let i = 1; i < dataPagos.length; i++) {
    if (dataPagos[i][0] === data.pagoId) {
      filaPago = i + 1;
      procesoId = dataPagos[i][1];
      break;
    }
  }

  if (filaPago === -1) throw new Error("Pago no encontrado: " + data.pagoId);

  let urlCarpetaProceso = "";
  if (procesoId && sheetProc) {
    const dataProc = sheetProc.getDataRange().getValues();
    for (let j = 1; j < dataProc.length; j++) {
      if (dataProc[j][0] === procesoId) {
        urlCarpetaProceso = dataProc[j][7] || dataProc[j][6] || "";
        break;
      }
    }
  }

  let urlXML = "";
  if (data.xmlFile) {
    let carpetaDestino = obtenerCarpetaDesdeUrl(urlCarpetaProceso);
    if (carpetaDestino) {
      urlXML = guardarArchivoDriveBlob(carpetaDestino, data.xmlFile, "4_CFDI_" + data.pagoId);
    } else {
      urlXML = guardarArchivoDriveEnRaiz(data.xmlFile, "CFDI_" + data.pagoId);
    }
  }

  sheetPagos.getRange(filaPago, 7).setValue("COMPLETO");
  sheetPagos.getRange(filaPago, 8).setValue(urlXML);

  return { success: true };
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

function respuestaJSON(obj, code) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}
