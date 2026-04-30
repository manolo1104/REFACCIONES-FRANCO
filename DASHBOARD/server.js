"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const express = require("express");
const path = require("path");
const https = require("https");
const { google } = require("googleapis");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = process.env.DASHBOARD_PORT || 4000;
app.use(express.static(__dirname));
app.use(express.json());

const YEARS = (process.env.DASHBOARD_YEARS || "2024,2023,2022,2021,2020")
  .split(",")
  .map(y => y.trim());

// ── Cache en memoria con TTL ──────────────────────────────────────
const CACHE_TTL = (parseInt(process.env.CACHE_TTL_MIN) || 5) * 60 * 1000;
const _cache = {};

function getCached(key) {
  const e = _cache[key];
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { delete _cache[key]; return null; }
  return e.data;
}
function setCached(key, data) { _cache[key] = { data, ts: Date.now() }; }
function clearCache() { Object.keys(_cache).forEach(k => delete _cache[k]); }

// ── Google Sheets ─────────────────────────────────────────────────
function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

function parseMXN(v) {
  if (!v || v === "") return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, "").trim());
  return isNaN(n) ? null : n;
}
function parsePct(v) {
  if (!v || v === "") return null;
  const n = parseFloat(String(v).replace(/[%\s]/g, "").trim());
  return isNaN(n) ? null : n;
}
function parseX(v) {
  if (!v || v === "") return null;
  const n = parseFloat(String(v).replace(/[xX\s]/g, "").trim());
  return isNaN(n) ? null : n;
}

async function getRange(hoja, rango) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: hoja + "!" + rango,
  });
  return res.data.values || [];
}

function findRow(rows, label) {
  return rows.find(function(r) {
    return r[0] && r[0].toString().trim().toLowerCase().startsWith(label.toLowerCase());
  });
}

function findRowWithValue(rows, label, colIndex) {
  const matches = rows.filter(function(r) {
    return r[0] && r[0].toString().trim().toLowerCase().startsWith(label.toLowerCase());
  });
  if (!matches.length) return null;
  const withVal = matches.find(function(r) {
    return r[colIndex] !== undefined && String(r[colIndex]).trim() !== "";
  });
  return withVal || matches[matches.length - 1];
}

// ══════════════════════════════════════════════════════════════════
// FUNCIONES DE DATOS — compartidas entre endpoints y chat
// ══════════════════════════════════════════════════════════════════

async function fetchEstadoResultados() {
  const cached = getCached("estado-resultados");
  if (cached) return cached;
  const rows = await getRange("ESTADO_DE_RESULTADOS", "A1:F25");
  const data = YEARS.map(function(ano, i) {
    return {
      ano,
      ventasNetas:         parseMXN(findRow(rows,"Ventas Netas")?.[i+1]),
      costoVentas:         parseMXN(findRow(rows,"Costo de Ventas")?.[i+1]),
      utilidadBruta:       parseMXN(findRow(rows,"Utilidad Bruta")?.[i+1]),
      gastosVenta:         parseMXN(findRow(rows,"Gasto de ventas")?.[i+1]),
      utilidadOperativa:   parseMXN(findRow(rows,"Utilidad operativa")?.[i+1]),
      otrosIngresos:       parseMXN(findRow(rows,"Otros Ingresos")?.[i+1]),
      gastosFinancieros:   parseMXN(findRow(rows,"Gastos financieros")?.[i+1]),
      utilidadAntesImptos: parseMXN(findRow(rows,"Utilidad Antes")?.[i+1]),
      impuestos:           parseMXN(findRow(rows,"Impuestos")?.[i+1]),
      utilidadNeta:        parseMXN(findRow(rows,"Utilidad Neta")?.[i+1]),
    };
  });
  setCached("estado-resultados", data);
  return data;
}

async function fetchBalance() {
  const cached = getCached("balance");
  if (cached) return cached;
  const rows = await getRange("BALANCE_GENERAL", "A1:I45");
  const data = YEARS.map(function(ano, i) {
    const col = i + 4;
    return {
      ano,
      cajaBancos:      parseMXN(findRow(rows,"Caja")?.[col]),
      inversionesFin:  parseMXN(findRow(rows,"Inversiones")?.[col]),
      cuentasCobrar:   parseMXN(findRow(rows,"Clientes")?.[col]),
      existencias:     parseMXN(findRow(rows,"Existencias")?.[col]),
      totalCirculante: parseMXN(findRow(rows,"TOTAL ACTIVO CIRCULANTE")?.[col]),
      totalFijo:       parseMXN(findRow(rows,"TOTAL ACTIVO FIJO")?.[col]),
      totalActivo:     parseMXN(findRow(rows,"TOTAL ACTIVO")?.[col]),
      proveedores:     parseMXN(findRow(rows,"Proveedores")?.[col]),
      impuestosPagar:  parseMXN(findRow(rows,"Impuestos por Pagar")?.[col]),
      totalPasivoCP:   parseMXN(findRow(rows,"TOTAL PASIVO CORTO PLAZO")?.[col]),
    };
  });
  setCached("balance", data);
  return data;
}

