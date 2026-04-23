"use strict";

require("dotenv").config();
const { google } = require("googleapis");

// ─── Constantes ──────────────────────────────────────────────────────────────
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const HOJA_INVENTARIO = "Inventario";
const HOJA_PEDIDOS = "Pedidos";
const HOJA_CALLBACKS = "Callbacks";

// Columnas de la hoja Inventario (índice 0)
// A=SKU, B=Nombre, C=Precio, D=Stock, E=Disponible
const COL = { SKU: 0, NOMBRE: 1, PRECIO: 2, STOCK: 3, DISPONIBLE: 4 };

// ─── Auth ─────────────────────────────────────────────────────────────────────
let _sheetsClient = null;

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  let credentials;
  try {
    credentials =
      typeof process.env.GOOGLE_CREDENTIALS_JSON === "string"
        ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
        : process.env.GOOGLE_CREDENTIALS_JSON;
  } catch (e) {
    throw new Error("GOOGLE_CREDENTIALS_JSON inválido: " + e.message);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Lee todas las filas de una hoja (sin la cabecera).
 */
async function leerHoja(nombreHoja) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${nombreHoja}!A:Z`,
  });
  const rows = res.data.values || [];
  return rows.slice(1); // Quitar cabecera
}

/**
 * Agrega una fila al final de una hoja.
 */
async function agregarFila(nombreHoja, valores) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${nombreHoja}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [valores] },
  });
}

/**
 * Normaliza un texto para comparación (minúsculas, sin acentos, sin espacios extra).
 */
function normalizar(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// ─── API Pública ──────────────────────────────────────────────────────────────

/**
 * Busca una pieza en la hoja Inventario por SKU exacto o coincidencia parcial de nombre.
 * @param {string} query  - SKU o nombre de pieza (puede venir de DTMF o voz)
 * @returns {object|null} - { sku, nombre, precio, stock, disponible } o null si no existe
 */
async function buscarPieza(query) {
  const q = normalizar(query);
  const rows = await leerHoja(HOJA_INVENTARIO);

  // 1. Buscar por SKU exacto primero
  let fila = rows.find((r) => normalizar(r[COL.SKU]) === q);

  // 2. Si no, búsqueda parcial por nombre
  if (!fila) {
    fila = rows.find((r) => normalizar(r[COL.NOMBRE]).includes(q));
  }

  if (!fila) return null;

  return {
    sku: fila[COL.SKU] || "",
    nombre: fila[COL.NOMBRE] || "",
    precio: fila[COL.PRECIO] || "0",
    stock: parseInt(fila[COL.STOCK] || "0", 10),
    disponible: normalizar(fila[COL.DISPONIBLE]) === "si" || normalizar(fila[COL.DISPONIBLE]) === "sí",
  };
}

/**
 * Registra un pedido en la hoja Pedidos.
 * @param {object} data - { telefono, sku, nombre, precio }
 */
async function registrarPedido(data) {
  const fecha = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
  await agregarFila(HOJA_PEDIDOS, [
    fecha,
    data.telefono || "",
    data.sku || "",
    data.nombre || "",
    data.precio || "",
    "Pendiente",
  ]);
}

/**
 * Registra una solicitud de devolución de llamada.
 * @param {string} telefono - Número en formato E.164
 */
async function registrarCallback(telefono) {
  const fecha = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
  await agregarFila(HOJA_CALLBACKS, [fecha, telefono, "Pendiente"]);
}

/**
 * Inicializa las hojas del spreadsheet si no existen (cabeceras).
 * Llama esto una sola vez al arrancar el servidor.
 */
async function inicializarHojas() {
  const sheets = await getSheetsClient();

  // Obtener hojas existentes
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const hojasExistentes = (meta.data.sheets || []).map((s) => s.properties.title);

  const reqs = [];

  // Inventario
  if (!hojasExistentes.includes(HOJA_INVENTARIO)) {
    reqs.push({
      addSheet: { properties: { title: HOJA_INVENTARIO } },
    });
  }

  // Pedidos
  if (!hojasExistentes.includes(HOJA_PEDIDOS)) {
    reqs.push({
      addSheet: { properties: { title: HOJA_PEDIDOS } },
    });
  }

  // Callbacks
  if (!hojasExistentes.includes(HOJA_CALLBACKS)) {
    reqs.push({
      addSheet: { properties: { title: HOJA_CALLBACKS } },
    });
  }

  if (reqs.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: reqs },
    });
  }

  // Escribir cabeceras si la hoja está vacía
  const cabeceras = {
    [HOJA_INVENTARIO]: [["SKU", "Nombre", "Precio", "Stock", "Disponible"]],
    [HOJA_PEDIDOS]: [["Fecha", "Teléfono", "SKU", "Nombre_Pieza", "Precio", "Estado"]],
    [HOJA_CALLBACKS]: [["Fecha", "Teléfono", "Estado"]],
  };

  for (const [hoja, header] of Object.entries(cabeceras)) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${hoja}!A1`,
    });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${hoja}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: header },
      });
    }
  }

  console.log("✅  Google Sheets inicializado correctamente.");
}

module.exports = {
  buscarPieza,
  registrarPedido,
  registrarCallback,
  inicializarHojas,
};
