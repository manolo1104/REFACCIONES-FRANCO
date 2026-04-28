// Auto Refacciones Franco — WhatsApp Bot

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { processMessage, getSession } = require('./agent');

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'refacciones-franco' }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true
  }
});

// ══════════════════════════════════════════
// EVENTOS DE CONEXIÓN
// ══════════════════════════════════════════

client.on('qr', (qr) => {
  console.clear();
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('   🔧  AUTO REFACCIONES FRANCO — WhatsApp Bot   ');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('📱 Escanea este código con tu WhatsApp:');
  console.log('   (Abre WhatsApp → ⋮ → Dispositivos vinculados → Vincular dispositivo)');
  console.log('');
  qrcode.generate(qr, { small: true });
  console.log('');
  console.log('⏳ Esperando que escanees el QR...');
  console.log('');
});

client.on('authenticated', () => {
  console.log('🔐 Sesión autenticada correctamente.');
});

client.on('ready', () => {
  console.log('');
  console.log('✅ ¡Bot de Refacciones Franco conectado y listo!');
  console.log('');
  console.log('📋 COMANDOS DEL DUEÑO (escríbelos desde TU WhatsApp):');
  console.log('   /status          → Verifica que el bot esté activo');
  console.log('   /help            → Muestra los comandos disponibles');
  console.log('   /pedido RF-101   → Muestra los datos del pedido en sesión');
  console.log('');
  console.log('🤖 El bot está atendiendo clientes automáticamente.');
  console.log('   Presiona Ctrl+C para apagar el bot.');
  console.log('');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Error de autenticación:', msg);
  console.log('   Borra la carpeta .wwebjs_auth y vuelve a ejecutar el bot.');
});

client.on('disconnected', (reason) => {
  console.log('⚠️  Bot desconectado:', reason);
  console.log('   Vuelve a ejecutar: node index.js');
});

// ══════════════════════════════════════════
// MENSAJES ENTRANTES (de clientes)
// ══════════════════════════════════════════

client.on('message', async (msg) => {
  if (msg.isGroupMsg || msg.from === 'status@broadcast') return;

  const from = msg.from;
  const body = msg.body?.trim();

  if (!body) return;

  console.log(`📨 Cliente [${from}]: ${body.substring(0, 80)}`);

  try {
    const response = await processMessage(from, body);
    await client.sendMessage(from, response);
  } catch (error) {
    console.error(`❌ Error procesando mensaje de ${from}:`, error.message);
    await client.sendMessage(
      from,
      'Lo siento, tuve un problema técnico momentáneo. Por favor escribe de nuevo en un momento. 🙏'
    );
  }
});

// ══════════════════════════════════════════
// COMANDOS DEL DUEÑO (mensajes enviados desde TU teléfono)
// ══════════════════════════════════════════

client.on('message_create', async (msg) => {
  if (!msg.fromMe) return;

  const body = msg.body?.trim();
  if (!body) return;

  if (body === '/status') {
    await msg.reply('✅ Bot de Refacciones Franco activo y funcionando. 🔧');
    return;
  }

  if (body === '/help') {
    await msg.reply(
      '*Comandos del bot Auto Refacciones Franco:*\n\n' +
      '*/status* → Verifica que el bot esté activo\n' +
      '*/help* → Muestra esta ayuda\n' +
      '*/pedido RF-XXX* → Muestra datos del pedido en sesión\n\n' +
      '_El bot atiende clientes automáticamente en modo prueba._\n' +
      '_La disponibilidad es aleatoria hasta conectar el inventario real._'
    );
    return;
  }

  if (body.startsWith('/pedido ')) {
    const folio = body.replace('/pedido ', '').trim().toUpperCase();
    await handleConsultaPedido(msg, folio);
    return;
  }
});

// ══════════════════════════════════════════
// CONSULTA DE PEDIDO
// ══════════════════════════════════════════

async function handleConsultaPedido(msg, folio) {
  console.log(`🔍 Consultando pedido: ${folio}`);
  await msg.reply(
    `ℹ️ *Pedido ${folio}*\n\n` +
    `Para ver los detalles completos revisa el historial de WhatsApp con el cliente.\n\n` +
    `El pedido fue registrado y al cliente se le enviaron instrucciones de pago.`
  );
}

// ══════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════

async function start() {
  console.log('');
  console.log('🚀 Iniciando Auto Refacciones Franco Bot...');
  console.log('   Modo: PRUEBA (disponibilidad aleatoria)');
  console.log('');

  client.initialize();
}

start().catch(err => {
  console.error('❌ Error al iniciar:', err.message);
  process.exit(1);
});
