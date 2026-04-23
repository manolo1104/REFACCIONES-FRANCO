# 📞 XCONMUTADOR — Sistema IVR para Refacciones Automotrices

Conmutador telefónico automatizado construido con **Node.js + Express**, **Twilio** y **Google Sheets** como base de datos de inventario.

---

## 🗂️ Estructura del proyecto

```
XCONMUTADOR/
├── server.js          # Servidor Express — todos los webhooks de Twilio
├── sheets.js          # Módulo Google Sheets (buscar pieza, registrar pedido/callback)
├── twiml.js           # Helpers TwiML con voz es-MX (Polly.Mia)
├── .env.example       # Plantilla de variables de entorno
├── .env               # Tu archivo de variables (NO subir a Git)
├── package.json
└── README.md
```

---

## 🔁 Flujo de llamada (IVR)

```
Llamada entrante → /voice
         │
         ▼
    Menú principal
    ┌─────────────────────────────────────────┐
    │  1 → Consultar precio        → /consulta?tipo=precio
    │  2 → Verificar disponibilidad → /consulta?tipo=disponibilidad
    │  3 → Realizar pedido          → /pedido
    │  4 → Hablar con asesor        → /transferir
    └─────────────────────────────────────────┘
         │
         ▼ (asesor no contesta)
    /transferir/fallback
         │
    1 → Registrar callback → /transferir/callback → Google Sheets
    2 → Volver al menú
```

---

## ⚙️ Configuración paso a paso

### 1. Clonar e instalar dependencias

```bash
git clone <tu-repo>
cd XCONMUTADOR
npm install
```

### 2. Crear el archivo `.env`

Copia `.env.example` a `.env` y rellena los valores:

```bash
cp .env.example .env
```

---

### 3. Configurar Twilio

