// Catálogo de productos, sucursales y datos de Auto Refacciones Franco

const CATEGORIAS = {
  frenos: {
    emoji: '🔴',
    nombre: 'Frenos y Sistema de Frenado',
    descripcion: 'Balatas, discos, tambores, cilindros, líquido de frenos, mangueras',
    marcas: ['Bosch', 'Monroe', 'Wagner', 'Bendix', 'Centric']
  },
  suspension: {
    emoji: '🔩',
    nombre: 'Suspensión y Dirección',
    descripcion: 'Amortiguadores, terminales, rótulas, bujes, barras, muelles',
    marcas: ['Monroe', 'Gabriel', 'KYB', 'Moog', 'TRW']
  },
  motor: {
    emoji: '⚙️',
    nombre: 'Motor y Distribución',
    descripcion: 'Juntas, bandas, tensores, bombas de agua, termostatos, sellos',
    marcas: ['Victor Reinz', 'Gates', 'Dayco', 'Felpro', 'Motorad']
  },
  electrico: {
    emoji: '⚡',
    nombre: 'Sistema Eléctrico',
    descripcion: 'Baterías, alternadores, marcha, fusibles, sensores, bujías',
    marcas: ['Bosch', 'Delphi', 'NGK', 'Denso', 'AC Delco']
  },
  filtros: {
    emoji: '🌀',
    nombre: 'Filtros',
    descripcion: 'Filtro de aceite, aire, gasolina, cabina',
    marcas: ['Bosch', 'Mann', 'Fram', 'Purolator', 'Moresa']
  },
  transmision: {
    emoji: '🔧',
    nombre: 'Transmisión y Clutch',
    descripcion: 'Kit de clutch, cojinetes, discos, tapones, soportes',
    marcas: ['LUK', 'Sachs', 'Valeo', 'Exedy', 'Federal Mogul']
  },
  lubricantes: {
    emoji: '🛢️',
    nombre: 'Lubricantes y Fluidos',
    descripcion: 'Aceite de motor, ATF, líquido de frenos, anticongelante, grasa',
    marcas: ['Castrol', 'Mobil', 'Valvoline', 'Pennzoil', 'Shell']
  },
  escape: {
    emoji: '💨',
    nombre: 'Sistema de Escape',
    descripcion: 'Silenciadores, catalizadores, tubos, sensores de oxígeno, juntas',
    marcas: ['Walker', 'Bosal', 'Econoflow', 'Uniflow', 'Lusac']
  }
};

