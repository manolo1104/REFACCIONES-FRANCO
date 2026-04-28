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

// ── Endpoints de datos ────────────────────────────────────────────
app.get("/api/estado-resultados", async (req, res) => {
  const cached = getCached("estado-resultados");
  if (cached) return res.json(cached);
  try {
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
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/balance", async (req, res) => {
  const cached = getCached("balance");
  if (cached) return res.json(cached);
  try {
    const rows = await getRange("BALANCE_GENERAL", "A1:I45");
    const data = YEARS.map(function(ano, i) {
      const col = i + 4;
      return {
        ano,
        cajaBancos:      parseMXN(findRow(rows,"Caja")?.[col]),
        inversionesFin:  parseMXN(findRow(rows,"Inversiones")?.[col]),
        cuentasCobrar:   parseMXN(findRow(rows,"Clientes")?.[col]),
        otrasCuentas:    parseMXN(findRow(rows,"Otras Cuentas")?.[col]),
        existencias:     parseMXN(findRow(rows,"Existencias")?.[col]),
        gastosPagados:   parseMXN(findRow(rows,"Gastos Pagados")?.[col]),
        totalCirculante: parseMXN(findRow(rows,"TOTAL ACTIVO CIRCULANTE")?.[col]),
        mobiliario:      parseMXN(findRow(rows,"Mobiliario")?.[col]),
        totalFijo:       parseMXN(findRow(rows,"TOTAL ACTIVO FIJO")?.[col]),
        totalActivo:     parseMXN(findRow(rows,"TOTAL ACTIVO")?.[col]),
        proveedores:     parseMXN(findRow(rows,"Proveedores")?.[col]),
        impuestosPagar:  parseMXN(findRow(rows,"Impuestos por Pagar")?.[col]),
        totalPasivoCP:   parseMXN(findRow(rows,"TOTAL PASIVO CORTO PLAZO")?.[col]),
      };
    });
    setCached("balance", data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/resumen", async (req, res) => {
  const cached = getCached("resumen");
  if (cached) return res.json(cached);
  try {
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
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/ratios", async (req, res) => {
  const cached = getCached("ratios");
  if (cached) return res.json(cached);
  try {
    const rows = await getRange("RATIOS", "A1:F30");
    const data = YEARS.map(function(ano, i) {
      const col = i + 1;
      return {
        ano,
        rentabilidadFin:  parsePct(findRowWithValue(rows,"Rentabilidad Financiera", col)?.[col]),
        rentabilidadEcon: parsePct(findRowWithValue(rows,"Rentabilidad Econ", col)?.[col]),
        margenUtilidad:   parsePct(findRowWithValue(rows,"Margen Utilidad", col)?.[col]),
        capitalTrabajo:   parseMXN(findRowWithValue(rows,"Capital de Trabajo", col)?.[col]),
        ratioFondo:       parsePct(findRowWithValue(rows,"Ratio Fondo", col)?.[col]),
        liquidez:         parseX(findRowWithValue(rows,"Liquidez", col)?.[col]),
        endeudamiento:    parseX(findRowWithValue(rows,"Endeudamiento", col)?.[col]),
        autonomia:        parseX(findRowWithValue(rows,"Autonom", col)?.[col]),
        solvencia:        parseX(findRowWithValue(rows,"Solvencia", col)?.[col]),
        rotacionActivo:   parseX(findRowWithValue(rows,"Rotación activo", col)?.[col]),
        zScore:           parseMXN(findRowWithValue(rows,"Z SCORE", col)?.[col]),
      };
    });
    setCached("ratios", data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  res.json({
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
        { nombre:"ACDelco / GM",   pais:"USA", leadTime:12, varPrecio:4.2, estatus:"ok" },
        { nombre:"Bosch México",   pais:"MEX", leadTime:5,  varPrecio:6.1, estatus:"warn" },
        { nombre:"Denso Intl.",    pais:"JPN", leadTime:28, varPrecio:2.8, estatus:"ok" },
        { nombre:"Gates Industrial",pais:"USA",leadTime:18, varPrecio:9.3, estatus:"err" },
        { nombre:"SKF México",     pais:"MEX", leadTime:4,  varPrecio:3.5, estatus:"ok" },
        { nombre:"Hyundai Mobis",  pais:"KOR", leadTime:35, varPrecio:7.4, estatus:"warn" }
      ]
    }
  });
});

app.get("/api/ventas", (req, res) => {
  res.json({
    kpis: { pedidosMes:2841, ticketPromedio:16180, clientesActivos:1247, fillRate:94.8,
            pedidosDelta:7.2, ticketDelta:3.4, clientesDelta:82, fillRateMeta:95.7 },
    ventasMensuales: {
      meses: ["Enero","Febrero","Marzo","Abril"],
      "2025": [44.2,46.8,45.1,46.3],
      "2024": [39.8,41.2,40.3,41.5]
    },
    ventasPorCanal: { labels:["Mayoristas","Talleres directos","E-commerce","Otros"], data:[48,31,13,8] }
  });
});

app.get("/api/compras", (req, res) => {
  res.json({
    kpis: { ordenesAbiertas:47, valorOrdenesAbiertas:3200000, pctNacional:68,
            pctImportacion:32, ordenesConRetraso:8 },
    ordenesRecientes: [
      { id:"OC-2025-1847", proveedor:"ACDelco / GM",   tipo:"Nacional",    fechaEmision:"18/04/2026", fechaEntrega:"30/04/2026", monto:284500,  estatus:"En Tránsito" },
      { id:"OC-2025-1848", proveedor:"Denso Intl.",    tipo:"Importación", fechaEmision:"15/04/2026", fechaEntrega:"13/05/2026", monto:612000,  estatus:"Pendiente" },
      { id:"OC-2025-1849", proveedor:"Bosch México",   tipo:"Nacional",    fechaEmision:"20/04/2026", fechaEntrega:"25/04/2026", monto:198000,  estatus:"Con Retraso" },
      { id:"OC-2025-1850", proveedor:"SKF México",     tipo:"Nacional",    fechaEmision:"21/04/2026", fechaEntrega:"25/04/2026", monto:143200,  estatus:"Recibida" },
      { id:"OC-2025-1851", proveedor:"Gates Industrial",tipo:"Importación",fechaEmision:"10/04/2026", fechaEntrega:"28/04/2026", monto:537800,  estatus:"Con Retraso" },
      { id:"OC-2025-1852", proveedor:"Hyundai Mobis",  tipo:"Importación", fechaEmision:"08/04/2026", fechaEntrega:"13/05/2026", monto:892000,  estatus:"En Tránsito" },
      { id:"OC-2025-1853", proveedor:"ACDelco / GM",   tipo:"Nacional",    fechaEmision:"22/04/2026", fechaEntrega:"04/05/2026", monto:321500,  estatus:"Pendiente" },
      { id:"OC-2025-1854", proveedor:"Bosch México",   tipo:"Nacional",    fechaEmision:"23/04/2026", fechaEntrega:"29/04/2026", monto:211000,  estatus:"Pendiente" }
    ],
    comprasMensuales: {
      meses: ["Enero","Febrero","Marzo","Abril"],
      nacional:    [6.2, 6.8, 6.1, 7.1],
      importacion: [2.9, 3.2, 3.0, 3.4]
    },
    sugerenciasCompra: [
      { sku:"SKU-4821", descripcion:"Balata Delantera Bosch Cerámico",    categoria:"Frenos",     stockActual:12, stockMinimo:50,  ventasMes:78,  qtySugerida:120, proveedor:"Bosch México" },
      { sku:"SKU-2047", descripcion:"Filtro de Aceite ACDelco PF47E",     categoria:"Motor",      stockActual:8,  stockMinimo:100, ventasMes:145, qtySugerida:300, proveedor:"ACDelco / GM" },
      { sku:"SKU-3312", descripcion:"Amortiguador Delantero Gabriel G57", categoria:"Suspensión", stockActual:3,  stockMinimo:20,  ventasMes:32,  qtySugerida:60,  proveedor:"Gates Industrial" },
      { sku:"SKU-1189", descripcion:"Banda Distribución Gates T218",      categoria:"Motor",      stockActual:15, stockMinimo:40,  ventasMes:52,  qtySugerida:80,  proveedor:"Gates Industrial" },
      { sku:"SKU-5503", descripcion:"Cojinete Rueda SKF BR930748",        categoria:"Suspensión", stockActual:6,  stockMinimo:25,  ventasMes:38,  qtySugerida:70,  proveedor:"SKF México" },
      { sku:"SKU-0874", descripcion:"Alternador Denso 210-4165",          categoria:"Eléctrico",  stockActual:2,  stockMinimo:10,  ventasMes:14,  qtySugerida:24,  proveedor:"Denso Intl." }
    ],
    comisionesVendedor: [
      { vendedor:"Carlos Ramírez", ventasMes:2840000, metaMensual:2500000, pctCumplimiento:113.6, comision:142000 },
      { vendedor:"María López",    ventasMes:2210000, metaMensual:2500000, pctCumplimiento:88.4,  comision:88400  },
      { vendedor:"Javier Herrera", ventasMes:1980000, metaMensual:2000000, pctCumplimiento:99.0,  comision:79200  },
      { vendedor:"Sofía Morales",  ventasMes:2640000, metaMensual:2500000, pctCumplimiento:105.6, comision:132000 },
      { vendedor:"Diego Vargas",   ventasMes:1640000, metaMensual:2000000, pctCumplimiento:82.0,  comision:65600  },
      { vendedor:"Lucía Castro",   ventasMes:2320000, metaMensual:2200000, pctCumplimiento:105.5, comision:116000 }
    ],
    costoPorLinea: [
      { linea:"Motor",      ventas:63900000, costo:41535000, margenBruto:22365000, pctMargen:35.0 },
      { linea:"Frenos",     ventas:40800000, costo:28354800, margenBruto:12445200, pctMargen:30.5 },
      { linea:"Suspensión", ventas:32800000, costo:22100000, margenBruto:10700000, pctMargen:32.6 },
      { linea:"Eléctrico",  ventas:25500000, costo:17595000, margenBruto:7905000,  pctMargen:31.0 },
      { linea:"Otros",      ventas:18500000, costo:12838000, margenBruto:5662000,  pctMargen:30.6 }
    ]
  });
});

app.get("/api/crm", (req, res) => {
  res.json({
    segmentacion: [
      { escala:"$3M a $4M",       clientes:1,    contribVentas:2.91,  contribAcum:2.91,  segmento:"Selecto A",    nivel:"A" },
      { escala:"$2M a $3M",       clientes:4,    contribVentas:7.66,  contribAcum:10.57, segmento:"Selecto B",    nivel:"A" },
      { escala:"$1.4M a $2M",     clientes:3,    contribVentas:4.38,  contribAcum:14.95, segmento:"Selecto C",    nivel:"A" },
      { escala:"$900K a $1.4M",   clientes:13,   contribVentas:12.45, contribAcum:27.4,  segmento:"Selecto D",    nivel:"A" },
      { escala:"$660K a $900K",   clientes:8,    contribVentas:5.50,  contribAcum:32.9,  segmento:"Destacado A",  nivel:"A" },
      { escala:"$480K a $660K",   clientes:12,   contribVentas:6.07,  contribAcum:38.97, segmento:"Destacado B",  nivel:"A" },
      { escala:"$360K a $480K",   clientes:10,   contribVentas:3.53,  contribAcum:42.5,  segmento:"Destacado C",  nivel:"A" },
      { escala:"$240K a $360K",   clientes:22,   contribVentas:5.63,  contribAcum:48.13, segmento:"Comprometido", nivel:"A" },
      { escala:"$120K a $240K",   clientes:76,   contribVentas:10.95, contribAcum:59.29, segmento:"Entusiasta",   nivel:"B" },
      { escala:"$60K a $120K",    clientes:140,  contribVentas:10.24, contribAcum:69.53, segmento:"Estratégico",  nivel:"B" },
      { escala:"$25K a $60K",     clientes:329,  contribVentas:10.77, contribAcum:80.30, segmento:"Potencial",    nivel:"B" },
      { escala:"$16.55K a $25K",  clientes:270,  contribVentas:4.69,  contribAcum:85.0,  segmento:"Mini",         nivel:"B" },
      { escala:"$9.68K a $16.55K",clientes:457,  contribVentas:5.00,  contribAcum:90.0,  segmento:"Micro",        nivel:"C" },
      { escala:"Hasta $9.68K",    clientes:4064, contribVentas:10.0,  contribAcum:100,   segmento:"PG Ampliado",  nivel:"C" }
    ],
    kpisCrm: { totalContactos:5413, interaccionesMes:847, cotizacionesAbiertas:163, sinActividad30d:412 },
    interacciones: [
      { cliente:"Taller Los Pinos",       segmento:"B", tipo:"Llamada",         fecha:"25/04/2026", responsable:"Carlos Ramírez", estatus:"Seguimiento" },
      { cliente:"Auto Express del Norte", segmento:"A", tipo:"Cotización",       fecha:"24/04/2026", responsable:"María López",    estatus:"Pendiente" },
      { cliente:"Servi-Car Puebla",       segmento:"B", tipo:"Visita Sucursal",  fecha:"24/04/2026", responsable:"Luis Mendoza",   estatus:"Cerrado" },
      { cliente:"Talleres Unión",         segmento:"C", tipo:"Email",            fecha:"23/04/2026", responsable:"Ana Flores",     estatus:"Seguimiento" },
      { cliente:"Refacciones El Águila",  segmento:"A", tipo:"Cotización",       fecha:"23/04/2026", responsable:"Carlos Ramírez", estatus:"Pendiente" },
      { cliente:"Auto Centro Sur",        segmento:"B", tipo:"Llamada",          fecha:"22/04/2026", responsable:"María López",    estatus:"Cerrado" },
      { cliente:"Taller Mecánico Reyes",  segmento:"C", tipo:"Visita Sucursal",  fecha:"22/04/2026", responsable:"Luis Mendoza",   estatus:"Seguimiento" },
      { cliente:"Distribuidora Montes",   segmento:"A", tipo:"Cotización",       fecha:"21/04/2026", responsable:"Ana Flores",     estatus:"Cerrado" }
    ],
    cxc: { saldoTotal:379338, carteraVencidaPct:4.1, clientesCredito:127, dso:18 },
    clientesPendientes: [
      { cliente:"Auto Express del Norte", segmento:"A", limiteCredito:150000, saldoActual:89200, diasVencido:0,  estatus:"Al corriente" },
      { cliente:"Distribuidora Montes",   segmento:"A", limiteCredito:130000, saldoActual:74500, diasVencido:8,  estatus:"Al corriente" },
      { cliente:"Refacciones El Águila",  segmento:"A", limiteCredito:120000, saldoActual:62100, diasVencido:35, estatus:"En seguimiento" },
      { cliente:"Taller Los Pinos",       segmento:"B", limiteCredito:80000,  saldoActual:48900, diasVencido:22, estatus:"Al corriente" },
      { cliente:"Servi-Car Puebla",       segmento:"B", limiteCredito:70000,  saldoActual:38400, diasVencido:68, estatus:"Vencido" },
      { cliente:"Talleres Unión",         segmento:"B", limiteCredito:60000,  saldoActual:31200, diasVencido:15, estatus:"Al corriente" },
      { cliente:"Auto Centro Sur",        segmento:"B", limiteCredito:55000,  saldoActual:24100, diasVencido:12, estatus:"Al corriente" },
      { cliente:"Taller Mecánico Reyes",  segmento:"C", limiteCredito:30000,  saldoActual:10938, diasVencido:5,  estatus:"Al corriente" }
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
    }
  });
});

// ── Chat con Claude — Asesor del Dashboard ───────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildDashboardContext() {
  return `
EMPRESA: Auto Refacciones Franco
FECHA HOY: ${new Date().toLocaleDateString("es-MX", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}

═══ DATOS DEL DASHBOARD (snapshot actual) ═══

📊 OPERACIONES / INVENTARIO
• Valor inventario: $64,200,000 MXN
• Rotación inventario: 6.8x | DIO: 53.7 días
• SKUs en quiebre: 142 de 4,820 totales
• Distribución por categoría: Motor 34%, Frenos 22%, Suspensión 18%, Eléctrico 15%, Otros 11%

🚚 PROVEEDORES
• Nivel de servicio: 91.4% (348 de 347 órdenes a tiempo)
• Proveedores activos: 62 | Exposición USD: $1,240,000
• Ahorro por negociación: $2,800,000 MXN
• Variación de precios últimos 5 meses: 4.1%, 8.2%, 5.6%, 6.8%, 5.9%

💰 VENTAS (YTD hasta Abril 2026)
• Venta diaria hoy: $842,600 | Transacciones: 52
• Mezcla de pago hoy: Transferencia $495K, Efectivo $218K, Tarjeta $130K
• Últimos 7 días: promedio ~$766K/día
• Vendedores top: Carlos Ramírez (114% meta), Sofía Morales (106%), Javier Herrera (99%)
• Vendedores bajo meta: María López (88%), Diego Vargas (82%)

📦 COMPRAS (YTD)
• Órdenes abiertas: 3 pendientes (Bosch $211K, Denso $187K, Monroe $94K)
• Sugerencias compra urgentes: Filtro Aceite ACDelco (8 uds, mínimo 100), Balata Bosch (12 uds, mínimo 50)
• Márgenes por línea: Motor 35.0%, Suspensión 32.6%, Eléctrico 31.0%, Frenos 30.5%

👥 CRM
• Total contactos: 5,413 | Interacciones este mes: 847
• Cotizaciones abiertas: 163 | Clientes sin actividad 30 días: 412
• Cartera total CXC: $379,338 | DSO: 18 días | Cartera vencida: 4.1%
• Cliente en riesgo: Servi-Car Puebla (68 días vencido, $38,400)

📈 FINANZAS (año más reciente disponible)
• ROE, márgenes y ratios disponibles vía Google Sheets (pueden estar cargando si la sesión es nueva)

═══════════════════════════════════════════`;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Se requiere el campo messages[]" });
    }

    const systemPrompt = `Eres el asesor de inteligencia de negocios de *Auto Refacciones Franco*, una refaccionaria con 60+ años en CDMX.

Tu trabajo es ayudar al dueño a interpretar los datos del dashboard, detectar oportunidades y problemas, y recomendar acciones concretas. Hablas como un consultor de negocios experimentado pero accesible — directo, sin rodeos, en español.

${buildDashboardContext()}

INSTRUCCIONES:
• Usa los datos del dashboard para respaldar tus respuestas con números reales
• Cuando detectes un problema (quiebre, cartera vencida, vendedor bajo meta, etc.), menciona el impacto y sugiere una acción específica
• Si te preguntan algo que no está en los datos, sé honesto: "Eso no está en el dashboard actual, pero puedo ayudarte a pensarlo con la info disponible"
• Respuestas concisas y con estructura clara. Usa listas cuando ayuden a la lectura
• No uses emojis en exceso — solo donde den claridad real
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
