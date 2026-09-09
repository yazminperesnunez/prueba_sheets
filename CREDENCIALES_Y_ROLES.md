# 🔐 Credenciales y Matriz de Permisos del Sistema

Este sistema cuenta con **Seguridad Criptográfica SHA-256** y **Control de Acceso Basado en Roles (RBAC)** en dos niveles:
1. **Nivel Frontend:** Oculta y deshabilita botones, formularios y acciones según el rol.
2. **Nivel Backend (`backend.gs`):** Valida que ninguna petición no autorizada pueda alterar Google Sheets ni Google Drive.

---

## 👥 Usuarios y Contraseñas para Compartir

| Usuario | Contraseña | Rol / Perfil | Qué puede hacer | Qué tiene bloqueado |
| :--- | :--- | :--- | :--- | :--- |
| **`admin`** | `AdminSeguro*2026` | **ADMINISTRADOR** | **Acceso Total:** Ver métricas, dar de alta proveedores, aperturar y seguir procesos, registrar pagos y descargar archivos. | Ninguna restricción. |
| **`contador`** | `Contador*Finanzas2026` | **CONTADOR / AUDITOR** | **Solo Lectura & Auditoría:** Ver KPIs del Dashboard, ver tabla de proveedores, abrir documentos en Google Drive, ver procesos activos y verificar CFDIs. | ❌ Bloqueado botón "+ Nuevo Proveedor".<br>❌ Bloqueado apertura de procesos.<br>❌ Bloqueado registrar pagos.<br>❌ Bloqueadas modificaciones tanto en pantalla como en el backend. |
| **`operaciones`** | `Operaciones*Proyectos2026` | **GESTOR DE OPERACIONES** | **Gestión de Proyectos:** Dar de alta proveedores, aperturar procesos, subir cotizaciones y contratos en Drive. | ❌ Bloqueado módulo de Pagos (no puede registrar abonos ni alterar saldos financieros). |

---

## 🛡️ Características de Seguridad Implementadas

1. **Pantalla de Inicio de Sesión ([`login.html`](file:///c:/Users/yazmi/Documents/nousarsgroup/version_sheets_drive/login.html)):**
   * Cualquier persona que intente entrar directamente a `index.html`, `proveedores.html`, `procesos.html` o `pagos.html` sin haber iniciado sesión es **redireccionada automáticamente al login**.
2. **Encriptación SHA-256:**
   * Las contraseñas **no viajan ni se guardan en texto plano**. El navegador calcula el hash criptográfico SHA-256 antes de validar.
3. **Barra Superior con Sesión Activa:**
   * Muestra el nombre del usuario conectado, su distintivo de Rol (`ADMIN`, `CONTADOR`, `OPERACIONES`) y un botón rojo de **"Salir"** para cerrar sesión de inmediato.
4. **Protección en Google Apps Script (`backend.gs`):**
   * Aunque alguien intente modificar el HTML desde la consola del navegador, si la petición proviene del rol `CONTADOR`, el servidor rechaza la escritura con un error `403 Acceso Denegado`.
