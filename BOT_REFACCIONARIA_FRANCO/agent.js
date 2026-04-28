// Agente de IA con Claude para Auto Refacciones Franco

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { CATEGORIAS, PRODUCTOS_EJEMPLO, SUCURSALES, DATOS_EMPRESA, VEHICULOS_POPULARES } = require('./data');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Historial de conversación por usuario (teléfono -> { history, pedido })
const sessions = new Map();

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, { history: [], pedido: {} });
  }
  return sessions.get(phone);
}

function clearSession(phone) {
  sessions.delete(phone);
}

// Folio simple incremental
let folioCounter = 100;
function generarFolio() {
  folioCounter++;
  return `RF-${folioCounter}`;
}

// Disponibilidad aleatoria para modo prueba (70% disponible, 20% bajo pedido, 10% agotado)
function randomStock() {
  const r = Math.random();
  if (r < 0.70) return 'disponible';
  if (r < 0.90) return 'bajo_pedido';
  return 'agotado';
}

// ══════════════════════════════════════════════════════════
// HERRAMIENTAS DEL AGENTE
// ══════════════════════════════════════════════════════════
const tools = [
  {
    name: 'buscar_refaccion',
    description: 'Busca refacciones disponibles para un vehículo y tipo de pieza específicos. Devuelve opciones con precios, marcas y disponibilidad (modo prueba: aleatoria). Úsala cuando el cliente mencione qué pieza necesita o para qué vehículo.',
    input_schema: {
      type: 'object',
      properties: {
        vehiculo: {
          type: 'string',
          description: 'Marca, modelo y año del vehículo (ej: Nissan Versa 2019, Toyota Corolla 2015)'
        },
        pieza: {
          type: 'string',
          description: 'Nombre o descripción de la pieza que busca (ej: balatas, amortiguador, filtro de aceite, banda de distribución)'
        },
        categoria: {
          type: 'string',
          description: 'Categoría de la pieza: frenos, suspension, motor, electrico, filtros, transmision, lubricantes, escape',
          enum: ['frenos', 'suspension', 'motor', 'electrico', 'filtros', 'transmision', 'lubricantes', 'escape', 'general']
        }
      },
      required: ['vehiculo', 'pieza']
    }
  },
  {
    name: 'verificar_disponibilidad',
    description: 'Verifica si una pieza específica está disponible en sucursal para entrega inmediata o si requiere pedido especial. También indica en qué sucursal hay existencia.',
    input_schema: {
      type: 'object',
      properties: {
        pieza_id: {
          type: 'string',
          description: 'ID de la pieza a verificar (ej: FR001, SU001) — obtenido de buscar_refaccion'
        },
        pieza_nombre: {
          type: 'string',
          description: 'Nombre de la pieza para referencias de piezas no estándar'
        }
      },
      required: ['pieza_nombre']
    }
  },
  {
    name: 'crear_pedido',
    description: 'Crea un pedido con folio único cuando el cliente confirma que quiere comprar. Guarda los datos del pedido. Usar SOLO cuando el cliente haya confirmado la pieza, precio y forma de entrega.',
    input_schema: {
      type: 'object',
      properties: {
        cliente: {
          type: 'string',
          description: 'Nombre completo del cliente'
        },
        telefono: {
          type: 'string',
          description: 'Número de WhatsApp del cliente (solo dígitos)'
        },
        pieza: {
          type: 'string',
          description: 'Nombre completo de la pieza o piezas solicitadas'
        },
        vehiculo: {
          type: 'string',
          description: 'Vehículo del cliente (marca, modelo, año)'
        },
        marca_pieza: {
          type: 'string',
          description: 'Marca de la refacción seleccionada'
        },
        precio_total: {
          type: 'number',
          description: 'Precio total del pedido en pesos MXN'
        },
        entrega: {
          type: 'string',
          description: 'Forma de entrega: sucursal_331, sucursal_343, envio_domicilio',
          enum: ['sucursal_331', 'sucursal_343', 'envio_domicilio']
        },
        notas: {
          type: 'string',
          description: 'Notas adicionales del pedido (opcional)'
        }
      },
      required: ['cliente', 'telefono', 'pieza', 'vehiculo', 'precio_total', 'entrega']
    }
  },
  {
    name: 'info_sucursales',
    description: 'Devuelve información actualizada de las sucursales: direcciones, horarios, teléfonos y cómo llegar.',
    input_schema: {
      type: 'object',
      properties: {
        sucursal: {
          type: 'string',
          description: 'Sucursal específica: vertiz331, vertiz343, o "todas" para ambas',
          enum: ['vertiz331', 'vertiz343', 'todas']
        }
      },
      required: ['sucursal']
    }
  }
];