1. Crea una cuenta en [twilio.com](https://www.twilio.com) (la prueba gratuita incluye crédito).
2. En el **Dashboard** copia:
   - `Account SID` → `TWILIO_ACCOUNT_SID`
   - `Auth Token`  → `TWILIO_AUTH_TOKEN`
3. Ve a **Phone Numbers → Manage → Buy a Number**.
   - Elige un número con capacidad de voz.
   - Cópialo en formato E.164 (`+52155XXXXXXXX`) → `TWILIO_PHONE_NUMBER`.
4. En la consola del número, en **Voice & Fax → A call comes in**, pon:
   - **Webhook:** `https://<TU_DOMINIO>/voice`
   - **HTTP:** `POST`

---

### 4. Crear el Service Account de Google

1. Ve a [console.cloud.google.com](https://console.cloud.google.com).
2. Crea un proyecto (o usa uno existente).
3. Activa la API **Google Sheets API**:
   - APIs & Services → Enable APIs → busca "Google Sheets API" → Habilitar.
4. Crea un Service Account:
   - IAM & Admin → Service Accounts → **Create Service Account**.
   - Dale un nombre (p. ej. `ivr-sheets`).
   - Role: **Editor** (o "Google Sheets Editor" si usas roles personalizados).
5. Genera la clave JSON:
   - En el Service Account → pestaña **Keys** → Add Key → JSON.
   - Descarga el archivo `.json`.
6. Convierte el JSON a una sola línea y pégalo en `GOOGLE_CREDENTIALS_JSON`:

```bash
# Convierte el JSON a una línea (macOS/Linux)
cat tu-key.json | tr -d '\n'
```

7. Crea el spreadsheet en Google Sheets y copia su ID de la URL:
   - URL: `https://docs.google.com/spreadsheets/d/`**`1BxiMVs0XRA...`**`/edit`
   - Pega ese ID en `GOOGLE_SHEET_ID`.
8. **Comparte** el spreadsheet con el email del Service Account (el campo `client_email` en el JSON) con rol **Editor**.

> El servidor creará automáticamente las hojas **Inventario**, **Pedidos** y **Callbacks** con sus cabeceras al arrancar por primera vez.

---

### 5. Estructura de las hojas de Google Sheets

#### Hoja: `Inventario`

| SKU | Nombre | Precio | Stock | Disponible |
|-----|--------|--------|-------|------------|
| FLT-001 | Filtro de aceite Bosch | 185.00 | 42 | Sí |
| BAT-002 | Batería 12V Optima | 2350.00 | 8 | Sí |
| PAD-003 | Balatas delanteras Brembo | 890.00 | 0 | No |

- **Disponible**: escribe `Sí` o `Si` para disponible, cualquier otro valor = no disponible.

#### Hoja: `Pedidos`

| Fecha | Teléfono | SKU | Nombre_Pieza | Precio | Estado |
|-------|----------|-----|--------------|--------|--------|
| 22/04/2026 10:30 | +5215512345678 | FLT-001 | Filtro de aceite Bosch | 185.00 | Pendiente |

#### Hoja: `Callbacks`

| Fecha | Teléfono | Estado |
|-------|----------|--------|
| 22/04/2026 11:00 | +5215512345678 | Pendiente |

---

## 🛠️ Desarrollo local con ngrok

1. Instala ngrok: [ngrok.com/download](https://ngrok.com/download)
2. Arranca el servidor en modo desarrollo:

```bash
npm run dev
```

3. En otra terminal, expón el puerto:

```bash
ngrok http 3000
```

4. Copia la URL HTTPS que ngrok te da (p. ej. `https://abc123.ngrok.io`) y:
   - Pégala en `BASE_URL` de tu `.env`
   - Configura el webhook en Twilio: `https://abc123.ngrok.io/voice`

> En modo `development` (`NODE_ENV=development`) la validación de firma Twilio está desactivada para facilitar pruebas.

---

## 🚀 Deploy en Railway

1. Crea una cuenta en [railway.app](https://railway.app).
2. Conecta tu repositorio de GitHub con el proyecto.
3. En Railway → tu proyecto → **Variables**, agrega todas las variables de `.env`:

   | Variable | Valor |
   |----------|-------|
   | `TWILIO_ACCOUNT_SID` | `ACxxx...` |
   | `TWILIO_AUTH_TOKEN` | `xxx...` |
   | `TWILIO_PHONE_NUMBER` | `+521...` |
   | `GOOGLE_SHEET_ID` | `1Bxi...` |
   | `GOOGLE_CREDENTIALS_JSON` | `{"type":"service_account",...}` |
   | `ASESOR_PHONE` | `+521...` |
   | `PORT` | `3000` |
   | `BASE_URL` | `https://tu-app.up.railway.app` |
   | `NODE_ENV` | `production` |

4. Railway desplegará automáticamente con `npm start`.
5. Copia el dominio que Railway asigna (p. ej. `https://xconmutador.up.railway.app`).
6. Actualiza el webhook en Twilio con esa URL: `https://xconmutador.up.railway.app/voice`.

---

## 🔊 Voz sintetizada (Polly.Mia)

El sistema usa **Amazon Polly – Mia (es-MX)** a través de Twilio. Para habilitarla:

1. En Twilio Console → **Voice** → **Text-to-Speech** → verifica que Polly esté habilitado.
2. Si no está disponible en tu cuenta, el sistema usa la voz estándar `es-MX` de Twilio automáticamente. Para cambiar a voz estándar, edita `twiml.js`:

```js
const VOZ = {
  language: "es-MX",
  voice: "Polly.Mia",   // Cambia a "woman" si Polly no está disponible
};
```

---

## 📋 Variables de entorno

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `TWILIO_ACCOUNT_SID` | Account SID de Twilio | `ACxxxxxxxx...` |
| `TWILIO_AUTH_TOKEN` | Auth Token de Twilio | `xxxxxxxx...` |
| `TWILIO_PHONE_NUMBER` | Número Twilio en E.164 | `+5215512345678` |
| `GOOGLE_SHEET_ID` | ID del Google Spreadsheet | `1BxiMVs0XRA5...` |
| `GOOGLE_CREDENTIALS_JSON` | JSON del Service Account (una línea) | `{"type":"service_account",...}` |
| `ASESOR_PHONE` | Número del asesor en E.164 | `+5215587654321` |
| `PORT` | Puerto del servidor | `3000` |
| `BASE_URL` | URL pública del servidor | `https://tu-app.up.railway.app` |
| `NODE_ENV` | Entorno (`development` / `production`) | `production` |

---

## 🧪 Probar el IVR manualmente

Puedes probar los webhooks con `curl` antes de conectar Twilio:

```bash
# Bienvenida / menú principal
curl -X POST http://localhost:3000/voice

# Seleccionar opción 1 (consultar precio)
curl -X POST http://localhost:3000/menu -d "Digits=1"

# Consultar pieza por SKU
curl -X POST "http://localhost:3000/consulta?tipo=precio" -d "Digits=FLT-001&From=%2B5215512345678"

# Hacer un pedido
curl -X POST http://localhost:3000/pedido -d "Digits=FLT-001&From=%2B5215512345678"

# Health check
curl http://localhost:3000/health
```

---

## 📁 `.gitignore` recomendado

```
node_modules/
.env
*.json.key
```

---

## 📄 Licencia

MIT