async function fetchResumen() {
  const cached = getCached("resumen");
  if (cached) return cached;
  const rows = await getRange("RESUMEN", "A1:G50");
  const data = YEARS.map(function(ano, i) {
    return {
      ano,
      roe:             parsePct(findRow(rows,"DUPONT")?.[i+2]),
      margenNeto:      parsePct(findRow(rows,"MRGEN NETO")?.[i+2]),
      rotacionActivos: parseX(findRow(rows,"ROTACION ACTIVOS")?.[i+2]),
      multiplicador:   parseX(findRow(rows,"MULTIPLICADOR")?.[i+2]),
      crecNominal:     parsePct(findRow(rows,"CRECIMIENTO VENTAS NOMINAL")?.[i+2]),
      crecReal:        parsePct(findRow(rows,"CRECIMIENTO VENTAS REAL")?.[i+2]),
      margenOperativo: parsePct(findRow(rows,"MARGEN OPERATIVO")?.[i+2]),
      pctGastos:       parsePct(findRow(rows,"% GTOS")?.[i+2]),
      tasaImpuestos:   parsePct(findRow(rows,"TASA EFECTIVA")?.[i+2]),
      ebitda:          parsePct(findRow(rows,"% EBITDA")?.[i+2]),
    };
  });
  setCached("resumen", data);
  return data;
}

async function fetchRatios() {
  const cached = getCached("ratios");
  if (cached) return cached;
  const rows = await getRange("RATIOS", "A1:F30");
  const data = YEARS.map(function(ano, i) {
    const col = i + 1;
    return {
      ano,
      rentabilidadFin:  parsePct(findRowWithValue(rows,"Rentabilidad Financiera", col)?.[col]),
      rentabilidadEcon: parsePct(findRowWithValue(rows,"Rentabilidad Econ", col)?.[col]),
      margenUtilidad:   parsePct(findRowWithValue(rows,"Margen Utilidad", col)?.[col]),
      capitalTrabajo:   parseMXN(findRowWithValue(rows,"Capital de Trabajo", col)?.[col]),
      liquidez:         parseX(findRowWithValue(rows,"Liquidez", col)?.[col]),
      endeudamiento:    parseX(findRowWithValue(rows,"Endeudamiento", col)?.[col]),
      solvencia:        parseX(findRowWithValue(rows,"Solvencia", col)?.[col]),
      rotacionActivo:   parseX(findRowWithValue(rows,"Rotación activo", col)?.[col]),
      zScore:           parseMXN(findRowWithValue(rows,"Z SCORE", col)?.[col]),
    };
  });
  setCached("ratios", data);
  return data;
}

function getMonthMultiplier(mes) {
  const m = parseInt(mes) || 4;
  const factores = {
    1: 0.72,  // enero — arranque lento
    2: 0.78,  // febrero
    3: 0.88,  // marzo
    4: 1.00,  // abril — base
    5: 1.05,  // mayo
    6: 1.02,  // junio
    7: 0.95,  // julio — vacaciones
    8: 0.93,  // agosto
    9: 1.08,  // septiembre — repunte
    10: 1.12, // octubre — temporada alta
    11: 1.10, // noviembre — buen mes
    12: 0.85  // diciembre — fin año
  };
  return factores[m] || 1.0;
}

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function getOperacionesData(mes) {
  const f = getMonthMultiplier(mes);
  const m = parseInt(mes) || 4;
  const meses = MONTH_NAMES.slice(0, m);
  // DIO base: reducción lineal desde 62, con factor de mes
  const dioBase = [62, 59, 56, 54, 52, 51, 53, 55, 50, 48, 49, 58];
  const dioPorMes = dioBase.slice(0, m);
  return {
    inventario: {
      valor: Math.round(64200000 * f), rotacion: parseFloat((6.8 * f).toFixed(1)),
      dio: parseFloat((53.7 * (1 / f * 0.5 + 0.5)).toFixed(1)),
      skuQuiebre: Math.round(142 * (1.1 - f * 0.1)), totalSkus: 4820,
      dioPorMes,
      meses,
      porCategoria: { Motor:34, Frenos:22, Suspension:18, Electrico:15, Otros:11 }
    },
    proveedores: {
      nivelServicio: parseFloat((91.4 * Math.min(1, f * 0.99 + 0.01)).toFixed(1)),
      ordenesEmitidas: Math.round(347 * f),
      entregadasTiempo: Math.round(318 * f),
      proveedoresActivos: 62, exposicionUSD: Math.round(1240000 * f),
      ahorroNegociacion: Math.round(2800000 * f),
      varPrecio: [4.1,8.2,5.6,6.8,5.9],
      inpc:       [3.4,7.8,4.7,4.2,3.8],
      anos: ["2021","2022","2023","2024","2025E"],
      lista: [
        { nombre:"ACDelco / GM",    pais:"USA", leadTime:12, varPrecio:4.2, estatus:"ok"   },
        { nombre:"Bosch México",    pais:"MEX", leadTime:5,  varPrecio:6.1, estatus:"warn" },
        { nombre:"Denso Intl.",     pais:"JPN", leadTime:28, varPrecio:2.8, estatus:"ok"   },
        { nombre:"Gates Industrial",pais:"USA", leadTime:18, varPrecio:9.3, estatus:"err"  },
        { nombre:"SKF México",      pais:"MEX", leadTime:4,  varPrecio:3.5, estatus:"ok"   },
        { nombre:"Hyundai Mobis",   pais:"KOR", leadTime:35, varPrecio:7.4, estatus:"warn" }
      ]
    }
  };
}