// ══════════════════════════════════════════════════════════
// EJECUTAR HERRAMIENTAS
// ══════════════════════════════════════════════════════════
async function executeTool(toolName, input, phone) {
  switch (toolName) {

    case 'buscar_refaccion': {
      const { vehiculo, pieza, categoria } = input;
      const piezaLower = pieza.toLowerCase();
      const vehiculoLower = vehiculo.toLowerCase();

      // Buscar en catálogo por palabras clave
      let resultados = PRODUCTOS_EJEMPLO.filter(p => {
        const nombreMatch = p.nombre.toLowerCase().includes(piezaLower) ||
          piezaLower.includes(p.nombre.toLowerCase().split(' ')[0]);
        const catMatch = !categoria || categoria === 'general' || p.cat === categoria;
        return nombreMatch && catMatch;
      });

      // Si no hay match exacto, buscar por categoría relacionada
      if (resultados.length === 0 && categoria && categoria !== 'general') {
        resultados = PRODUCTOS_EJEMPLO.filter(p => p.cat === categoria).slice(0, 3);
      }

      // Si aún no hay nada, generar resultados genéricos creativos
      if (resultados.length === 0) {
        const stockGeneral = randomStock();
        return {
          encontrado: true,
          modo_prueba: true,
          vehiculo_consultado: vehiculo,
          pieza_buscada: pieza,
          disponibilidad_general: stockGeneral,
          opciones: [
            {
              id: 'GEN001',
              nombre: pieza,
              marca: 'Monroe',
              tipo: 'alt',
              precio: Math.floor(Math.random() * 800 + 400),
              disponibilidad: stockGeneral,
              vehiculos: vehiculo,
              nota: 'Pieza compatible — confirmar número de parte al recoger'
            },
            {
              id: 'GEN002',
              nombre: pieza,
              marca: 'Genérica',
              tipo: 'gen',
              precio: Math.floor(Math.random() * 400 + 200),
              disponibilidad: randomStock(),
              vehiculos: vehiculo,
              nota: 'Alternativa económica'
            }
          ]
        };
      }

      // Agregar disponibilidad aleatoria a cada resultado
      const opciones = resultados.slice(0, 4).map(p => ({
        id: p.id,
        nombre: p.nombre,
        marca: p.marca,
        sku: p.sku,
        oem: p.oem,
        tipo: p.tipo,
        precio: p.precio,
        disponibilidad: randomStock(),
        vehiculos: p.vehiculos
      }));

      return {
        encontrado: true,
        vehiculo_consultado: vehiculo,
        pieza_buscada: pieza,
        opciones
      };
    }

    case 'verificar_disponibilidad': {
      const { pieza_id, pieza_nombre } = input;
      const stock = randomStock();

      const sucursalConStock = stock === 'disponible'
        ? (Math.random() > 0.5 ? 'Vértiz 331 y Vértiz 343' : 'Vértiz 331')
        : stock === 'bajo_pedido'
          ? 'Disponible en 1–3 días hábiles'
          : null;

      return {
        pieza: pieza_nombre || pieza_id,
        disponibilidad: stock,
        sucursal_con_stock: sucursalConStock,
        tiempo_entrega: stock === 'disponible'
          ? 'Inmediata — pasa a recoger hoy'
          : stock === 'bajo_pedido'
            ? '1 a 3 días hábiles (pedido especial)'
            : null,
        agotado: stock === 'agotado',
        mensaje_agotado: stock === 'agotado'
          ? 'Esta pieza no está en existencia actualmente. Podemos conseguirla en 3–5 días hábiles o buscar una alternativa.'
          : null
      };
    }

    case 'crear_pedido': {
      const folio = generarFolio();
      const session = getSession(phone);
      session.pedido = { folio, ...input, fecha: new Date().toLocaleDateString('es-MX') };

      const sucursalInfo = input.entrega === 'sucursal_331'
        ? SUCURSALES.vertiz331
        : input.entrega === 'sucursal_343'
          ? SUCURSALES.vertiz343
          : null;

      return {
        success: true,
        folio,
        cliente: input.cliente,
        pieza: input.pieza,
        vehiculo: input.vehiculo,
        precio_total: input.precio_total,
        entrega: input.entrega,
        sucursal_direccion: sucursalInfo?.direccion || 'Envío a domicilio — se coordinará dirección',
        datos_pago: {
          banco: DATOS_EMPRESA.pago.banco,
          titular: DATOS_EMPRESA.pago.titular,
          cuenta: DATOS_EMPRESA.pago.cuenta,
          clabe: DATOS_EMPRESA.pago.clabe,
          concepto: folio
        },
        instrucciones: input.entrega === 'envio_domicilio'
          ? 'Envío por DHL/FedEx — costo adicional según zona. Te contactamos para coordinar.'
          : `Pasa a recoger a ${sucursalInfo?.direccion} en horario ${sucursalInfo?.horario['Lunes–Viernes']}`
      };
    }

    case 'info_sucursales': {
      const { sucursal } = input;

      if (sucursal === 'todas') {
        return {
          sucursales: Object.values(SUCURSALES).map(s => ({
            nombre: s.nombre,
            direccion: s.direccion,
            telefono: s.telefono,
            horario: s.horario
          }))
        };
      }

      const s = SUCURSALES[sucursal];
      if (!s) return { error: 'Sucursal no encontrada' };

      return {
        nombre: s.nombre,
        direccion: s.direccion,
        telefono: s.telefono,
        whatsapp: s.whatsapp,
        horario: s.horario,
        email: s.email
      };
    }

    default:
      return { error: `Herramienta desconocida: ${toolName}` };
  }
}

