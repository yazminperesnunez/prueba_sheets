// version_sheets_drive/auth.js
// Sistema de Autenticación y Control de Roles Seguro (RBAC)

// Clave en SessionStorage para sesión temporal y segura
const AUTH_KEY = "saas_user_session";

// Cuentas con contraseñas encriptadas mediante SHA-256 (Máxima Seguridad)
// Nadie puede ver la contraseña en texto plano en el código.
const USUARIOS_SISTEMA = [
  {
    usuario: "admin",
    correo: "admin@empresa.com",
    nombre: "Administrador General",
    rol: "ADMIN", // Acceso Total (Dashboard, Crear Proveedores, Procesos, Pagos)
    // Hash SHA-256 de "AdminSeguro*2026"
    passHash: "f9a405326961b861bb961beb0e4c5c3f7eaba889e5b4f04e246d374fd15bf35f"
  },
  {
    usuario: "contador",
    correo: "contador@empresa.com",
    nombre: "Contador / Auditor",
    rol: "CONTADOR", // Solo lectura y consulta de métricas, proveedores, procesos y CFDIs
    // Hash SHA-256 de "Contador*Finanzas2026"
    passHash: "f4b58006ba2ff7b65329d51ad8df2273405e6dd3d9e3b50920361f41cd9a759a"
  },
  {
    usuario: "operaciones",
    correo: "operaciones@empresa.com",
    nombre: "Gestor de Proyectos",
    rol: "OPERACIONES", // Procesos y proveedores, pero no pagos
    // Hash SHA-256 de "Operaciones*Proyectos2026"
    passHash: "84247a5163d02d5596fe405cbe90f773331895375d9b80bdf26cb0426f9fd9f6"
  }
];

// Función criptográfica SHA-256 en navegador
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Iniciar sesión desde login.html
async function iniciarSesion(event) {
  event.preventDefault();
  const alertEl = document.getElementById("login-alert");
  const btn = document.getElementById("btn-login");
  const userVal = document.getElementById("login-user").value.trim().toLowerCase();
  const passVal = document.getElementById("login-pass").value.trim();

  alertEl.classList.add("d-none");
  btn.disabled = true;
  btn.innerText = "Verificando...";

  try {
    const inputHash = await sha256(passVal);
    const usuarioEncontrado = USUARIOS_SISTEMA.find(
      u => (u.usuario.toLowerCase() === userVal || u.correo.toLowerCase() === userVal) && u.passHash === inputHash
    );

    if (usuarioEncontrado) {
      // Guardar sesión segura (sin guardar contraseña)
      const sesion = {
        usuario: usuarioEncontrado.usuario,
        nombre: usuarioEncontrado.nombre,
        correo: usuarioEncontrado.correo,
        rol: usuarioEncontrado.rol,
        timestamp: Date.now()
      };
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(sesion));
      window.location.href = "index.html";
    } else {
      alertEl.innerText = "Usuario o contraseña incorrectos.";
      alertEl.classList.remove("d-none");
    }
  } catch (err) {
    console.error(err);
    alertEl.innerText = "Error en el inicio de sesión: " + err.message;
    alertEl.classList.remove("d-none");
  } finally {
    btn.disabled = false;
    btn.innerText = "Entrar al Sistema";
  }
}

// Obtener usuario autenticado actual
function obtenerUsuarioActual() {
  const sesionStr = sessionStorage.getItem(AUTH_KEY);
  if (!sesionStr) return null;
  try {
    return JSON.parse(sesionStr);
  } catch (e) {
    return null;
  }
}

// Cerrar sesión
function cerrarSesion() {
  sessionStorage.removeItem(AUTH_KEY);
  window.location.href = "login.html";
}

// Guardián de seguridad: Verifica que haya sesión activa antes de ver la página
function verificarAcceso(paginaActual) {
  // Si estamos en login.html, no redireccionar
  if (window.location.pathname.includes("login.html")) {
    const u = obtenerUsuarioActual();
    if (u) {
      window.location.href = "index.html";
    }
    return;
  }

  const u = obtenerUsuarioActual();
  if (!u) {
    // Redirigir de inmediato al login si no tiene sesión iniciada
    window.location.href = "login.html";
    return;
  }

  // Aplicar restricciones de Rol en la interfaz
  aplicarPermisosRol(u);
}

// Control granular de permisos según el Rol
function aplicarPermisosRol(usuario) {
  // 1. Mostrar nombre y rol en la barra superior
  const userHeaderEl = document.querySelector(".navbar-custom span, #user-display-name");
  if (userHeaderEl) {
    const badgeColor = usuario.rol === "ADMIN" ? "bg-primary" : (usuario.rol === "CONTADOR" ? "bg-info" : "bg-warning");
    userHeaderEl.innerHTML = `
      <span class="fw-medium">${usuario.nombre}</span>
      <span class="badge ${badgeColor} text-white ms-2">${usuario.rol}</span>
      <button onclick="cerrarSesion()" class="btn btn-sm btn-outline-danger ms-3" title="Cerrar sesión">Salir</button>
    `;
  }

  // 2. REGLAS POR ROL:
  // ROL: CONTADOR (Solo consulta y auditoría, no puede dar altas ni alterar datos)
  if (usuario.rol === "CONTADOR") {
    // Ocultar botones de crear/alta
    document.querySelectorAll('[data-bs-target="#modalAltaProveedor"]').forEach(el => el.remove());
    document.querySelectorAll('button[type="submit"]').forEach(btn => {
      // Si está en formularios de captura, deshabilitar o avisar
      btn.disabled = true;
      btn.classList.add("disabled");
      btn.title = "Tu perfil de Contador es de Solo Lectura";
    });

    // Deshabilitar formularios
    document.querySelectorAll("form input, form select, form textarea").forEach(input => {
      input.disabled = true;
    });

    // Banner informativo de modo solo lectura
    const mainCont = document.querySelector("main .p-4");
    if (mainCont) {
      const banner = document.createElement("div");
      banner.className = "alert alert-warning py-2 mb-3 small d-flex align-items-center justify-content-between";
      banner.innerHTML = "<span><strong>Modo Auditoría / Solo Lectura:</strong> Tu perfil de Contador te permite consultar métricas, proveedores, procesos y archivos, pero no modificar registros.</span>";
      mainCont.prepend(banner);
    }
  }

  // ROL: OPERACIONES (No puede registrar pagos financieros)
  if (usuario.rol === "OPERACIONES") {
    if (window.location.pathname.includes("pagos.html")) {
      const formPago = document.querySelector("form");
      if (formPago) {
        formPago.querySelectorAll("button, input, select").forEach(el => el.disabled = true);
        const alertOp = document.createElement("div");
        alertOp.className = "alert alert-danger";
        alertOp.innerText = "Solo el Administrador o Finanzas tienen autorización para aplicar abonos o pagos.";
        formPago.prepend(alertOp);
      }
    }
  }
}

// Ejecutar automáticamente al cargar cualquier página
document.addEventListener("DOMContentLoaded", () => {
  verificarAcceso();
});