function getVentasData(mes) {
  const f = getMonthMultiplier(mes);
  const m = parseInt(mes) || 4;
  const meses = MONTH_NAMES.slice(0, m);
  // Datos base de ventas mensuales 2025 y 2024 (abril=base)
  const base2025 = [44.2,46.8,45.1,46.3,48.6,47.2,43.9,43.0,49.8,51.7,50.7,39.2];
  const base2024 = [39.8,41.2,40.3,41.5,43.7,42.4,39.5,38.7,44.8,46.5,45.6,35.3];
  return {
    kpis: {
      pedidosMes: Math.round(2841 * f),
      ticketPromedio: Math.round(16180 * f),
      clientesActivos: Math.round(1247 * (0.9 + f * 0.1)),
      fillRate: parseFloat(Math.min(99, 94.8 * f).toFixed(1)),
      pedidosDelta: 7.2, ticketDelta: 3.4, clientesDelta: 82, fillRateMeta: 95.7
    },
    ventasMensuales: {
      meses,
      "2025": base2025.slice(0, m),
      "2024": base2024.slice(0, m)
    },
    ventasPorCanal: { labels:["Mayoristas","Talleres directos","E-commerce","Otros"], data:[48,31,13,8] }
  };
}

function getComprasData(mes) {
  const f = getMonthMultiplier(mes);
  const m = parseInt(mes) || 4;
  const meses = MONTH_NAMES.slice(0, m);
  // Generar fechas de órdenes apropiadas al mes
  const mesStr = String(m).padStart(2,'0');
  const nextMes = String(m < 12 ? m + 1 : 1).padStart(2,'0');
  const baseNacional    = [6.2, 6.8, 6.1, 7.1, 7.4, 7.2, 6.7, 6.5, 7.7, 8.0, 7.8, 6.0];
  const baseImportacion = [2.9, 3.2, 3.0, 3.4, 3.6, 3.5, 3.2, 3.1, 3.7, 3.8, 3.7, 2.9];
  return {
    kpis: {
      ordenesAbiertas: Math.round(47 * f),
      valorOrdenesAbiertas: Math.round(3200000 * f),
      pctNacional: 68, pctImportacion: 32,
      ordenesConRetraso: Math.round(8 * (1.1 - f * 0.1))
    },
    ordenesRecientes: [
      { id:"OC-2025-1847", proveedor:"ACDelco / GM",    tipo:"Nacional",    fechaEmision:`18/${mesStr}/2026`, fechaEntrega:`30/${mesStr}/2026`, monto:Math.round(284500*f),  estatus:"En Tránsito" },
      { id:"OC-2025-1848", proveedor:"Denso Intl.",     tipo:"Importación", fechaEmision:`15/${mesStr}/2026`, fechaEntrega:`13/${nextMes}/2026`, monto:Math.round(612000*f),  estatus:"Pendiente"   },
      { id:"OC-2025-1849", proveedor:"Bosch México",    tipo:"Nacional",    fechaEmision:`20/${mesStr}/2026`, fechaEntrega:`25/${mesStr}/2026`, monto:Math.round(198000*f),  estatus:"Con Retraso" },
      { id:"OC-2025-1850", proveedor:"SKF México",      tipo:"Nacional",    fechaEmision:`21/${mesStr}/2026`, fechaEntrega:`25/${mesStr}/2026`, monto:Math.round(143200*f),  estatus:"Recibida"    },
      { id:"OC-2025-1851", proveedor:"Gates Industrial",tipo:"Importación", fechaEmision:`10/${mesStr}/2026`, fechaEntrega:`28/${mesStr}/2026`, monto:Math.round(537800*f),  estatus:"Con Retraso" },
      { id:"OC-2025-1852", proveedor:"Hyundai Mobis",   tipo:"Importación", fechaEmision:`08/${mesStr}/2026`, fechaEntrega:`13/${nextMes}/2026`, monto:Math.round(892000*f),  estatus:"En Tránsito" },
      { id:"OC-2025-1853", proveedor:"ACDelco / GM",    tipo:"Nacional",    fechaEmision:`22/${mesStr}/2026`, fechaEntrega:`04/${nextMes}/2026`, monto:Math.round(321500*f),  estatus:"Pendiente"   },
      { id:"OC-2025-1854", proveedor:"Bosch México",    tipo:"Nacional",    fechaEmision:`23/${mesStr}/2026`, fechaEntrega:`29/${mesStr}/2026`, monto:Math.round(211000*f),  estatus:"Pendiente"   }
    ],
    comprasMensuales: {
      meses,
      nacional:    baseNacional.slice(0, m).map(v => parseFloat((v * f).toFixed(1))),
      importacion: baseImportacion.slice(0, m).map(v => parseFloat((v * f).toFixed(1)))
    },
    sugerenciasCompra: [
      { sku:"SKU-4821", descripcion:"Balata Delantera Bosch Cerámico",    categoria:"Frenos",     stockActual:12, stockMinimo:50,  ventasMes:78,  qtySugerida:120, proveedor:"Bosch México"    },
      { sku:"SKU-2047", descripcion:"Filtro de Aceite ACDelco PF47E",     categoria:"Motor",      stockActual:8,  stockMinimo:100, ventasMes:145, qtySugerida:300, proveedor:"ACDelco / GM"    },
      { sku:"SKU-3312", descripcion:"Amortiguador Delantero Gabriel G57", categoria:"Suspensión", stockActual:3,  stockMinimo:20,  ventasMes:32,  qtySugerida:60,  proveedor:"Gates Industrial" },
      { sku:"SKU-1189", descripcion:"Banda Distribución Gates T218",      categoria:"Motor",      stockActual:15, stockMinimo:40,  ventasMes:52,  qtySugerida:80,  proveedor:"Gates Industrial" },
      { sku:"SKU-5503", descripcion:"Cojinete Rueda SKF BR930748",        categoria:"Suspensión", stockActual:6,  stockMinimo:25,  ventasMes:38,  qtySugerida:70,  proveedor:"SKF México"      },
      { sku:"SKU-0874", descripcion:"Alternador Denso 210-4165",          categoria:"Eléctrico",  stockActual:2,  stockMinimo:10,  ventasMes:14,  qtySugerida:24,  proveedor:"Denso Intl."     }
    ],
    comisionesVendedor: [
      { vendedor:"JOSE LUIS BADILLO",        ventasBrutas:3869620.64, devoluciones:205563.38, totalNeto:3664057.26, comision:36640.57 },
      { vendedor:"CASILDO LOPEZ",             ventasBrutas:3163696.03, devoluciones:184854.63, totalNeto:2978841.40, comision:29788.41 },
      { vendedor:"MIGUEL MEDINA",             ventasBrutas:1884853.52, devoluciones:76517.97,  totalNeto:1808335.55, comision:18083.36 },
      { vendedor:"HUMBERTO SANTANA BARRERA",  ventasBrutas:1816163.78, devoluciones:92335.43,  totalNeto:1723828.35, comision:17238.28 },
      { vendedor:"OLIMPO ORTIZ NAVARRO",      ventasBrutas:1750762.49, devoluciones:88403.96,  totalNeto:1662358.53, comision:16623.59 },
      { vendedor:"GERARDO SANTANA",           ventasBrutas:1773348.46, devoluciones:119724.36, totalNeto:1653624.10, comision:16536.24 },
      { vendedor:"CESAR MARTINEZ",            ventasBrutas:1703899.41, devoluciones:80216.30,  totalNeto:1623683.11, comision:16236.83 },
      { vendedor:"MIGUEL ANGEL GONZALEZ",     ventasBrutas:1569665.77, devoluciones:56238.99,  totalNeto:1513426.78, comision:15134.27 },
      { vendedor:"JORGE RAMIREZ",             ventasBrutas:1451954.15, devoluciones:66348.12,  totalNeto:1385606.03, comision:13856.06 },
      { vendedor:"SAMUEL E. ORTIZ GONZALES",  ventasBrutas:1317671.63, devoluciones:94751.81,  totalNeto:1222919.82, comision:12229.20 },
      { vendedor:"GUILLERMO FRANCO",          ventasBrutas:769637.37,  devoluciones:9390.24,   totalNeto:760247.13,  comision:7602.48  },
      { vendedor:"ERICK ANGELES",             ventasBrutas:837858.58,  devoluciones:87560.89,  totalNeto:750297.69,  comision:7502.98  },
      { vendedor:"GUILLERMO RAMIREZ",         ventasBrutas:32695.49,   devoluciones:2520.24,   totalNeto:30175.25,   comision:301.75   },
      { vendedor:"ANTONIO DOMINGUEZ",         ventasBrutas:4941.20,    devoluciones:0,          totalNeto:4941.20,    comision:49.41    }
    ],
    costoPorLinea: [
      { linea:"Motor",      ventas:63900000, costo:41535000, margenBruto:22365000, pctMargen:35.0 },
      { linea:"Frenos",     ventas:40800000, costo:28354800, margenBruto:12445200, pctMargen:30.5 },
      { linea:"Suspensión", ventas:32800000, costo:22100000, margenBruto:10700000, pctMargen:32.6 },
      { linea:"Eléctrico",  ventas:25500000, costo:17595000, margenBruto:7905000,  pctMargen:31.0 },
      { linea:"Otros",      ventas:18500000, costo:12838000, margenBruto:5662000,  pctMargen:30.6 }
    ]
  };
}

