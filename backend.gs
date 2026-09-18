/**
 * backend.gs
 * Código para Google Apps Script.
 * 1. Pega este código en un nuevo proyecto de Apps Script.
 * 2. Cambia los IDs de tu archivo Sheets y tu carpeta Drive principal.
 * 3. Publica como Aplicación Web (Web App), con acceso a "Cualquier persona".
 */

const SHEET_ID = '1YMUl2NumIZ-HGbuJP-l9eYC64wwG5ZJe0aAOvRQcCFY'; // Cambia esto
const DRIVE_FOLDER_ID = '1xOdpr9v0UUq8wOfjtCovxOHC2IfOfbrs'; // Cambia esto

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const accion = data.accion;

    if (accion === "obtenerMetricas") {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Procesos');
      // Lógica simplificada de métricas
      return respuestaJSON({
        totalCompras: 1250000,
        totalPagado: 850000,
        saldoPendiente: 400000,
        complementosFaltantes: 12
      });
    }

    if (accion === "registrarProveedor") {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Proveedores');
      const folderUrl = guardarArchivoDrive(data.csfFile, data.rfc + " - " + data.razonSocial);
      
      sheet.appendRow([
        Utilities.getUuid(), // ID Proveedor
        data.razonSocial,
        data.rfc,
        data.regimenFiscal,
        data.correo,
        data.telefono,
        data.direccion,
        folderUrl,
        "ACTIVO",
        new Date()
      ]);
      return respuestaJSON({ success: true });
    }

    if (accion === "registrarProceso") {
      // Implementación similar para Procesos
      return respuestaJSON({ success: true });
    }

    if (accion === "registrarPago") {
      // Implementación similar para Pagos
      return respuestaJSON({ success: true });
    }

    if (accion === "subirCFDI") {
      return respuestaJSON({ success: true });
    }

    return respuestaJSON({ error: "Acción no reconocida" }, 400);
  } catch (error) {
    return respuestaJSON({ error: error.toString() }, 500);
  }
}

// Función auxiliar para guardar Base64 en Google Drive
function guardarArchivoDrive(fileData, subFolderName) {
  if (!fileData) return "";
  
  const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  
  // Buscar o crear subcarpeta
  let subFolder;
  const folders = parentFolder.getFoldersByName(subFolderName);
  if (folders.hasNext()) {
    subFolder = folders.next();
  } else {
    subFolder = parentFolder.createFolder(subFolderName);
  }

  // Decodificar Base64 y guardar
  const decodedData = Utilities.base64Decode(fileData.data);
  const blob = Utilities.newBlob(decodedData, fileData.mimeType, fileData.name);
  const file = subFolder.createFile(blob);
  
  return file.getUrl();
}

function respuestaJSON(obj, code = 200) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Implementación de OPTIONS para evitar problemas de CORS
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}
