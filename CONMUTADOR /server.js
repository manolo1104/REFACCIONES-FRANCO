"use strict";

require("dotenv").config();

const express = require("express");
const twilio = require("twilio");
const twimlHelper = require("./twiml");
const sheets = require("./sheets");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ASESOR_PHONE = process.env.ASESOR_PHONE;

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

// ─── /voice — Punto de entrada (bienvenida + menú) ───────────────────────────
app.post(
  "/voice",
  twilioWebhook((req, res) => {
    console.log(`📞 Llamada entrante desde ${req.body.From}`);
    sendTwiml(res, twimlHelper.menuPrincipal());
  })
);

// ─── /menu — Procesa la selección del menú principal ─────────────────────────
app.post(
  "/menu",
  twilioWebhook(async (req, res) => {
    const digito = req.body.Digits;
    console.log(`🔢 Menú: dígito=${digito}`);

    switch (digito) {
      case "1":
        // Consultar precio
        sendTwiml(
          res,
          twimlHelper.solicitarEntrada(
            "/consulta?tipo=precio",
            "Para consultar el precio de una pieza, ingrese el SKU seguido de la tecla numeral. " +
              "Si no conoce el SKU, ingrese los primeros dígitos del nombre de la pieza y presione numeral.",
            20
          )
        );
        break;

      case "2":
        // Verificar disponibilidad
        sendTwiml(
          res,
          twimlHelper.solicitarEntrada(
            "/consulta?tipo=disponibilidad",
            "Para verificar disponibilidad, ingrese el SKU de la pieza seguido de la tecla numeral.",
            20
          )
        );
        break;

      case "3":
        // Realizar pedido
        sendTwiml(
          res,
          twimlHelper.solicitarEntrada(
            "/pedido",
            "Para realizar su pedido, ingrese el SKU de la pieza que desea y presione la tecla numeral.",
            20
          )
        );
        break;

      case "4":
        // Transferir a asesor
        sendTwiml(res, twimlHelper.transferir(ASESOR_PHONE));
        break;

      default:
        sendTwiml(
          res,
          twimlHelper.menuPrincipal(
            "No reconocimos su selección. Por favor intente de nuevo."
          )
        );
    }
  })
);

// ─── /consulta — Busca pieza y responde precio o disponibilidad ───────────────
app.post(
  "/consulta",
  twilioWebhook(async (req, res) => {
    const query = (req.body.Digits || "").trim();
    const tipo = req.query.tipo || "precio";
    const caller = req.body.From || "";

    console.log(`🔍 Consulta tipo=${tipo} query="${query}" from=${caller}`);

    if (!query) {
      return sendTwiml(
        res,
        twimlHelper.responder(
          "No recibimos ningún dato. Regresando al menú.",
          "/voice"
        )
      );
    }

    let pieza = null;
    try {
      pieza = await sheets.buscarPieza(query);
    } catch (err) {
      console.error("Error al buscar pieza:", err);
    }

    if (!pieza) {
      // Pieza no encontrada → ofrecer asesor
      const xml = buildPiezaNoEncontradaResponse(query);
      return sendTwiml(res, xml);
    }

    let mensaje = "";

    if (tipo === "precio") {
      mensaje =
        `La pieza ${pieza.nombre}, SKU ${pieza.sku}, ` +
        `tiene un precio de ${twimlHelper.formatearPrecio(pieza.precio)} pesos. ` +
        `Stock actual: ${pieza.stock} unidades. ` +
        (pieza.disponible ? "Se encuentra disponible." : "Por el momento no está disponible.");
    } else {
      // disponibilidad
      mensaje = pieza.disponible
        ? `La pieza ${pieza.nombre}, SKU ${pieza.sku}, ` +
          `está disponible. Contamos con ${pieza.stock} unidades en existencia.`
        : `Lo sentimos. La pieza ${pieza.nombre}, SKU ${pieza.sku}, ` +
          `no está disponible en este momento. Stock actual: ${pieza.stock} unidades.`;
    }

    // Después de informar, regresa al menú
    const twimlRes = require("twilio").twiml.VoiceResponse;
    const resp = new twimlRes();

    const gather = resp.gather({
      numDigits: 1,
      action: "/menu",
      method: "POST",
      timeout: 10,
    });

    twimlHelper.say(gather, mensaje);
    twimlHelper.say(
      gather,
      "Para volver al menú principal presione cualquier tecla, o espere un momento."
    );

    twimlHelper.say(resp, "Regresando al menú principal.");
    resp.redirect({ method: "POST" }, "/voice");

    sendTwiml(res, resp.toString());
  })
);