// Productos de ejemplo con precios reales (modo prueba — disponibilidad es aleatoria)
const PRODUCTOS_EJEMPLO = [
  // FRENOS
  { id: 'FR001', cat: 'frenos', nombre: 'Balatas Delanteras', marca: 'Bosch', sku: 'BP-568', oem: 'D1060-ET00A', vehiculos: 'Nissan Versa 2018-2024', precio: 890, tipo: 'alt' },
  { id: 'FR002', cat: 'frenos', nombre: 'Balatas Traseras', marca: 'Monroe', sku: 'BX-721', oem: '44060-3TA0A', vehiculos: 'Nissan Versa / Tiida', precio: 720, tipo: 'alt' },
  { id: 'FR003', cat: 'frenos', nombre: 'Disco de Freno Delantero', marca: 'Bosch', sku: 'BD-447', oem: '40206-ET30A', vehiculos: 'Nissan Sentra 2020-2024', precio: 1450, tipo: 'alt' },
  { id: 'FR004', cat: 'frenos', nombre: 'Tambor de Freno Trasero', marca: 'Monroe', sku: 'BT-329', oem: '43206-50Y00', vehiculos: 'Nissan Tsuru / Platina', precio: 980, tipo: 'alt' },
  { id: 'FR005', cat: 'frenos', nombre: 'Cilindro Maestro de Frenos', marca: 'Delphi', sku: 'CM-115', oem: '46010-1HA0A', vehiculos: 'Nissan universal', precio: 1200, tipo: 'alt' },

  // SUSPENSIÓN
  { id: 'SU001', cat: 'suspension', nombre: 'Amortiguador Delantero', marca: 'Monroe', sku: 'AM-4011', oem: '54302-3TA0A', vehiculos: 'Nissan Versa 2012-2024', precio: 1350, tipo: 'alt' },
  { id: 'SU002', cat: 'suspension', nombre: 'Amortiguador Trasero', marca: 'Gabriel', sku: 'AM-4012', oem: '56210-3TA0A', vehiculos: 'Nissan Versa / Tiida', precio: 1200, tipo: 'alt' },
  { id: 'SU003', cat: 'suspension', nombre: 'Terminal de Dirección', marca: 'Moog', sku: 'TD-887', oem: '48521-3TA0A', vehiculos: 'Nissan Versa 2012-2024', precio: 450, tipo: 'alt' },
  { id: 'SU004', cat: 'suspension', nombre: 'Rótula Inferior', marca: 'Moog', sku: 'RO-552', oem: '40160-3TA0A', vehiculos: 'Nissan Versa / Sentra', precio: 680, tipo: 'alt' },
  { id: 'SU005', cat: 'suspension', nombre: 'Kit Buje de Horquilla', marca: 'TRW', sku: 'BU-221', oem: '54570-3TA0A', vehiculos: 'Nissan Versa 2012+', precio: 380, tipo: 'gen' },

  // MOTOR
  { id: 'MO001', cat: 'motor', nombre: 'Junta de Cabeza', marca: 'Victor Reinz', sku: 'JC-1441', oem: '11044-ED80A', vehiculos: 'Nissan HR16 1.6L', precio: 2100, tipo: 'oem' },
  { id: 'MO002', cat: 'motor', nombre: 'Banda de Distribución', marca: 'Gates', sku: 'BD-K015610', oem: '13028-AU300', vehiculos: 'Nissan SR20 / GA16', precio: 890, tipo: 'alt' },
  { id: 'MO003', cat: 'motor', nombre: 'Bomba de Agua', marca: 'Motorad', sku: 'BA-4411', oem: '21010-0M610', vehiculos: 'Nissan Tsuru / Platina / Tiida', precio: 1100, tipo: 'alt' },
  { id: 'MO004', cat: 'motor', nombre: 'Termostato 82°C', marca: 'Motorad', sku: 'TM-267', oem: '21200-0M200', vehiculos: 'Nissan universal', precio: 320, tipo: 'alt' },
  { id: 'MO005', cat: 'motor', nombre: 'Empaque de Carter', marca: 'Felpro', sku: 'EC-VS50299', oem: '11110-ED80A', vehiculos: 'Nissan HR16 / MR18', precio: 480, tipo: 'alt' },

  // ELÉCTRICO
  { id: 'EL001', cat: 'electrico', nombre: 'Batería 45Ah', marca: 'Bosch', sku: 'BAT-S4E08', oem: 'S4E08', vehiculos: 'Nissan Versa / Tsuru / universal', precio: 2800, tipo: 'oem' },
  { id: 'EL002', cat: 'electrico', nombre: 'Bujías (juego 4)', marca: 'NGK', sku: 'BU-BKR6EGP', oem: 'BKR6EGP', vehiculos: 'Nissan 1.6L universal', precio: 560, tipo: 'alt' },
  { id: 'EL003', cat: 'electrico', nombre: 'Sensor MAP', marca: 'Delphi', sku: 'SE-PS10096', oem: '22365-ED80A', vehiculos: 'Nissan Tiida / Versa / March', precio: 890, tipo: 'alt' },
  { id: 'EL004', cat: 'electrico', nombre: 'Sensor de Oxígeno', marca: 'Bosch', sku: 'SE-15269', oem: '22690-ED80A', vehiculos: 'Nissan Versa / Tiida 1.6', precio: 1350, tipo: 'alt' },
  { id: 'EL005', cat: 'electrico', nombre: 'Alternador', marca: 'Bosch', sku: 'AL-0124515105', oem: '23100-ED800', vehiculos: 'Nissan Versa / Tiida 1.6', precio: 4200, tipo: 'alt' },

  // FILTROS
  { id: 'FI001', cat: 'filtros', nombre: 'Filtro de Aceite', marca: 'Bosch', sku: 'FO-3422', oem: '15208-65F0A', vehiculos: 'Nissan HR16 universal', precio: 180, tipo: 'alt' },
  { id: 'FI002', cat: 'filtros', nombre: 'Filtro de Aire', marca: 'Mann', sku: 'FA-C25003', oem: '16546-ED000', vehiculos: 'Nissan Versa / Tiida / March', precio: 320, tipo: 'alt' },
  { id: 'FI003', cat: 'filtros', nombre: 'Filtro de Gasolina', marca: 'Fram', sku: 'FG-G8218', oem: '16400-65F0A', vehiculos: 'Nissan Tsuru / Platina', precio: 290, tipo: 'alt' },
  { id: 'FI004', cat: 'filtros', nombre: 'Filtro de Cabina', marca: 'Bosch', sku: 'FC-1987432116', oem: 'B7030-1KA1A', vehiculos: 'Nissan Versa / Sentra 2012+', precio: 420, tipo: 'alt' },

  // TRANSMISIÓN
  { id: 'TR001', cat: 'transmision', nombre: 'Kit de Clutch', marca: 'LUK', sku: 'CL-624305700', oem: '30210-ED81A', vehiculos: 'Nissan Versa / Tiida 1.6 MT', precio: 3800, tipo: 'alt' },
  { id: 'TR002', cat: 'transmision', nombre: 'Disco de Clutch', marca: 'Valeo', sku: 'DC-803580', oem: '30100-ED81A', vehiculos: 'Nissan Versa / Tiida 1.6 MT', precio: 1900, tipo: 'alt' },

  // LUBRICANTES
  { id: 'LU001', cat: 'lubricantes', nombre: 'Aceite 5W30 Sintético 1L', marca: 'Castrol', sku: 'AC-5W30-1L', oem: '-', vehiculos: 'Universal', precio: 320, tipo: 'gen' },
  { id: 'LU002', cat: 'lubricantes', nombre: 'Aceite 10W40 Semisintético 1L', marca: 'Valvoline', sku: 'AC-10W40-1L', oem: '-', vehiculos: 'Universal', precio: 240, tipo: 'gen' },
  { id: 'LU003', cat: 'lubricantes', nombre: 'Líquido de Frenos DOT 3', marca: 'Castrol', sku: 'LF-DOT3', oem: '-', vehiculos: 'Universal', precio: 180, tipo: 'gen' },
  { id: 'LU004', cat: 'lubricantes', nombre: 'Anticongelante 50/50 1L', marca: 'Prestone', sku: 'AN-5050-1L', oem: '-', vehiculos: 'Universal', precio: 210, tipo: 'gen' }
];

