"use strict";

const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const twimlHelper = require("./twiml");
const sheets = require("./sheets");

const app = express();

app.use((req, res, next) => {
  if (req.path === "/local-test/intent" || req.path.startsWith("/local-test-assets")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
  }

  next();
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use("/local-test-assets", express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ASESOR_PHONE = process.env.ASESOR_PHONE;
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const conversationState = new Map();

// ─── Middleware de validación de firma Twilio ─────────────────────────────────
// En producción valida que la petición venga realmente de Twilio.
// En desarrollo (NODE_ENV=development) se omite para facilitar pruebas con ngrok.
function twilioWebhook(handler) {
  return (req, res, next) => {
    if (process.env.NODE_ENV !== "development") {
      const valid = twilio.validateExpressRequest(req, process.env.TWILIO_AUTH_TOKEN, {
        url: `${process.env.BASE_URL}${req.originalUrl}`,
      });
      if (!valid) {
        console.warn("⚠️  Firma Twilio inválida en", req.originalUrl);
        return res.status(403).send("Forbidden");
      }
    }
    handler(req, res, next);
  };
}

// ─── Helper: responder TwiML ──────────────────────────────────────────────────
function sendTwiml(res, xml) {
  res.type("text/xml").send(xml);
}

function limpiarPiezaDetectada(texto) {
  return String(texto || "")
    .replace(/^(de|del|la|las|los|el|un|una)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clasificarIntencionLocal(textoCliente) {
  const texto = String(textoCliente || "").trim().toLowerCase();

  if (!texto) {
    return { intent: "DESCONOCIDO", pieza: null, respuesta: "No entendí la solicitud." };
  }

  if (/(adios|adiós|gracias|hasta luego|ya es todo|eso es todo)/i.test(texto)) {
    return { intent: "DESPEDIDA", pieza: null, respuesta: "Entendido, terminamos la llamada." };
  }

  if (/(asesor|persona|humano|agente|representante|ejecutivo)/i.test(texto)) {
    return { intent: "HABLAR_ASESOR", pieza: null, respuesta: "Le comunico con un asesor." };
  }

  const patrones = [
    {
      intent: "CONSULTA_PRECIO",
      regex: /(?:precio|cu[aá]nto cuesta|cu[aá]nto vale|cotiza(?:r)?)(?:\s+de)?\s+(.+)/i,
    },
    {
      intent: "CONSULTA_DISPONIBILIDAD",
      regex: /(?:tienen|tienes|hay|disponibilidad|disponible|existencia|en stock)(?:\s+de)?\s+(.+)/i,
    },
    {
      intent: "PEDIDO",
      regex: /(?:quiero pedir|quiero comprar|comprar|pedido|ordenar|necesito)(?:\s+una?|\s+un)?\s+(.+)/i,
    },
  ];

  for (const patron of patrones) {
    const match = texto.match(patron.regex);
    if (match) {
      return {
        intent: patron.intent,
        pieza: limpiarPiezaDetectada(match[1]),
        respuesta: "Entendido.",
      };
    }
  }

  if (/(precio|cu[aá]nto cuesta|cu[aá]nto vale)/i.test(texto)) {
    return { intent: "CONSULTA_PRECIO", pieza: null, respuesta: "Entendido." };
  }

  if (/(disponibilidad|disponible|existencia|tienen|hay)/i.test(texto)) {
    return { intent: "CONSULTA_DISPONIBILIDAD", pieza: null, respuesta: "Entendido." };
  }

  if (/(pedir|comprar|pedido|ordenar|necesito)/i.test(texto)) {
    return { intent: "PEDIDO", pieza: null, respuesta: "Entendido." };
  }

  return { intent: "DESCONOCIDO", pieza: null, respuesta: "No entendí la solicitud." };
}

function construirSpeechDesdeIntent(intent, speech) {
  const prefijo = intent === "CONSULTA_PRECIO"
    ? "precio de"
    : intent === "CONSULTA_DISPONIBILIDAD"
      ? "disponibilidad de"
      : "pedir";

  return `${prefijo} ${speech}`.trim();
}

function crearPreguntaPorIntent(intent) {
  if (intent === "CONSULTA_PRECIO") {
    return "¿De qué pieza desea conocer el precio? Diga el nombre o código.";
  }

  if (intent === "CONSULTA_DISPONIBILIDAD") {
    return "¿De qué pieza desea verificar la disponibilidad? Diga el nombre o código.";
  }

  if (intent === "PEDIDO") {
    return "¿Qué pieza desea pedir? Diga el nombre o código.";
  }

  return "¿Podría decirme el nombre o código de la pieza?";
}

function obtenerSessionKey({ canal, caller, sessionId }) {
  if (sessionId) return `local:${sessionId}`;
  if (caller) return `${canal}:${caller}`;
  return `${canal}:anon`;
}

function getSessionState(sessionKey) {
  if (!conversationState.has(sessionKey)) {
    conversationState.set(sessionKey, {
      lastPiece: null,
      lastIntent: null,
      lastVehicle: null,
      waitingVehicle: false,
      waitingIntent: null,
      updatedAt: Date.now(),
    });
  }

  const state = conversationState.get(sessionKey);
  state.updatedAt = Date.now();
  return state;
}

function extraerVehiculo(texto) {
  const raw = String(texto || "").trim().toLowerCase();
  if (!raw) return null;

  const regex = /(para\s+(?:un|una)?\s*([a-z0-9\s\-]{3,}))|((?:honda|toyota|mazda|kia|audi|mercedes|nissan|chevrolet|ford|vw|volkswagen)\s*[a-z0-9\-\s]*)/i;
  const match = raw.match(regex);
  if (!match) return null;

  const v = (match[2] || match[3] || "").replace(/\s+/g, " ").trim();
  return v || null;
}

function separarPiezaYVehiculo(pieza, speech) {
  const piezaRaw = String(pieza || "").trim();
  const speechRaw = String(speech || "").trim();

  const vehiculo = extraerVehiculo(piezaRaw) || extraerVehiculo(speechRaw);

  let piezaLimpia = piezaRaw;
  piezaLimpia = piezaLimpia.replace(/\s+para\s+(un|una)?\s*[a-z0-9\s\-]+$/i, "").trim();

  return { pieza: piezaLimpia || piezaRaw, vehiculo };
}

function esCompatibleVehiculo(piezaData, vehiculo) {
  const v = String(vehiculo || "").toLowerCase();
  if (!v) return true;

  const marcaVeh = `${piezaData.marca || ""} ${piezaData.vehiculo || ""}`.toLowerCase();
  if (!marcaVeh.trim()) return true;

  const tokens = v.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return marcaVeh.includes(v.trim());

  return tokens.every((t) => marcaVeh.includes(t));
}

function parsearJsonClaude(textoRaw) {
  const raw = String(textoRaw || "").trim();
  let candidato = raw;

  const matchFence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (matchFence && matchFence[1]) {
    candidato = matchFence[1].trim();
  }

  if (!candidato.startsWith("{")) {
    const inicio = candidato.indexOf("{");
    const fin = candidato.lastIndexOf("}");
    if (inicio !== -1 && fin !== -1 && fin > inicio) {
      candidato = candidato.slice(inicio, fin + 1);
    }
  }

  return JSON.parse(candidato);
}

// ─── Clasificar intención del cliente con Claude ──────────────────────────────
async function clasificarIntencion(textoCliente) {
  const prompt = `Eres el asistente de voz de Refacciones Automotrices Franco, una tienda de refacciones para vehículos en México.

El cliente ha dicho: "${textoCliente}"

Clasifica la intención y extrae la información relevante. Responde ÚNICAMENTE con JSON válido, sin texto adicional:

{
  "intent": "CONSULTA_PRECIO" | "CONSULTA_DISPONIBILIDAD" | "PEDIDO" | "HABLAR_ASESOR" | "DESPEDIDA" | "DESCONOCIDO",
  "pieza": "nombre o SKU exacto de la pieza mencionada, o null si no se menciona ninguna",
  "respuesta": "respuesta breve y natural en español mexicano confirmando lo que entendiste (máximo 2 oraciones)"
}

Reglas:
- CONSULTA_PRECIO: el cliente quiere saber cuánto cuesta una pieza
- CONSULTA_DISPONIBILIDAD: el cliente quiere saber si hay existencia de una pieza
- PEDIDO: el cliente quiere comprar o pedir una pieza
- HABLAR_ASESOR: el cliente quiere hablar con una persona real
- DESPEDIDA: el cliente dice adiós, gracias o indica que ya no necesita ayuda
- DESCONOCIDO: no se entiende la solicitud`;

  const message = await claude.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const texto = message.content[0].text.trim();
  return parsearJsonClaude(texto);
}

async function obtenerClasificacion(textoCliente) {
  try {
    const clasificacion = await clasificarIntencion(textoCliente);
    console.log(`🤖 Claude clasificó:`, clasificacion);
    return clasificacion;
  } catch (err) {
    console.error("Error al consultar Claude:", err.message);
    const clasificacion = clasificarIntencionLocal(textoCliente);
    console.log("🧠 Usando fallback local de intención:", clasificacion);
    return clasificacion;
  }
}

async function resolverSolicitudCliente({ speech, caller = "", canal = "telefono", intentHint = null, sessionId = null }) {
  const speechLimpio = String(speech || "").trim();
  const sessionKey = obtenerSessionKey({ canal, caller, sessionId });
  const session = getSessionState(sessionKey);

  if (!speechLimpio) {
    return {
      kind: "retry",
      message: "No escuchamos su mensaje. Por favor intente de nuevo.",
    };
  }

  let clasificacion;

  if (session.waitingVehicle && session.lastPiece && session.waitingIntent) {
    clasificacion = {
      intent: session.waitingIntent,
      pieza: session.lastPiece,
      respuesta: "Entendido.",
    };
  } else if (intentHint) {
    clasificacion = { intent: intentHint, pieza: speechLimpio, respuesta: "Entendido." };
  } else {
    clasificacion = await obtenerClasificacion(speechLimpio);
  }

  let { intent, pieza } = clasificacion;

  if (!pieza && ["CONSULTA_PRECIO", "CONSULTA_DISPONIBILIDAD", "PEDIDO"].includes(intent) && session.lastPiece) {
    pieza = session.lastPiece;
  }

  const parsed = separarPiezaYVehiculo(pieza, speechLimpio);
  const piezaSolicitada = parsed.pieza;
  const vehiculoSolicitado = parsed.vehiculo || session.lastVehicle;

  if (intent === "DESPEDIDA") {
    return {
      kind: "hangup",
      message: "Gracias por llamar a Refacciones Automotrices Franco. ¡Que tenga un excelente día!",
    };
  }

  if (intent === "HABLAR_ASESOR") {
    if (canal === "local") {
      return {
        kind: "message",
        message: "Claro. En una llamada real lo transferiría con un asesor. ¿Hay algo más en lo que le pueda ayudar?",
        askMore: false,
      };
    }

    return { kind: "transfer" };
  }

  if (intent === "DESCONOCIDO") {
    if (session.waitingVehicle && session.lastPiece && session.waitingIntent) {
      intent = session.waitingIntent;
      pieza = session.lastPiece;
    } else {
      return {
        kind: "unknown",
        message: "No pude entender su solicitud. Puede preguntarme por precio, disponibilidad, comprar una pieza o pedir un asesor.",
      };
    }
  }

  if (!piezaSolicitada) {
    session.waitingVehicle = false;
    session.waitingIntent = intent;
    return {
      kind: "ask-piece",
      message: crearPreguntaPorIntent(intent),
      pendingIntent: intent,
    };
  }

  session.lastPiece = piezaSolicitada;
  session.lastIntent = intent;
  if (vehiculoSolicitado) session.lastVehicle = vehiculoSolicitado;

  let piezaData = null;
  try {
    piezaData = await sheets.buscarPieza(piezaSolicitada, { vehiculo: vehiculoSolicitado || "" });
  } catch (err) {
    console.error("Error al buscar pieza:", err);
  }

  if (!piezaData) {
    session.waitingVehicle = false;
    return {
      kind: "message",
      message: `No encontré ninguna pieza con el nombre ${piezaSolicitada}. Puede intentar con otro nombre o código.`,
      askMore: true,
    };
  }

  // Enfoque de venta + compatibilidad: pedir vehículo si no viene.
  if (!vehiculoSolicitado) {
    session.waitingVehicle = true;
    session.waitingIntent = intent;
    return {
      kind: "message",
      message: `Perfecto, sí manejo ${piezaData.nombre}. Para confirmar compatibilidad y cerrar la venta, ¿para qué vehículo la necesita? Dígame marca y modelo.`,
      askMore: false,
    };
  }

  session.waitingVehicle = false;
  session.waitingIntent = null;

  if (!esCompatibleVehiculo(piezaData, vehiculoSolicitado)) {
    return {
      kind: "message",
      message: `Encontré ${piezaData.nombre}, pero no parece compatible con ${vehiculoSolicitado}. Si quiere, le paso con un asesor para validar compatibilidad exacta y ofrecerle alternativa.`,
      askMore: true,
    };
  }

  if (intent === "CONSULTA_PRECIO") {
    return {
      kind: "message",
      message:
        `La pieza ${piezaData.nombre}, SKU ${piezaData.sku}, ` +
        `tiene un precio de ${twimlHelper.formatearPrecio(piezaData.precio)} pesos. ` +
        (piezaData.disponible
          ? `Está disponible y tenemos ${piezaData.stock} unidades. ¿Desea que se la registre en pedido ahora mismo?`
          : "Por el momento no está disponible en inventario."),
      askMore: true,
    };
  }

  if (intent === "CONSULTA_DISPONIBILIDAD") {
    return {
      kind: "message",
      message: piezaData.disponible
        ? `La pieza ${piezaData.nombre} sí está disponible para ${vehiculoSolicitado}. Tenemos ${piezaData.stock} unidades. ¿Quiere que se la registre en pedido?`
        : `Lo sentimos, la pieza ${piezaData.nombre} no está disponible en este momento. Stock actual: ${piezaData.stock} unidades.`,
      askMore: true,
    };
  }

  if (!piezaData.disponible || piezaData.stock <= 0) {
    return {
      kind: "message",
      message: `Lo sentimos, la pieza ${piezaData.nombre} no está disponible en este momento.`,
      askMore: true,
    };
  }

  try {
    await sheets.registrarPedido({
      telefono: caller || (canal === "local" ? "LOCAL_TEST" : ""),
      sku: piezaData.sku,
      nombre: piezaData.nombre,
      precio: piezaData.precio,
    });
    console.log(`✅ Pedido registrado: ${piezaData.sku} para ${caller || "LOCAL_TEST"}`);
  } catch (err) {
    console.error("Error al registrar pedido:", err);
    return {
      kind: "hangup",
      message: "Ocurrió un error al registrar su pedido. Por favor intente más tarde o comuníquese con un asesor.",
    };
  }

  return {
    kind: "order-confirmed",
    pieza: piezaData,
    message:
      `Su pedido ha sido registrado correctamente. ` +
      `Pieza: ${piezaData.nombre}. ` +
      `SKU: ${piezaData.sku}. ` +
      `Precio: ${twimlHelper.formatearPrecio(piezaData.precio)} pesos. ` +
      `En breve un asesor se pondrá en contacto para confirmar su pedido. ` +
      `Gracias por preferir Refacciones Automotrices Franco. ¡Hasta luego!`,
  };
}

function responderTelefonia(res, resultado) {
  if (resultado.kind === "retry") {
    return sendTwiml(res, twimlHelper.menuPrincipal(resultado.message));
  }

  if (resultado.kind === "hangup") {
    return sendTwiml(res, twimlHelper.responder(resultado.message));
  }

  if (resultado.kind === "transfer") {
    return sendTwiml(res, twimlHelper.transferir(ASESOR_PHONE));
  }

  if (resultado.kind === "unknown") {
    return sendTwiml(res, twimlHelper.menuPrincipal(resultado.message));
  }

  if (resultado.kind === "ask-piece") {
    return sendTwiml(
      res,
      twimlHelper.solicitarPieza(`/intent-pieza?intent=${resultado.pendingIntent}`, resultado.message)
    );
  }

  if (resultado.kind === "order-confirmed") {
    return sendTwiml(res, twimlHelper.confirmarPedido(resultado.pieza));
  }

  return sendTwiml(
    res,
    resultado.askMore ? twimlHelper.preguntarSiNecesitaAlgoMas(resultado.message) : twimlHelper.responder(resultado.message)
  );
}

app.get("/local-test", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "local-test.html"));
});

app.post("/local-test/intent", async (req, res) => {
  const speech = (req.body.speech || "").trim();
  const pendingIntent = req.body.pendingIntent || null;
  const sessionId = req.body.sessionId || "default";

  console.log(`🖥️  Prueba local: "${speech}" pendingIntent=${pendingIntent || "-"}`);

  const resultado = await resolverSolicitudCliente({
    speech,
    caller: "LOCAL_TEST",
    canal: "local",
    intentHint: pendingIntent,
    sessionId,
  });

  res.json({
    replyText: resultado.message || "No pude generar una respuesta.",
    pendingIntent: resultado.kind === "ask-piece" ? resultado.pendingIntent : null,
    ended: resultado.kind === "hangup" || resultado.kind === "order-confirmed",
    kind: resultado.kind,
  });
});

// ─── /voice — Punto de entrada (bienvenida por voz) ──────────────────────────
app.post(
  "/voice",
  twilioWebhook((req, res) => {
    console.log(`📞 Llamada entrante desde ${req.body.From}`);
    sendTwiml(res, twimlHelper.menuPrincipal());
  })
);

// ─── /intent — Claude procesa lo que dijo el cliente ─────────────────────────
app.post(
  "/intent",
  twilioWebhook(async (req, res) => {
    const speech = (req.body.SpeechResult || "").trim();
    const caller = req.body.From || "";

    console.log(`🎤 Voz reconocida: "${speech}" desde ${caller}`);
    const resultado = await resolverSolicitudCliente({ speech, caller, canal: "telefono" });
    return responderTelefonia(res, resultado);
  })
);

// ─── /intent-pieza — Segunda vuelta: cliente dijo el nombre de la pieza ───────
app.post(
  "/intent-pieza",
  twilioWebhook(async (req, res) => {
    const speech = (req.body.SpeechResult || "").trim();
    const intent = req.query.intent || "CONSULTA_PRECIO";

    console.log(`🎤 Pieza por voz: "${speech}" intent=${intent}`);
    const resultado = await resolverSolicitudCliente({
      speech,
      caller: req.body.From || "",
      canal: "telefono",
      intentHint: intent,
    });
    return responderTelefonia(res, resultado);
  })
);

// ─── /transferir/fallback — Asesor no contestó ────────────────────────────────
app.post(
  "/transferir/fallback",
  twilioWebhook((req, res) => {
    const dialStatus = req.body.DialCallStatus;
    console.log(`📵 Estado de la transferencia: ${dialStatus}`);

    if (dialStatus === "completed") {
      return sendTwiml(res, twimlHelper.responder(
        "Gracias por llamar a Refacciones Automotrices Franco. ¡Hasta luego!"
      ));
    }

    sendTwiml(res, twimlHelper.fallbackAsesor());
  })
);

// ─── /transferir/callback — Confirma devolución de llamada por voz ────────────
app.post(
  "/transferir/callback",
  twilioWebhook(async (req, res) => {
    const speech = (req.body.SpeechResult || "").toLowerCase();
    const caller = req.body.From || "";

    const afirmativo = ["sí", "si", "yes", "claro", "por favor", "ándale", "órale", "ok", "bueno"].some(
      (p) => speech.includes(p)
    );

    if (afirmativo) {
      try {
        await sheets.registrarCallback(caller);
        console.log(`📋 Callback registrado para ${caller}`);
        return sendTwiml(res, twimlHelper.responder(
          "Perfecto. Hemos registrado su número. Un asesor le llamará a la brevedad. ¡Gracias por su paciencia!"
        ));
      } catch (err) {
        console.error("Error al registrar callback:", err);
        return sendTwiml(res, twimlHelper.responder(
          "Ocurrió un error al registrar su solicitud. Por favor intente más tarde."
        ));
      }
    }

    sendTwiml(res, twimlHelper.menuPrincipal("De acuerdo. ¿En qué más le puedo ayudar?"));
  })
);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Arranque ─────────────────────────────────────────────────────────────────
async function main() {
  try {
    await sheets.inicializarHojas();
  } catch (err) {
    console.error("⚠️  No se pudo conectar a Google Sheets:", err.message);
    console.error(
      "   Verifica GOOGLE_SHEET_ID/GOOGLE_SHEETS_ID y GOOGLE_CREDENTIALS_JSON o GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY en .env"
    );
  }

  app.listen(PORT, () => {
    console.log(`\n🚀  Conmutador IA (voz + Claude) corriendo en http://localhost:${PORT}`);
    console.log(`    Webhooks disponibles:`);
    console.log(`      POST /voice               ← Punto de entrada Twilio`);
    console.log(`      POST /intent              ← Claude procesa voz del cliente`);
    console.log(`      POST /intent-pieza        ← Segunda vuelta para capturar pieza`);
    console.log(`      GET  /local-test          ← Probador local en navegador`);
    console.log(`      POST /local-test/intent   ← Endpoint JSON para probador local`);
    console.log(`      POST /transferir/fallback ← Asesor no contestó`);
    console.log(`      POST /transferir/callback ← Confirmar devolución de llamada (por voz)`);
    console.log(`      GET  /health              ← Health check\n`);
  });
}

main();