function getCrmData(mes) {
  const f = getMonthMultiplier(mes);
  const m = parseInt(mes) || 4;
  const mesStr = String(m).padStart(2,'0');
  // Generar fechas del mes seleccionado para interacciones
  const d = (dia) => `${String(dia).padStart(2,'0')}/${mesStr}/2026`;
  return {
    kpisCrm: {
      totalContactos: 5413,
      interaccionesMes: Math.round(847 * f),
      cotizacionesAbiertas: Math.round(163 * f),
      sinActividad30d: Math.round(412 * (1.1 - f * 0.1))
    },
    cxc: {
      saldoTotal: Math.round(379338 * f),
      carteraVencidaPct: parseFloat((4.1 * (1.05 - f * 0.05)).toFixed(1)),
      clientesCredito: 127,
      dso: Math.round(18 * (1.05 - f * 0.05))
    },
    clientesPendientes: [
      { cliente:"Auto Express del Norte", segmento:"A", limiteCredito:150000, saldoActual:Math.round(89200*f),  diasVencido:0,  estatus:"Al corriente"  },
      { cliente:"Distribuidora Montes",   segmento:"A", limiteCredito:130000, saldoActual:Math.round(74500*f),  diasVencido:8,  estatus:"Al corriente"  },
      { cliente:"Refacciones El Águila",  segmento:"A", limiteCredito:120000, saldoActual:Math.round(62100*f),  diasVencido:35, estatus:"En seguimiento" },
      { cliente:"Taller Los Pinos",       segmento:"B", limiteCredito:80000,  saldoActual:Math.round(48900*f),  diasVencido:22, estatus:"Al corriente"  },
      { cliente:"Servi-Car Puebla",       segmento:"B", limiteCredito:70000,  saldoActual:Math.round(38400*f),  diasVencido:68, estatus:"Vencido"       },
      { cliente:"Talleres Unión",         segmento:"B", limiteCredito:60000,  saldoActual:Math.round(31200*f),  diasVencido:15, estatus:"Al corriente"  },
      { cliente:"Auto Centro Sur",        segmento:"B", limiteCredito:55000,  saldoActual:Math.round(24100*f),  diasVencido:12, estatus:"Al corriente"  },
      { cliente:"Taller Mecánico Reyes",  segmento:"C", limiteCredito:30000,  saldoActual:Math.round(10938*f),  diasVencido:5,  estatus:"Al corriente"  }
    ],
    interacciones: [
      { cliente:"Auto Express del Norte", segmento:"A", tipo:"Visita",     fecha:d(28), responsable:"Gerardo Santana",    estatus:"Cerrado"  },
      { cliente:"Distribuidora Montes",   segmento:"A", tipo:"Llamada",    fecha:d(27), responsable:"Casildo Lopez",       estatus:"Cerrado"  },
      { cliente:"Refacciones El Águila",  segmento:"A", tipo:"Cotización", fecha:d(26), responsable:"José L. Badillo",     estatus:"Pendiente"},
      { cliente:"Taller Los Pinos",       segmento:"B", tipo:"WhatsApp",   fecha:d(27), responsable:"Miguel Medina",       estatus:"Cerrado"  },
      { cliente:"Servi-Car Puebla",       segmento:"B", tipo:"Cobranza",   fecha:d(25), responsable:"Jorge Ramirez",       estatus:"Pendiente"},
      { cliente:"Talleres Unión",         segmento:"B", tipo:"Visita",     fecha:d(24), responsable:"Olimpo Ortiz",        estatus:"Cerrado"  },
      { cliente:"Auto Centro Sur",        segmento:"B", tipo:"Llamada",    fecha:d(26), responsable:"César Martínez",      estatus:"Pendiente"},
      { cliente:"Taller Mecánico Reyes",  segmento:"C", tipo:"WhatsApp",   fecha:d(23), responsable:"Humberto Santana",    estatus:"Cerrado"  },
      { cliente:"Refacciones Morelos",    segmento:"B", tipo:"Cotización", fecha:d(28), responsable:"Samuel Ortiz",        estatus:"Pendiente"},
      { cliente:"Grupo Automotriz Benito",segmento:"A", tipo:"Visita",     fecha:d(27), responsable:"Casildo Lopez",       estatus:"Cerrado"  }
    ],
    antigüedadSaldos: {
      "0-30d": Math.round(280000*f), "31-60d": Math.round(62000*f),
      "61-90d": Math.round(24000*f), "+90d": Math.round(13338*f)
    },
    corteDiario: {
      ventasHoy: Math.round(842600*f), efectivo: Math.round(218000*f),
      transferencia: Math.round(495000*f), tarjeta: Math.round(129600*f), transacciones: Math.round(52*f),
      ultimos7dias: [
        { fecha:`${String(m-7<1?1:m-7).padStart(2,'0')}/${mesStr}`, ventas:Math.round(714200*f), efectivo:Math.round(182000*f), transferencia:Math.round(412000*f), tarjeta:Math.round(120200*f), tx:Math.round(44*f) },
        { fecha:`${String(m-6<1?2:m-6).padStart(2,'0')}/${mesStr}`, ventas:Math.round(891400*f), efectivo:Math.round(245000*f), transferencia:Math.round(521000*f), tarjeta:Math.round(125400*f), tx:Math.round(58*f) },
        { fecha:`${String(m-5<1?3:m-5).padStart(2,'0')}/${mesStr}`, ventas:Math.round(763800*f), efectivo:Math.round(198000*f), transferencia:Math.round(441800*f), tarjeta:Math.round(124000*f), tx:Math.round(49*f) },
        { fecha:`${String(m-4<1?4:m-4).padStart(2,'0')}/${mesStr}`, ventas:Math.round(932100*f), efectivo:Math.round(261000*f), transferencia:Math.round(548000*f), tarjeta:Math.round(123100*f), tx:Math.round(61*f) },
        { fecha:`${String(m-3<1?5:m-3).padStart(2,'0')}/${mesStr}`, ventas:Math.round(678400*f), efectivo:Math.round(172000*f), transferencia:Math.round(388400*f), tarjeta:Math.round(118000*f), tx:Math.round(42*f) },
        { fecha:`${String(m-2<1?6:m-2).padStart(2,'0')}/${mesStr}`, ventas:Math.round(541200*f), efectivo:Math.round(141000*f), transferencia:Math.round(310200*f), tarjeta:Math.round(90000*f),  tx:Math.round(35*f) },
        { fecha:`${String(m-1<1?7:m-1).padStart(2,'0')}/${mesStr}`, ventas:Math.round(842600*f), efectivo:Math.round(218000*f), transferencia:Math.round(495000*f), tarjeta:Math.round(129600*f), tx:Math.round(52*f) }
      ]
    },
    segmentacion: [
      { escala:"$3M a $4M",        clientes:1,    contribVentas:2.91,  contribAcum:2.91,  segmento:"Selecto A",    nivel:"A" },
      { escala:"$2M a $3M",        clientes:4,    contribVentas:7.66,  contribAcum:10.57, segmento:"Selecto B",    nivel:"A" },
      { escala:"$1.4M a $2M",      clientes:3,    contribVentas:4.38,  contribAcum:14.95, segmento:"Selecto C",    nivel:"A" },
      { escala:"$900K a $1.4M",    clientes:13,   contribVentas:12.45, contribAcum:27.4,  segmento:"Selecto D",    nivel:"A" },
      { escala:"$660K a $900K",    clientes:8,    contribVentas:5.50,  contribAcum:32.9,  segmento:"Destacado A",  nivel:"A" },
      { escala:"$480K a $660K",    clientes:12,   contribVentas:6.07,  contribAcum:38.97, segmento:"Destacado B",  nivel:"A" },
      { escala:"$360K a $480K",    clientes:10,   contribVentas:3.53,  contribAcum:42.5,  segmento:"Destacado C",  nivel:"A" },
      { escala:"$240K a $360K",    clientes:22,   contribVentas:5.63,  contribAcum:48.13, segmento:"Comprometido", nivel:"A" },
      { escala:"$120K a $240K",    clientes:76,   contribVentas:10.95, contribAcum:59.29, segmento:"Entusiasta",   nivel:"B" },
      { escala:"$60K a $120K",     clientes:140,  contribVentas:10.24, contribAcum:69.53, segmento:"Estratégico",  nivel:"B" },
      { escala:"$25K a $60K",      clientes:329,  contribVentas:10.77, contribAcum:80.30, segmento:"Potencial",    nivel:"B" },
      { escala:"$16.55K a $25K",   clientes:270,  contribVentas:4.69,  contribAcum:85.0,  segmento:"Mini",         nivel:"B" },
      { escala:"$9.68K a $16.55K", clientes:457,  contribVentas:5.00,  contribAcum:90.0,  segmento:"Micro",        nivel:"C" },
      { escala:"Hasta $9.68K",     clientes:4064, contribVentas:10.0,  contribAcum:100,   segmento:"PG Ampliado",  nivel:"C" }
    ]
  };
}

