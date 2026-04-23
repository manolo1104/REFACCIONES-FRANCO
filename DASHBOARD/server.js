"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const express = require("express");
const path = require("path");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.DASHBOARD_PORT || 4000;
app.use(express.static(__dirname));

const YEARS = ["2024","2023","2022","2021","2020"];

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

app.get("/api/estado-resultados", async (req, res) => {
  try {
    const rows = await getRange("ESTADO_DE_RESULTADOS", "A1:F25");
    const data = YEARS.map(function(ano, i) {
      return {
        ano: ano,
        ventasNetas:         parseMXN(findRow(rows,"Ventas Netas") && findRow(rows,"Ventas Netas")[i+1]),
        costoVentas:         parseMXN(findRow(rows,"Costo de Ventas") && findRow(rows,"Costo de Ventas")[i+1]),
        utilidadBruta:       parseMXN(findRow(rows,"Utilidad Bruta") && findRow(rows,"Utilidad Bruta")[i+1]),
        gastosVenta:         parseMXN(findRow(rows,"Gasto de ventas") && findRow(rows,"Gasto de ventas")[i+1]),
        utilidadOperativa:   parseMXN(findRow(rows,"Utilidad operativa") && findRow(rows,"Utilidad operativa")[i+1]),
        otrosIngresos:       parseMXN(findRow(rows,"Otros Ingresos") && findRow(rows,"Otros Ingresos")[i+1]),
        gastosFinancieros:   parseMXN(findRow(rows,"Gastos financieros") && findRow(rows,"Gastos financieros")[i+1]),
        utilidadAntesImptos: parseMXN(findRow(rows,"Utilidad Antes") && findRow(rows,"Utilidad Antes")[i+1]),
        impuestos:           parseMXN(findRow(rows,"Impuestos") && findRow(rows,"Impuestos")[i+1]),
        utilidadNeta:        parseMXN(findRow(rows,"Utilidad Neta") && findRow(rows,"Utilidad Neta")[i+1]),
      };
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/balance", async (req, res) => {
  try {
    const rows = await getRange("BALANCE_GENERAL", "A1:I45");
    const data = YEARS.map(function(ano, i) {
      const col = i + 4;
      return {
        ano: ano,
        cajaBancos:      parseMXN(findRow(rows,"Caja") && findRow(rows,"Caja")[col]),
        inversionesFin:  parseMXN(findRow(rows,"Inversiones") && findRow(rows,"Inversiones")[col]),
        cuentasCobrar:   parseMXN(findRow(rows,"Clientes") && findRow(rows,"Clientes")[col]),
        otrasCuentas:    parseMXN(findRow(rows,"Otras Cuentas") && findRow(rows,"Otras Cuentas")[col]),
        existencias:     parseMXN(findRow(rows,"Existencias") && findRow(rows,"Existencias")[col]),
        gastosPagados:   parseMXN(findRow(rows,"Gastos Pagados") && findRow(rows,"Gastos Pagados")[col]),
        totalCirculante: parseMXN(findRow(rows,"TOTAL ACTIVO CIRCULANTE") && findRow(rows,"TOTAL ACTIVO CIRCULANTE")[col]),
        mobiliario:      parseMXN(findRow(rows,"Mobiliario") && findRow(rows,"Mobiliario")[col]),
        totalFijo:       parseMXN(findRow(rows,"TOTAL ACTIVO FIJO") && findRow(rows,"TOTAL ACTIVO FIJO")[col]),
        totalActivo:     parseMXN(findRow(rows,"TOTAL ACTIVO") && findRow(rows,"TOTAL ACTIVO")[col]),
        proveedores:     parseMXN(findRow(rows,"Proveedores") && findRow(rows,"Proveedores")[col]),
        impuestosPagar:  parseMXN(findRow(rows,"Impuestos por Pagar") && findRow(rows,"Impuestos por Pagar")[col]),
        totalPasivoCP:   parseMXN(findRow(rows,"TOTAL PASIVO CORTO PLAZO") && findRow(rows,"TOTAL PASIVO CORTO PLAZO")[col]),
      };
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/resumen", async (req, res) => {
  try {
    const rows = await getRange("RESUMEN", "A1:G50");
    const data = YEARS.map(function(ano, i) {
      return {
        ano: ano,
        roe:             parsePct(findRow(rows,"DUPONT") && findRow(rows,"DUPONT")[i+2]),
        margenNeto:      parsePct(findRow(rows,"MRGEN NETO") && findRow(rows,"MRGEN NETO")[i+2]),
        rotacionActivos: parseX(findRow(rows,"ROTACION ACTIVOS") && findRow(rows,"ROTACION ACTIVOS")[i+2]),
        multiplicador:   parseX(findRow(rows,"MULTIPLICADOR") && findRow(rows,"MULTIPLICADOR")[i+2]),
        crecNominal:     parsePct(findRow(rows,"CRECIMIENTO VENTAS NOMINAL") && findRow(rows,"CRECIMIENTO VENTAS NOMINAL")[i+2]),
        crecReal:        parsePct(findRow(rows,"CRECIMIENTO VENTAS REAL") && findRow(rows,"CRECIMIENTO VENTAS REAL")[i+2]),
        margenOperativo: parsePct(findRow(rows,"MARGEN OPERATIVO") && findRow(rows,"MARGEN OPERATIVO")[i+2]),
        pctGastos:       parsePct(findRow(rows,"% GTOS") && findRow(rows,"% GTOS")[i+2]),
        tasaImpuestos:   parsePct(findRow(rows,"TASA EFECTIVA") && findRow(rows,"TASA EFECTIVA")[i+2]),
        ebitda:          parsePct(findRow(rows,"% EBITDA") && findRow(rows,"% EBITDA")[i+2]),
      };
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/ratios", async (req, res) => {
  try {
    const rows = await getRange("RATIOS", "A1:F30");
    const data = YEARS.map(function(ano, i) {
      const col = i + 1;
      return {
        ano: ano,
        rentabilidadFin:  parsePct(findRowWithValue(rows,"Rentabilidad Financiera", col) && findRowWithValue(rows,"Rentabilidad Financiera", col)[col]),
        rentabilidadEcon: parsePct(findRowWithValue(rows,"Rentabilidad Econ", col) && findRowWithValue(rows,"Rentabilidad Econ", col)[col]),
        margenUtilidad:   parsePct(findRowWithValue(rows,"Margen Utilidad", col) && findRowWithValue(rows,"Margen Utilidad", col)[col]),
        capitalTrabajo:   parseMXN(findRowWithValue(rows,"Capital de Trabajo", col) && findRowWithValue(rows,"Capital de Trabajo", col)[col]),
        ratioFondo:       parsePct(findRowWithValue(rows,"Ratio Fondo", col) && findRowWithValue(rows,"Ratio Fondo", col)[col]),
        liquidez:         parseX(findRowWithValue(rows,"Liquidez", col) && findRowWithValue(rows,"Liquidez", col)[col]),
        endeudamiento:    parseX(findRowWithValue(rows,"Endeudamiento", col) && findRowWithValue(rows,"Endeudamiento", col)[col]),
        autonomia:        parseX(findRowWithValue(rows,"Autonom", col) && findRowWithValue(rows,"Autonom", col)[col]),
        solvencia:        parseX(findRowWithValue(rows,"Solvencia", col) && findRowWithValue(rows,"Solvencia", col)[col]),
        rotacionActivo:   parseX(findRowWithValue(rows,"Rotación activo", col) && findRowWithValue(rows,"Rotación activo", col)[col]),
        zScore:           parseMXN(findRowWithValue(rows,"Z SCORE", col) && findRowWithValue(rows,"Z SCORE", col)[col]),
      };
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", function(req, res) {
  res.sendFile(path.join(__dirname, "dashboard_refacciones_v2.html"));
});

if (require.main === module) {
  app.listen(PORT, function() {
    console.log("Dashboard -> http://localhost:" + PORT);
  });
}

module.exports = app;
