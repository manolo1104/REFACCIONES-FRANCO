"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });
const { google } = require("googleapis");

// ─── Constantes ──────────────────────────────────────────────────────────────
const SHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEETS_ID;
const HOJAS_INVENTARIO_CANDIDATAS = ["Inventarios", "Inventario"];
let HOJA_INVENTARIO = "Inventarios";
const HOJA_PEDIDOS = "Pedidos";
const HOJA_CALLBACKS = "Callbacks";

// Columnas por defecto de la hoja Inventario (si no se detectan cabeceras)
const COL_DEFAULT = { SKU: 0, NOMBRE: 1, PRECIO: 2, STOCK: 3, DISPONIBLE: 4, MARCA: 4, VEHICULO: 5 };

// ─── Auth ─────────────────────────────────────────────────────────────────────
let _sheetsClient = null;

function getGoogleCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      return typeof process.env.GOOGLE_CREDENTIALS_JSON === "string"
        ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
        : process.env.GOOGLE_CREDENTIALS_JSON;
    } catch (e) {
      throw new Error("GOOGLE_CREDENTIALS_JSON inválido: " + e.message);
    }
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      type: "service_account",
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }

  throw new Error(
    "Faltan credenciales de Google. Usa GOOGLE_CREDENTIALS_JSON o GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY"
  );
}

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  const credentials = getGoogleCredentials();

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

