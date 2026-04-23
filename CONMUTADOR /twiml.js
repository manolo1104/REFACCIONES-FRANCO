"use strict";

const twilio = require("twilio");
const VoiceResponse = twilio.twiml.VoiceResponse;

// ─── Configuración de voz ────────────────────────────────────────────────────
const VOZ = {
  language: "es-MX",
  voice: "Polly.Mia",
};

/**
 * Crea un <Say> con los ajustes de español México.
 * @param {VoiceResponse | VoiceResponse.Gather} parent - Nodo TwiML al que agregar el <Say>
 * @param {string} texto - Texto a sintetizar
 */
function say(parent, texto) {
  parent.say(VOZ, texto);
}

/**
 * Bienvenida principal. Captura voz libre del cliente (sin presionar teclas).
 * @param {string} [mensajeExtra] - Mensaje opcional antes de pedir input
 * @returns {string} XML TwiML
 */
function menuPrincipal(mensajeExtra = "") {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: "speech",
    language: "es-MX",
    action: "/intent",
    method: "POST",
    speechTimeout: "auto",
    timeout: 5,
  });

  if (mensajeExtra) {
    say(gather, mensajeExtra);
  }

  say(
    gather,
    "Bienvenido a Refacciones Automotrices Franco. " +
      "Soy su asistente virtual. " +
      "¿En qué le puedo ayudar hoy?"
  );

  say(twiml, "No escuchamos su respuesta. Por favor intente de nuevo.");
  twiml.redirect({ method: "POST" }, "/voice");

  return twiml.toString();
}

/**
 * Pide al cliente que diga el nombre o SKU de una pieza por voz.
 * @param {string} accion  - URL del webhook que recibirá el resultado
 * @param {string} mensaje - Instrucción para el cliente
 * @returns {string} XML TwiML
 */
function solicitarPieza(accion, mensaje) {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: "speech",
    language: "es-MX",
    action: accion,
    method: "POST",
    speechTimeout: "auto",
    timeout: 6,
  });

  say(gather, mensaje);

  say(twiml, "No recibimos su respuesta. Regresando al menú principal.");
  twiml.redirect({ method: "POST" }, "/voice");

  return twiml.toString();
}

/**
 * Respuesta de voz simple sin interacción.
 * @param {string} mensaje
 * @param {string|null} [redirigirA] - URL a la que redirigir después, o null para colgar
 * @returns {string} XML TwiML
 */
function responder(mensaje, redirigirA = null) {
  const twiml = new VoiceResponse();
  say(twiml, mensaje);

  if (redirigirA) {
    twiml.redirect({ method: "POST" }, redirigirA);
  } else {
    twiml.hangup();
  }

  return twiml.toString();
}

/**
 * Transfiere la llamada a un número externo con <Dial>.
 * Si el asesor no contesta, redirige a /transferir/fallback.
 * @param {string} numero - Número destino en formato E.164
 * @returns {string} XML TwiML
 */
function transferir(numero) {
  const twiml = new VoiceResponse();

  say(twiml, "Un momento, le transferimos con un asesor.");

  const dial = twiml.dial({
    action: "/transferir/fallback",
    method: "POST",
    timeout: 20,
    callerId: process.env.TWILIO_PHONE_NUMBER,
  });

  dial.number(numero);

  return twiml.toString();
}

/**
 * Asesor no disponible: pide confirmación por voz para callback.
 * @returns {string} XML TwiML
 */
function fallbackAsesor() {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: "speech",
    language: "es-MX",
    action: "/transferir/callback",
    method: "POST",
    speechTimeout: "auto",
    timeout: 6,
  });

  say(
    gather,
    "Lo sentimos, nuestro asesor no está disponible en este momento. " +
      "¿Desea que le devolvamos la llamada? Diga sí o no."
  );

  twiml.redirect({ method: "POST" }, "/voice");
  return twiml.toString();
}

/**
 * Responde la consulta y pregunta si el cliente necesita algo más.
 * @param {string} mensajeRespuesta
 * @returns {string} XML TwiML
 */
function preguntarSiNecesitaAlgoMas(mensajeRespuesta) {
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: "speech",
    language: "es-MX",
    action: "/intent",
    method: "POST",
    speechTimeout: "auto",
    timeout: 6,
  });
  say(gather, mensajeRespuesta + " ¿Hay algo más en lo que le pueda ayudar?");
  say(twiml, "Gracias por llamar a Refacciones Franco. ¡Hasta luego!");
  twiml.hangup();
  return twiml.toString();
}

/**
 * Confirmación de pedido realizado.
 * @param {object} pieza - { nombre, precio, sku }
 * @returns {string} XML TwiML
 */
function confirmarPedido(pieza) {
  const twiml = new VoiceResponse();

  say(
    twiml,
    `Su pedido ha sido registrado correctamente. ` +
      `Pieza: ${pieza.nombre}. ` +
      `SKU: ${pieza.sku}. ` +
      `Precio: ${formatearPrecio(pieza.precio)} pesos. ` +
      `En breve un asesor se pondrá en contacto para confirmar su pedido. ` +
      `Gracias por preferir Refacciones Automotrices Franco. ¡Hasta luego!`
  );

  twiml.hangup();
  return twiml.toString();
}

/**
 * Formatea un número como precio en español.
 * @param {number|string} precio
 * @returns {string}
 */
function formatearPrecio(precio) {
  const num = parseFloat(precio);
  if (isNaN(num)) return precio;
  return num.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = {
  menuPrincipal,
  solicitarPieza,
  responder,
  transferir,
  fallbackAsesor,
  confirmarPedido,
  preguntarSiNecesitaAlgoMas,
  formatearPrecio,
  say,
};
