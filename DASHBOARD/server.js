"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const express = require("express");
const path = require("path");
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

function getOperacionesData() {
  return {
    inventario: {
      valor: 64200000, rotacion: 6.8, dio: 53.7, skuQuiebre: 142, totalSkus: 4820,
      dioPorMes: [62, 59, 56, 54],
      meses: ["Enero","Febrero","Marzo","Abril"],
      porCategoria: { Motor:34, Frenos:22, Suspension:18, Electrico:15, Otros:11 }
    },
    proveedores: {
      nivelServicio: 91.4, ordenesEmitidas: 347, entregadasTiempo: 318,
      proveedoresActivos: 62, exposicionUSD: 1240000, ahorroNegociacion: 2800000,
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

function getVentasData() {
  return {
    kpis: { pedidosMes:2841, ticketPromedio:16180, clientesActivos:1247, fillRate:94.8,
            pedidosDelta:7.2, ticketDelta:3.4, clientesDelta:82, fillRateMeta:95.7 },
    ventasMensuales: {
      meses: ["Enero","Febrero","Marzo","Abril"],
      "2025": [44.2,46.8,45.1,46.3],
      "2024": [39.8,41.2,40.3,41.5]
    },
    ventasPorCanal: { labels:["Mayoristas","Talleres directos","E-commerce","Otros"], data:[48,31,13,8] }
  };
}

function getComprasData() {
  return {
    kpis: { ordenesAbiertas:47, valorOrdenesAbiertas:3200000, pctNacional:68,
            pctImportacion:32, ordenesConRetraso:8 },
    ordenesRecientes: [
      { id:"OC-2025-1847", proveedor:"ACDelco / GM",    tipo:"Nacional",    fechaEmision:"18/04/2026", fechaEntrega:"30/04/2026", monto:284500,  estatus:"En Tránsito" },
      { id:"OC-2025-1848", proveedor:"Denso Intl.",     tipo:"Importación", fechaEmision:"15/04/2026", fechaEntrega:"13/05/2026", monto:612000,  estatus:"Pendiente"   },
      { id:"OC-2025-1849", proveedor:"Bosch México",    tipo:"Nacional",    fechaEmision:"20/04/2026", fechaEntrega:"25/04/2026", monto:198000,  estatus:"Con Retraso" },
      { id:"OC-2025-1850", proveedor:"SKF México",      tipo:"Nacional",    fechaEmision:"21/04/2026", fechaEntrega:"25/04/2026", monto:143200,  estatus:"Recibida"    },
      { id:"OC-2025-1851", proveedor:"Gates Industrial",tipo:"Importación", fechaEmision:"10/04/2026", fechaEntrega:"28/04/2026", monto:537800,  estatus:"Con Retraso" },
      { id:"OC-2025-1852", proveedor:"Hyundai Mobis",   tipo:"Importación", fechaEmision:"08/04/2026", fechaEntrega:"13/05/2026", monto:892000,  estatus:"En Tránsito" },
      { id:"OC-2025-1853", proveedor:"ACDelco / GM",    tipo:"Nacional",    fechaEmision:"22/04/2026", fechaEntrega:"04/05/2026", monto:321500,  estatus:"Pendiente"   },
      { id:"OC-2025-1854", proveedor:"Bosch México",    tipo:"Nacional",    fechaEmision:"23/04/2026", fechaEntrega:"29/04/2026", monto:211000,  estatus:"Pendiente"   }
    ],
    comprasMensuales: {
      meses: ["Enero","Febrero","Marzo","Abril"],
      nacional:    [6.2, 6.8, 6.1, 7.1],
      importacion: [2.9, 3.2, 3.0, 3.4]
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

function getCrmData() {
  return {
    kpisCrm: { totalContactos:5413, interaccionesMes:847, cotizacionesAbiertas:163, sinActividad30d:412 },
    cxc: { saldoTotal:379338, carteraVencidaPct:4.1, clientesCredito:127, dso:18 },
    clientesPendientes: [
      { cliente:"Auto Express del Norte", segmento:"A", limiteCredito:150000, saldoActual:89200,  diasVencido:0,  estatus:"Al corriente"  },
      { cliente:"Distribuidora Montes",   segmento:"A", limiteCredito:130000, saldoActual:74500,  diasVencido:8,  estatus:"Al corriente"  },
      { cliente:"Refacciones El Águila",  segmento:"A", limiteCredito:120000, saldoActual:62100,  diasVencido:35, estatus:"En seguimiento" },
      { cliente:"Taller Los Pinos",       segmento:"B", limiteCredito:80000,  saldoActual:48900,  diasVencido:22, estatus:"Al corriente"  },
      { cliente:"Servi-Car Puebla",       segmento:"B", limiteCredito:70000,  saldoActual:38400,  diasVencido:68, estatus:"Vencido"       },
      { cliente:"Talleres Unión",         segmento:"B", limiteCredito:60000,  saldoActual:31200,  diasVencido:15, estatus:"Al corriente"  },
      { cliente:"Auto Centro Sur",        segmento:"B", limiteCredito:55000,  saldoActual:24100,  diasVencido:12, estatus:"Al corriente"  },
      { cliente:"Taller Mecánico Reyes",  segmento:"C", limiteCredito:30000,  saldoActual:10938,  diasVencido:5,  estatus:"Al corriente"  }
    ],
    antigüedadSaldos: { "0-30d":280000, "31-60d":62000, "61-90d":24000, "+90d":13338 },
    corteDiario: {
      ventasHoy:842600, efectivo:218000, transferencia:495000, tarjeta:129600, transacciones:52,
      ultimos7dias: [
        { fecha:"21/04", ventas:714200,  efectivo:182000, transferencia:412000, tarjeta:120200, tx:44 },
        { fecha:"22/04", ventas:891400,  efectivo:245000, transferencia:521000, tarjeta:125400, tx:58 },
        { fecha:"23/04", ventas:763800,  efectivo:198000, transferencia:441800, tarjeta:124000, tx:49 },
        { fecha:"24/04", ventas:932100,  efectivo:261000, transferencia:548000, tarjeta:123100, tx:61 },
        { fecha:"25/04", ventas:678400,  efectivo:172000, transferencia:388400, tarjeta:118000, tx:42 },
        { fecha:"26/04", ventas:541200,  efectivo:141000, transferencia:310200, tarjeta:90000,  tx:35 },
        { fecha:"27/04", ventas:842600,  efectivo:218000, transferencia:495000, tarjeta:129600, tx:52 }
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
  res.json(getOperacionesData());
});

app.get("/api/ventas", (req, res) => {
  res.json(getVentasData());
});

app.get("/api/compras", (req, res) => {
  res.json(getComprasData());
});

app.get("/api/crm", (req, res) => {
  res.json(getCrmData());
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