// ── Endpoints de datos ────────────────────────────────────────────
app.get("/api/estado-resultados", async (req, res) => {
  try {
    res.json(await fetchEstadoResultados());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/balance", async (req, res) => {
  try {
    res.json(await fetchBalance());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/resumen", async (req, res) => {
  try {
    res.json(await fetchResumen());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/ratios", async (req, res) => {
  try {
    res.json(await fetchRatios());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Meta: timestamps del cache ────────────────────────────────────
app.get("/api/meta", (req, res) => {
  const meta = {};
  Object.keys(_cache).forEach(k => {
    meta[k] = { cachedAt: new Date(_cache[k].ts).toISOString() };
  });
  res.json(meta);
});

// ── Forzar refresco del cache ─────────────────────────────────────
app.post("/api/refresh", (req, res) => {
  clearCache();
  res.json({ ok: true, message: "Cache borrado", ts: new Date().toISOString() });
});

// ── APIs mock: Operaciones, Ventas, Compras, CRM ─────────────
app.get("/api/operaciones", (req, res) => {
  res.json(getOperacionesData(req.query.mes));
});

app.get("/api/ventas", (req, res) => {
  res.json(getVentasData(req.query.mes));
});

app.get("/api/compras", (req, res) => {
  res.json(getComprasData(req.query.mes));
});

app.get("/api/crm", (req, res) => {
  res.json(getCrmData(req.query.mes));
});

// ── Resend Email via HTTP nativo ──────────────────────────────────
function sendResendEmail(to, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: 'Refacciones Franco <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: html
    });
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (process.env.RESEND_API_KEY || 're_RVjUHeUc_2osxujQwcgqWVALdnz5D6iLu'),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.message || 'Resend error ' + res.statusCode));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

app.post("/api/send-email", async (req, res) => {
  try {
    const { tabId, mesNombre, tabNombre, datos } = req.body;
    const adminEmail = process.env.ADMIN_EMAIL || 'daftpunkmanolo@gmail.com';
    const fecha = new Date().toLocaleDateString("es-MX", { year:'numeric', month:'long', day:'numeric' });

    const subject = `Dashboard RF — ${tabNombre}${mesNombre ? ' · ' + mesNombre : ''} · ${fecha}`;

    const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:#2563eb;padding:24px 28px;">
      <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Refacciones Franco</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:3px;">${tabNombre}${mesNombre ? ' · ' + mesNombre : ''}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.65);margin-top:5px;">${fecha}</div>
    </div>
    <div style="padding:24px 28px;">
      ${datos}
    </div>
    <div style="padding:16px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB;font-size:11px;color:#9CA3AF;">
      Dashboard Ejecutivo · Refacciones Franco · Generado el ${fecha}
    </div>
  </div>
</body>
</html>`;

    await sendResendEmail(adminEmail, subject, html);
    res.json({ ok: true, to: adminEmail });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chat con Claude — Asesor del Dashboard ───────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function fmt(n) { return n != null ? "$" + Number(n).toLocaleString("es-MX", {maximumFractionDigits:0}) : "n/d"; }
function fmtP(n) { return n != null ? n.toFixed(1) + "%" : "n/d"; }
function fmtX(n) { return n != null ? n.toFixed(2) + "x" : "n/d"; }

async function buildDashboardContext() {
  const fecha = new Date().toLocaleDateString("es-MX", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

  // Leer todas las fuentes en paralelo — si Sheets falla, igual devolvemos los datos mock
  const [erRes, balRes, resRes, ratRes] = await Promise.allSettled([
    fetchEstadoResultados(),
    fetchBalance(),
    fetchResumen(),
    fetchRatios()
  ]);

  const er  = erRes.status  === "fulfilled" ? erRes.value  : null;
  const bal = balRes.status === "fulfilled" ? balRes.value : null;
  const res = resRes.status === "fulfilled" ? resRes.value : null;
  const rat = ratRes.status === "fulfilled" ? ratRes.value : null;

  // Datos mock (siempre disponibles)
  const op  = getOperacionesData();
  const vc  = getVentasData();
  const cp  = getComprasData();
  const crm = getCrmData();

  const er0  = er?.[0]  || {};
  const bal0 = bal?.[0] || {};
  const res0 = res?.[0] || {};
  const rat0 = rat?.[0] || {};

  const inv = op.inventario;
  const prov = op.proveedores;
  const cd = crm.corteDiario;
  const cxc = crm.cxc;
  const kcrm = crm.kpisCrm;
  const vendedores = cp.comisionesVendedor;

  return `EMPRESA: Auto Refacciones Franco — Dashboard en vivo
FECHA: ${fecha}

═══ ESTADO DE RESULTADOS (Google Sheets — año más reciente: ${er0.ano || "no disponible"}) ═══
• Ventas Netas:          ${fmt(er0.ventasNetas)}
• Costo de Ventas:       ${fmt(er0.costoVentas)}
• Utilidad Bruta:        ${fmt(er0.utilidadBruta)}
• Gastos de Venta:       ${fmt(er0.gastosVenta)}
• Utilidad Operativa:    ${fmt(er0.utilidadOperativa)}
• Utilidad Neta:         ${fmt(er0.utilidadNeta)}
${er ? "" : "⚠ Sheets no disponible — datos financieros no cargados"}

═══ BALANCE GENERAL (${bal0.ano || "n/d"}) ═══
• Caja y Bancos:         ${fmt(bal0.cajaBancos)}
• Cuentas por Cobrar:    ${fmt(bal0.cuentasCobrar)}
• Existencias:           ${fmt(bal0.existencias)}
• Total Activo:          ${fmt(bal0.totalActivo)}
• Proveedores (pasivo):  ${fmt(bal0.proveedores)}
• Total Pasivo CP:       ${fmt(bal0.totalPasivoCP)}

═══ INDICADORES CLAVE (${res0.ano || "n/d"}) ═══
• ROE (DuPont):          ${fmtP(res0.roe)}
• Margen Neto:           ${fmtP(res0.margenNeto)}
• Margen Operativo:      ${fmtP(res0.margenOperativo)}
• EBITDA %:              ${fmtP(res0.ebitda)}
• Crec. Ventas Nominal:  ${fmtP(res0.crecNominal)}
• Crec. Ventas Real:     ${fmtP(res0.crecReal)}

═══ RATIOS FINANCIEROS (${rat0.ano || "n/d"}) ═══
• Liquidez:              ${fmtX(rat0.liquidez)}
• Endeudamiento:         ${fmtX(rat0.endeudamiento)}
• Solvencia:             ${fmtX(rat0.solvencia)}
• Rotación de Activos:   ${fmtX(rat0.rotacionActivo)}
• Z-Score Altman:        ${rat0.zScore != null ? rat0.zScore.toFixed(2) : "n/d"}

═══ OPERACIONES / INVENTARIO ═══
• Valor inventario:      ${fmt(inv.valor)}
• Rotación:              ${inv.rotacion}x | DIO: ${inv.dio} días
• SKUs en quiebre:       ${inv.skuQuiebre} de ${inv.totalSkus}
• Por categoría:         Motor ${inv.porCategoria.Motor}%, Frenos ${inv.porCategoria.Frenos}%, Suspensión ${inv.porCategoria.Suspension}%, Eléctrico ${inv.porCategoria.Electrico}%
• Nivel servicio prov.:  ${prov.nivelServicio}% (${prov.entregadasTiempo}/${prov.ordenesEmitidas} órdenes a tiempo)
• Proveedores activos:   ${prov.proveedoresActivos} | Exposición USD: ${fmt(prov.exposicionUSD)}

═══ VENTAS OPERATIVAS ═══
• Venta hoy:             ${fmt(cd.ventasHoy)} | ${cd.transacciones} transacciones
• Mix pago hoy:          Transferencia ${fmt(cd.transferencia)}, Efectivo ${fmt(cd.efectivo)}, Tarjeta ${fmt(cd.tarjeta)}
• Pedidos mes:           ${vc.kpis.pedidosMes} | Ticket promedio: ${fmt(vc.kpis.ticketPromedio)} | Fill Rate: ${vc.kpis.fillRate}%
• Clientes activos:      ${vc.kpis.clientesActivos}

═══ COMISIONES DE VENDEDORES (1% sobre venta neta) ═══
${vendedores.map(v => `• ${v.vendedor.padEnd(30)} bruto ${fmt(v.ventasBrutas)} | neto ${fmt(v.totalNeto)} | comisión ${fmt(v.comision)}`).join("\n")}
• TOTAL: 11,522 ventas | $19,137,854 bruto | $18,158,512 neto | $181,585 comisiones
• Sin movimientos: AYALA AVILES, HERNANDEZ SOLIS, LOPEZ YAÑEZ, NAVARRETE RAMIREZ x2, MARTINEZ VAZQUEZ, PAREDES LANDA, CASTILLO GALICIA, AVILA BARRIOS, MALDONADO GALICIA, GORDILLO BAUTISTA, ARIAS LOPEZ, MALDONADO VAZQUEZ, PEREZ CAMPOS, ORTIZ CASTAÑEDA, GALICIA VICTORIA, HERNANDEZ GONZALEZ, FLORES SEGURA, ANTUNEZ AMBROS, HERNANDEZ MENDOZA, MACEDA BENAVIDES

═══ COMPRAS ═══
• Órdenes con retraso:   ${cp.kpis.ordenesConRetraso} | Valor total abiertas: ${fmt(cp.kpis.valorOrdenesAbiertas)}
• Nacional ${cp.kpis.pctNacional}% / Importación ${cp.kpis.pctImportacion}%
• Compras urgentes: ${cp.sugerenciasCompra.slice(0,3).map(s => `${s.descripcion} (stock ${s.stockActual}, mínimo ${s.stockMinimo})`).join(" | ")}
• Márgenes: Motor 35.0%, Suspensión 32.6%, Eléctrico 31.0%, Frenos 30.5%

═══ CRM & CARTERA ═══
• Contactos: ${kcrm.totalContactos} | Interacciones mes: ${kcrm.interaccionesMes} | Cotizaciones abiertas: ${kcrm.cotizacionesAbiertas}
• Sin actividad 30d: ${kcrm.sinActividad30d} clientes
• CXC total: ${fmt(cxc.saldoTotal)} | DSO: ${cxc.dso} días | Cartera vencida: ${cxc.carteraVencidaPct}%
• Clientes en riesgo: ${crm.clientesPendientes.filter(c => c.diasVencido > 30).map(c => `${c.cliente} (${c.diasVencido}d, ${fmt(c.saldoActual)})`).join(", ")}
• Antigüedad cartera: 0-30d ${fmt(crm.antigüedadSaldos["0-30d"])} | 31-60d ${fmt(crm.antigüedadSaldos["31-60d"])} | 61-90d ${fmt(crm.antigüedadSaldos["61-90d"])} | +90d ${fmt(crm.antigüedadSaldos["+90d"])}`;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Se requiere el campo messages[]" });
    }

    const context = await buildDashboardContext();

    const systemPrompt = `Eres el asesor de inteligencia de negocios de Auto Refacciones Franco, una refaccionaria con 60+ años en CDMX.

Tu trabajo es ayudar al dueño a interpretar los datos del dashboard, detectar oportunidades y problemas, y recomendar acciones concretas. Hablas como un consultor de negocios experimentado pero accesible — directo, sin rodeos, en español.

${context}

INSTRUCCIONES:
• Usa los datos del dashboard para respaldar tus respuestas con números reales
• Cuando detectes un problema (quiebre, cartera vencida, retrasos en compras, etc.) menciona el impacto y sugiere una acción concreta
• Si te preguntan algo que no está en los datos, sé honesto: "Eso no está en el dashboard actual"
• Respuestas concisas y con estructura clara. Usa listas cuando ayuden
• Si los datos de Sheets muestran "n/d", menciona que esa sección no se pudo cargar desde Google Sheets
• Si el dueño pide una opinión, dala con criterio, no con vaguedades`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    });

    const text = response.content.find(b => b.type === "text")?.text || "";
    res.json({ reply: text });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get(["/", "/dashboard"], function(req, res) {
  res.sendFile(path.join(__dirname, "dashboard_refacciones_v2.html"));
});

if (require.main === module) {
  app.listen(PORT, function() {
    console.log("Dashboard -> http://localhost:" + PORT);
  });
}

module.exports = app;