const SUCURSALES = {
  vertiz331: {
    nombre: 'Sucursal Vértiz 331',
    direccion: 'Dr. Vértiz 331, Col. Doctores, CDMX',
    telefono: '55 5519-6040',
    whatsapp: '525555196040',
    horario: {
      'Lunes–Viernes': '8:00am – 7:00pm',
      'Sábado': '8:00am – 5:00pm',
      'Domingo': 'Cerrado'
    },
    maps: 'https://maps.google.com/?q=Dr.+Vértiz+331+CDMX',
    email: 'vertiz331@refaccionesfranco.com'
  },
  vertiz343: {
    nombre: 'Sucursal Vértiz 343',
    direccion: 'Dr. Vértiz 343, Col. Doctores, CDMX',
    telefono: '55 5519-6041',
    whatsapp: '525555196041',
    horario: {
      'Lunes–Viernes': '8:00am – 7:00pm',
      'Sábado': '8:00am – 5:00pm',
      'Domingo': 'Cerrado'
    },
    maps: 'https://maps.google.com/?q=Dr.+Vértiz+343+CDMX',
    email: 'vertiz343@refaccionesfranco.com'
  }
};

const DATOS_EMPRESA = {
  nombre: 'Auto Refacciones Franco',
  eslogan: '60 años siendo tu aliado en el taller',
  fundacion: 1964,
  sucursales: 2,
  piezas: '35,000+',
  marcas: ['Bosch', 'Monroe', 'Gates', 'NGK', 'Delphi', 'LUK', 'Victor Reinz', 'Mann', 'Castrol', 'Valvoline', 'Fram', 'Motorad', 'Moog', 'TRW', 'Valeo'],
  whatsapp_principal: '525555196040',
  email: 'ventas@refaccionesfranco.com',
  especialidad: 'Vehículos Nissan (también atendemos otras marcas)',
  garantia: '6 meses en piezas de marca / 90 días en genéricas',
  envio: 'Envíos a toda la República Mexicana vía DHL / FedEx / Estafeta',
  pago: {
    banco: 'BBVA',
    titular: 'Auto Refacciones Franco SA de CV',
    cuenta: '0112233445',
    clabe: '012180001122334456',
    tarjeta: 'Visa, Mastercard (en sucursal y por transferencia)',
    efectivo: 'Efectivo en sucursal'
  }
};

const VEHICULOS_POPULARES = [
  'Nissan Versa (2006–2024)',
  'Nissan Tsuru (1992–2017)',
  'Nissan Tiida (2006–2015)',
  'Nissan March (2011–2024)',
  'Nissan Sentra (2012–2024)',
  'Nissan NP300 / Estacas',
  'Nissan X-Trail (2014–2024)',
  'Nissan Kicks (2017–2024)',
  'Chevrolet Aveo / Sonic',
  'Volkswagen Jetta / Vento',
  'Toyota Corolla / Yaris',
  'Ford Focus / Figo'
];

module.exports = { CATEGORIAS, PRODUCTOS_EJEMPLO, SUCURSALES, DATOS_EMPRESA, VEHICULOS_POPULARES };