async function leerHojaCompleta(nombreHoja) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${nombreHoja}!A:Z`,
  });
  return res.data.values || [];
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

function detectarHojaInventarioPorTitulos(titulos) {
  const mapa = new Map((titulos || []).map((t) => [normalizar(t), t]));

  for (const candidata of HOJAS_INVENTARIO_CANDIDATAS) {
    const encontrada = mapa.get(normalizar(candidata));
    if (encontrada) return encontrada;
  }

  return HOJAS_INVENTARIO_CANDIDATAS[0];
}

function obtenerIndiceColumna(headers, candidatos, fallbackIndex) {
  const normalizados = (headers || []).map((h) => normalizar(h));
  for (const candidato of candidatos) {
    const idx = normalizados.findIndex((h) => h === normalizar(candidato));
    if (idx >= 0) return idx;
  }
  return fallbackIndex;
}

function leerIndiceColumnaEnv(nombreVariable, fallbackIndex) {
  const raw = process.env[nombreVariable];
  if (!raw) return fallbackIndex;

  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallbackIndex;

  // En .env el usuario define columnas en base 1 (A=1, B=2, ...)
  return n - 1;
}

function obtenerColumnasInventario(headers) {
  const detectadas = {
    SKU: obtenerIndiceColumna(headers, ["sku", "codigo", "código", "clave"], COL_DEFAULT.SKU),
    NOMBRE: obtenerIndiceColumna(headers, ["nombre", "pieza", "descripcion", "descripción"], COL_DEFAULT.NOMBRE),
    PRECIO: obtenerIndiceColumna(headers, ["precio", "precio publico", "precio público", "costo"], COL_DEFAULT.PRECIO),
    STOCK: obtenerIndiceColumna(
      headers,
      ["stock", "existencia", "existencias", "inventario", "cantidad", "piezas", "pzas", "unidades"],
      COL_DEFAULT.STOCK
    ),
    DISPONIBLE: obtenerIndiceColumna(
      headers,
      ["disponible", "estatus", "estado", "hay", "activo", "publicado"],
      COL_DEFAULT.DISPONIBLE
    ),
    MARCA: obtenerIndiceColumna(headers, ["marca"], COL_DEFAULT.MARCA),
    VEHICULO: obtenerIndiceColumna(headers, ["vehiculo", "vehículo", "modelo", "auto", "carro"], COL_DEFAULT.VEHICULO),
  };

  return {
    SKU: leerIndiceColumnaEnv("INV_COL_SKU", detectadas.SKU),
    NOMBRE: leerIndiceColumnaEnv("INV_COL_NOMBRE", detectadas.NOMBRE),
    PRECIO: leerIndiceColumnaEnv("INV_COL_PRECIO", detectadas.PRECIO),
    STOCK: leerIndiceColumnaEnv("INV_COL_STOCK", detectadas.STOCK),
    DISPONIBLE: leerIndiceColumnaEnv("INV_COL_DISPONIBLE", detectadas.DISPONIBLE),
    MARCA: leerIndiceColumnaEnv("INV_COL_MARCA", detectadas.MARCA),
    VEHICULO: leerIndiceColumnaEnv("INV_COL_VEHICULO", detectadas.VEHICULO),
  };
}

function coincideVehiculo(marca, vehiculo, vehiculoQuery) {
  const q = normalizar(vehiculoQuery || "");
  if (!q) return true;

  const base = `${normalizar(marca)} ${normalizar(vehiculo)}`.trim();
  if (!base) return false;

  const tokens = q.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return base.includes(q);
  return tokens.every((t) => base.includes(t));
}

function esProbableCodigo(valor) {
  const v = String(valor || "").trim();
  if (!v) return false;
  return /^[A-Z0-9\-_.\s]+$/i.test(v) && !/[aeiouáéíóú]/i.test(v);
}

function esProbableNombre(valor) {
  const v = String(valor || "").trim();
  if (!v) return false;
  return /[a-záéíóúñ]/i.test(v) && /[aeiouáéíóú]/i.test(v);
}

function inferirStockDesdeFila(fila, stockActual, sku, precio) {
  if (Number.isFinite(stockActual)) return stockActual;

  const skuNorm = normalizar(sku);
  const precioNorm = normalizar(precio);

  for (const celda of fila) {
    const texto = String(celda || "").trim();
    if (!texto) continue;

    const tNorm = normalizar(texto);
    if (tNorm === skuNorm || tNorm === precioNorm) continue;

    // Evitar precio decimal, preferir enteros de stock.
    if (/^\d+$/.test(texto)) {
      const n = parseInt(texto, 10);
      if (Number.isFinite(n)) return n;
    }
  }

  return 0;
}

function inferirDisponibleDesdeFila(fila, disponibleActual, stockNum) {
  const actualNorm = normalizar(disponibleActual);
  if (["si", "sí", "no", "true", "false", "1", "0"].includes(actualNorm)) {
    return actualNorm === "si" || actualNorm === "sí" || actualNorm === "true" || actualNorm === "1";
  }

  for (const celda of fila) {
    const v = normalizar(celda);
    if (["si", "sí", "true", "1", "disponible"].includes(v)) return true;
    if (["no", "false", "0", "agotado", "sin stock"].includes(v)) return false;
  }

  // Si no hay columna/valor de disponible, inferir por stock.
  return Number.isFinite(stockNum) ? stockNum > 0 : false;
}

// ─── API Pública ──────────────────────────────────────────────────────────────

/**
 * Busca una pieza en la hoja Inventario por SKU exacto o coincidencia parcial de nombre.
 * @param {string} query  - SKU o nombre de pieza (puede venir de DTMF o voz)
 * @returns {object|null} - { sku, nombre, precio, stock, disponible } o null si no existe
 */
async function buscarPieza(query, options = {}) {
  const q = normalizar(query);
  const vehiculoQuery = options.vehiculo || "";
  const valores = await leerHojaCompleta(HOJA_INVENTARIO);
  if (valores.length === 0) return null;

  const headers = valores[0] || [];
  const rows = valores.slice(1);
  const COL = obtenerColumnasInventario(headers);

  // 1) SKU exacto
  let candidatas = rows.filter((r) => normalizar(r[COL.SKU]) === q);

  // 2) nombre parcial
  if (candidatas.length === 0) {
    candidatas = rows.filter((r) => normalizar(r[COL.NOMBRE]).includes(q));
  }

  // 3) búsqueda global
  if (candidatas.length === 0) {
    candidatas = rows.filter((r) =>
      (r || []).some((celda) => normalizar(celda).includes(q))
    );
  }

  if (candidatas.length === 0) return null;

  let fila = candidatas[0];
  if (vehiculoQuery) {
    const matchVehiculo = candidatas.find((r) =>
      coincideVehiculo(r[COL.MARCA], r[COL.VEHICULO], vehiculoQuery)
    );
    if (matchVehiculo) fila = matchVehiculo;
  }

  let sku = fila[COL.SKU] || "";
  let nombre = fila[COL.NOMBRE] || "";
  const precio = fila[COL.PRECIO] || "0";

  // Heurística: si nombre parece código y sku parece nombre, intercambiar.
  if (esProbableCodigo(nombre) && esProbableNombre(sku)) {
    const tmp = sku;
    sku = nombre;
    nombre = tmp;
  }

  const stockInicial = parseInt(fila[COL.STOCK] || "", 10);
  const stockNum = inferirStockDesdeFila(fila, stockInicial, sku, precio);
  const disponibleBool = inferirDisponibleDesdeFila(fila, fila[COL.DISPONIBLE], stockNum);

  return {
    sku,
    nombre,
    precio,
    stock: Number.isFinite(stockNum) ? stockNum : 0,
    disponible: disponibleBool,
    marca: fila[COL.MARCA] || "",
    vehiculo: fila[COL.VEHICULO] || "",
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
  const hojasExistentes = (meta.data.sheets || []).map((s) => s.properties.title || "");
  const hojasExistentesNormalizadas = new Set(hojasExistentes.map((titulo) => normalizar(titulo)));
  HOJA_INVENTARIO = detectarHojaInventarioPorTitulos(hojasExistentes);

  const reqs = [];

  // Inventario
  const hayInventario = HOJAS_INVENTARIO_CANDIDATAS.some((h) =>
    hojasExistentesNormalizadas.has(normalizar(h))
  );

  if (!hayInventario) {
    reqs.push({
      addSheet: { properties: { title: HOJA_INVENTARIO } },
    });
  }

  // Pedidos
  if (!hojasExistentesNormalizadas.has(normalizar(HOJA_PEDIDOS))) {
    reqs.push({
      addSheet: { properties: { title: HOJA_PEDIDOS } },
    });
  }

  // Callbacks
  if (!hojasExistentesNormalizadas.has(normalizar(HOJA_CALLBACKS))) {
    reqs.push({
      addSheet: { properties: { title: HOJA_CALLBACKS } },
    });
  }

  if (reqs.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: reqs },
    });

    if (!hayInventario) {
      HOJA_INVENTARIO = HOJAS_INVENTARIO_CANDIDATAS[0];
    }
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