// ══════════════════════════════════════════════════════════
// PROMPT DEL SISTEMA
// ══════════════════════════════════════════════════════════
function buildSystemPrompt() {
  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `Eres el asistente de ventas de *Auto Refacciones Franco* 🔧, la refaccionaria más confiable de la Colonia Doctores en CDMX desde 1964.

Hoy es ${hoy}.

━━━━━━━━━━━━━━━━━━━━━━━━
🏢 QUIÉNES SOMOS
━━━━━━━━━━━━━━━━━━━━━━━━
• 60+ años en el mercado de refacciones automotrices
• 35,000+ piezas en inventario
• Especialistas en Nissan, también atendemos todas las marcas
• 2 sucursales a 12 metros una de otra en Vértiz, Doctores, CDMX
• Marcas que manejamos: Bosch, Monroe, Gates, NGK, Delphi, LUK, Victor Reinz, Mann, Castrol, Valvoline, Fram, Motorad, Moog, TRW, Valeo y más
• Garantía: 6 meses en piezas de marca / 90 días en genéricas
• Envíos a toda la República por DHL / FedEx / Estafeta

━━━━━━━━━━━━━━━━━━━━━━━━
📍 SUCURSALES Y HORARIOS
━━━━━━━━━━━━━━━━━━━━━━━━
🔴 *Vértiz 331* — Dr. Vértiz 331, Col. Doctores, CDMX
   📞 55 5519-6040
   ⏰ Lun–Vie: 8am–7pm | Sáb: 8am–5pm | Dom: Cerrado

🔵 *Vértiz 343* — Dr. Vértiz 343, Col. Doctores, CDMX
   📞 55 5519-6041
   ⏰ Lun–Vie: 8am–7pm | Sáb: 8am–5pm | Dom: Cerrado

━━━━━━━━━━━━━━━━━━━━━━━━
💰 FORMAS DE PAGO
━━━━━━━━━━━━━━━━━━━━━━━━
• Efectivo en sucursal
• Transferencia/Depósito BBVA — Titular: Auto Refacciones Franco SA de CV
  Cuenta: 0112233445 | CLABE: 012180001122334456
• Tarjeta en sucursal (Visa/Mastercard)
• Pago con folio en concepto de transferencia

━━━━━━━━━━━━━━━━━━━━━━━━
📋 CÓMO ATENDER AL CLIENTE (SIGUE ESTE FLUJO)
━━━━━━━━━━━━━━━━━━━━━━━━
1. Saluda con energía y pregunta qué pieza necesita y para qué auto (marca, modelo, año)
2. Usa *buscar_refaccion* para buscar opciones compatibles
3. Presenta las opciones: marca, precio, tipo (OEM/ALT/GEN) y disponibilidad
4. Si el cliente quiere saber si está en stock, usa *verificar_disponibilidad*
5. Cuando el cliente elija, pregunta su nombre y si recoge en sucursal o necesita envío
6. Crea el pedido con *crear_pedido*
7. Envía el folio + instrucciones de pago
8. Pide que manden el comprobante por este chat para confirmar

━━━━━━━━━━━━━━━━━━━━━━━━
🎯 REGLAS IMPORTANTES
━━━━━━━━━━━━━━━━━━━━━━━━
• Responde SIEMPRE en español, de forma amigable y directa, como en WhatsApp
• Usa *negritas* con asteriscos (estilo WhatsApp), NO markdown con doble asterisco complejo
• Si el cliente pregunta por una pieza que no encuentras exacta, IGUAL ayúdalo: usa la herramienta y dile que puedes conseguirla
• Si la disponibilidad es "bajo_pedido", explica que se tarda 1–3 días hábiles
• Si está "agotado", ofrece búsqueda especial o alternativa de otra marca
• Siempre menciona el folio después de crear el pedido
• Mantén respuestas cortas y al punto — la gente en WhatsApp no lee parrafotes
• Si preguntan si tenemos algo y no hay resultado en el sistema, di que SÍ puedes conseguirlo y pregunta el número de parte o más detalles
• Tipos de pieza: OEM = original del fabricante (más caro, mejor calidad), ALT = aftermarket de marca reconocida (buena calidad, precio justo), GEN = genérica (económica, garantía menor)
• Vehículos que más manejamos: ${VEHICULOS_POPULARES.slice(0, 6).join(', ')} y más`;
}