// ─── /pedido — Captura SKU, verifica stock y registra pedido ─────────────────
app.post(
  "/pedido",
  twilioWebhook(async (req, res) => {
    const sku = (req.body.Digits || "").trim();
    const caller = req.body.From || "";

    console.log(`🛒 Pedido SKU="${sku}" from=${caller}`);

    if (!sku) {
      return sendTwiml(
        res,
        twimlHelper.responder("No recibimos el SKU. Regresando al menú.", "/voice")
      );
    }

    let pieza = null;
    try {
      pieza = await sheets.buscarPieza(sku);
    } catch (err) {
      console.error("Error al buscar pieza para pedido:", err);
    }

    if (!pieza) {
      return sendTwiml(res, buildPiezaNoEncontradaResponse(sku));
    }

    if (!pieza.disponible || pieza.stock <= 0) {
      const VR = require("twilio").twiml.VoiceResponse;
      const resp = new VR();
      const gather = resp.gather({
        numDigits: 1,
        action: "/menu",
        method: "POST",
        timeout: 10,
      });
      twimlHelper.say(
        gather,
        `Lo sentimos. La pieza ${pieza.nombre} no está disponible en este momento. ` +
          `Presione cuatro para hablar con un asesor o cualquier otra tecla para el menú.`
      );
      resp.redirect({ method: "POST" }, "/voice");
      return sendTwiml(res, resp.toString());
    }

    // Registrar pedido
    try {
      await sheets.registrarPedido({
        telefono: caller,
        sku: pieza.sku,
        nombre: pieza.nombre,
        precio: pieza.precio,
      });
      console.log(`✅ Pedido registrado: ${pieza.sku} para ${caller}`);
    } catch (err) {
      console.error("Error al registrar pedido:", err);
      return sendTwiml(
        res,
        twimlHelper.responder(
          "Ocurrió un error al registrar su pedido. Por favor intente más tarde o comuníquese con un asesor.",
          "/voice"
        )
      );
    }

    sendTwiml(res, twimlHelper.confirmarPedido(pieza));
  })
);

// ─── /transferir — Transfiere al asesor ──────────────────────────────────────
app.post(
  "/transferir",
  twilioWebhook((req, res) => {
    console.log(`📲 Transfiriendo a asesor: ${ASESOR_PHONE}`);
    sendTwiml(res, twimlHelper.transferir(ASESOR_PHONE));
  })
);

// ─── /transferir/fallback — Asesor no contestó ───────────────────────────────
app.post(
  "/transferir/fallback",
  twilioWebhook((req, res) => {
    const dialStatus = req.body.DialCallStatus;
    console.log(`📵 Estado de la transferencia: ${dialStatus}`);

    // Si el asesor contestó y colgó, terminar limpiamente
    if (dialStatus === "completed") {
      return sendTwiml(
        res,
        twimlHelper.responder("Gracias por llamar a Refacciones Automotrices. ¡Hasta luego!")
      );
    }

    // No contestó: ofrecer callback
    sendTwiml(res, twimlHelper.fallbackAsesor());
  })
);

// ─── /transferir/callback — Confirma solicitud de devolución de llamada ───────
app.post(
  "/transferir/callback",
  twilioWebhook(async (req, res) => {
    const digito = req.body.Digits;
    const caller = req.body.From || "";

    if (digito === "1") {
      try {
        await sheets.registrarCallback(caller);
        console.log(`📋 Callback registrado para ${caller}`);
        sendTwiml(
          res,
          twimlHelper.responder(
            "Hemos registrado su número. Un asesor le llamará a la brevedad. " +
              "Gracias por su paciencia. ¡Hasta luego!"
          )
        );
      } catch (err) {
        console.error("Error al registrar callback:", err);
        sendTwiml(
          res,
          twimlHelper.responder(
            "Ocurrió un error al registrar su solicitud. Por favor intente más tarde. ¡Hasta luego!"
          )
        );
      }
    } else {
      // Regresa al menú
      sendTwiml(res, twimlHelper.menuPrincipal());
    }
  })
);

// ─── Helper: respuesta cuando pieza no se encuentra ──────────────────────────
function buildPiezaNoEncontradaResponse(query) {
  const VR = require("twilio").twiml.VoiceResponse;
  const resp = new VR();

  const gather = resp.gather({
    numDigits: 1,
    action: "/menu",
    method: "POST",
    timeout: 10,
  });

  twimlHelper.say(
    gather,
    `No encontramos ninguna pieza con el dato ${query}. ` +
      `Presione cuatro para hablar con un asesor, ` +
      `o cualquier otra tecla para regresar al menú principal.`
  );

  resp.redirect({ method: "POST" }, "/voice");
  return resp.toString();
}

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
    console.error("   Verifica GOOGLE_SHEET_ID y GOOGLE_CREDENTIALS_JSON en .env");
  }

  app.listen(PORT, () => {
    console.log(`\n🚀  Servidor IVR corriendo en http://localhost:${PORT}`);
    console.log(`    Webhooks disponibles:`);
    console.log(`      POST /voice              ← Punto de entrada Twilio`);
    console.log(`      POST /menu               ← Selección del menú`);
    console.log(`      POST /consulta           ← Consulta precio/disponibilidad`);
    console.log(`      POST /pedido             ← Registro de pedido`);
    console.log(`      POST /transferir         ← Transferir a asesor`);
    console.log(`      POST /transferir/fallback← Asesor no contestó`);
    console.log(`      POST /transferir/callback← Registrar devolución de llamada`);
    console.log(`      GET  /health             ← Health check\n`);
  });
}

main();
