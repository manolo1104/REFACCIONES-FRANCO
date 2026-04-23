"use strict";

const twilio = require("twilio");
const VoiceResponse = twilio.twiml.VoiceResponse;

// ─── Configuración de voz ────────────────────────────────────────────────────
const VOZ = {
  language: "es-MX",
  voice: "Polly.Mia",   // Amazon Polly – Neural. Fallback: "woman" si no está habilitada.
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
 * Genera una respuesta TwiML con el menú principal.
 * @param {string} [mensajeExtra] - Mensaje opcional antes del menú (error, bienvenida, etc.)
 * @returns {string} XML TwiML
 */
function menuPrincipal(mensajeExtra = "") {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    action: "/menu",
    method: "POST",
    timeout: 10,
  });

  if (mensajeExtra) {
    say(gather, mensajeExtra);
  }

  say(
    gather,
    "Bienvenido a Refacciones Automotrices. " +
      "Para consultar el precio de una pieza, presione uno. " +
      "Para verificar disponibilidad, presione dos. " +
      "Para realizar un pedido, presione tres. " +
      "Para hablar con un asesor, presione cuatro."
  );

  // Fallback si no se presiona nada en 10 s
  say(twiml, "No recibimos su selección. Le repetiremos el menú.");
  twiml.redirect({ method: "POST" }, "/voice");

  return twiml.toString();
}

/**
 * Genera un <Gather> que solicita un SKU o nombre de pieza por voz/DTMF.
 * @param {string} accion  - URL del webhook que recibirá el dígito / SKU
 * @param {string} mensaje - Instrucción que se le da al usuario
 * @param {number} [digitos=20] - Número máximo de dígitos para DTMF
 * @returns {string} XML TwiML
 */
function solicitarEntrada(accion, mensaje, digitos = 20) {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    numDigits: digitos,
    action: accion,
    method: "POST",
    timeout: 10,
    finishOnKey: "#",
  });

  say(gather, mensaje);

  // Fallback
  say(twiml, "No recibimos información. Regresando al menú principal.");
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
 * Respuesta cuando el asesor no contesta: ofrece devolución de llamada.
 * @returns {string} XML TwiML
 */
function fallbackAsesor() {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    action: "/transferir/callback",
    method: "POST",
    timeout: 10,
  });

  say(
    gather,
    "Lo sentimos, nuestro asesor no está disponible en este momento. " +
      "Para que le devolvamos la llamada, presione uno. " +
      "Para regresar al menú principal, presione dos."
  );

  // Fallback sin respuesta
  twiml.redirect({ method: "POST" }, "/voice");

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
      `Gracias por preferir Refacciones Automotrices. ¡Hasta luego!`
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
  solicitarEntrada,
  responder,
  transferir,
  fallbackAsesor,
  confirmarPedido,
  formatearPrecio,
  say,
};