// ══════════════════════════════════════════════════════════
// PROCESAR MENSAJE
// ══════════════════════════════════════════════════════════
async function processMessage(phone, message) {
  const session = getSession(phone);

  session.history.push({ role: 'user', content: message });

  // Mantener historial manejable (últimos 30 mensajes)
  if (session.history.length > 30) {
    session.history = session.history.slice(-30);
  }

  let response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: buildSystemPrompt(),
    tools,
    messages: session.history
  });

  // Loop agéntico: ejecutar herramientas mientras sean necesarias
  while (response.stop_reason === 'tool_use') {
    const assistantContent = response.content;
    session.history.push({ role: 'assistant', content: assistantContent });

    const toolResults = [];
    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        console.log(`🔧 Herramienta: ${block.name}`, JSON.stringify(block.input));
        const result = await executeTool(block.name, block.input, phone);
        console.log(`✅ Resultado:`, JSON.stringify(result));

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
      }
    }

    session.history.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools,
      messages: session.history
    });
  }

  // Extraer texto de respuesta
  const textBlock = response.content.find(b => b.type === 'text');
  const replyText = textBlock?.text || 'Lo siento, hubo un problema. Por favor escribe de nuevo 🙏';

  session.history.push({ role: 'assistant', content: response.content });

  return replyText;
}

module.exports = { processMessage, getSession, clearSession };
