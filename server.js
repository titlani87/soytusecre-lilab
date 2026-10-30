const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'soytusecre_verify_123';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1426928223838877';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'lilab123';
const NOTIFY_NUMBER = process.env.NOTIFY_NUMBER || '5219993243402';

// Persistencia simple en archivo
const DB_PATH = path.join('/tmp', 'lilab_db.json');
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch(e) {}
  return { chats: {}, pedidos: [], citas: [] };
}
function saveDB(db) {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch(e) { console.error('Error saveDB', e.message); }
}
let DB = loadDB();

const SYSTEM_PROMPT = `Eres Lupita, la asistente virtual de Lilab Estudio, un estudio de impresión 3D en CDMX y Mérida. Tu tono es cálido, súper humano, cercano y natural (mexicanismo ligero, usa expresiones como "va que va", "claro que sí", "sin problema", pero sin exagerar). 

DATOS OFICIALES DEL ESTUDIO:
- Precios de impresión: PLA a $5.50 por gramo (para interiores); PETG a $10.00 por gramo (para exteriores, aguanta sol y agua).
- Tiempos y entregas: Tiempos de entrega estándar de 24 a 72 horas máximo. Entregas en Macropaza a las 12:00 pm. Sin anticipo para empezar.
- Redes y contacto: Instagram oficial es https://www.instagram.com/lilabestudio/
- Formatos aceptados para cotizar: STL, 3MF, OBJ, o simplemente una foto / idea de lo que quieren.
- Tamaños máx: 22 x 22 x 25 cm (si es más grande se divide en partes).

REGLA DE ORO CONTRA BUCLES (MUY IMPORTANTE):
- Revisa el historial reciente de la conversación. Si el cliente YA te dio información (como el tamaño, material, idea o si ya le respondiste lo que pedía), **NUNCA VUELVAS A PEDIRLE LO MISMO**. 
- Si ya tienes los datos básicos, avanza al siguiente paso: invítalo a mandar el archivo STL/foto final o confírmale el registro de su cotización.
- NUNCA dejes frases incompletas. Sé concisa (máximo 3 oraciones). Máximo 2 emojis.
`;

function detectarIntencion(texto) {
  const low = texto.toLowerCase();
  const esPedido = /quiero|cotiz|cuanto|precio|pedido|comprar|encargar|llavero|imprimir|pieza/.test(low);
  const esCita = /cita|entrega|macropaza|cuando|hora|entregan|recoger|paso|hoy|mañana/.test(low);
  return { esPedido, esCita };
}

async function generarConGemini(historialChat, mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    return `Hola ${nombre}! Soy la secre de Lilab 😊 Mandame foto o STL y te cotizo en 10 min. PLA $5.5/gr, PETG $10/gr.`;
  }
  
  // Modelos vigentes y estables
  const modelos = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  
  // Convertimos el historial previo guardado en formato compatible con Gemini
  let contents = [];
  historialChat.forEach(m => {
    contents.push({
      role: m.de === 'cliente' ? 'user' : 'model',
      parts: [{ text: m.texto }]
    });
  });
  // Añadimos el mensaje actual
  contents.push({ role: "user", parts: [{ text: `Cliente ${nombre} dice: "${mensajeUsuario}"` }] });

  for (const modelo of modelos) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 600, topP: 0.9 }
      };
      
      console.log(`Probando modelo: ${modelo}`);
      const resp = await axios.post(url, body, { headers: {'Content-Type':'application/json'}, timeout: 20000 });
      const cand = resp.data?.candidates?.[0];
      if (!cand) continue;
      let texto = (cand.content?.parts || []).map(p=>p.text||'').join('').trim();
      console.log(`OK ${modelo} | ${texto.length} chars`);
      if (texto && texto.length > 10) return texto;
    } catch (e) {
      const errMsg = e.response?.data?.error?.message || e.message;
      console.error(`Fallo ${modelo}: ${errMsg?.substring(0,300)}`);
      continue;
    }
  }
  
  // Fallback por si la API falla
  const low = mensajeUsuario.toLowerCase();
  if (low.includes('foto')) return `¡Sí! Mándame la foto 😊 Con eso te digo si se puede imprimir y te ayudo con el archivo.`;
  return `¡Hola ${nombre}! Soy la secre de Lilab 😊 Mándame foto o archivo STL y te cotizo de inmediato.`;
}

async function enviarWhatsApp(to, texto) {
  try {
    await axios.post(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp', to, type: 'text', text: { body: texto }
    }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
    console.log(`Enviado OK a ${to}`);
  } catch (e) {
    console.error('Error WA:', JSON.stringify(e.response?.data || e.message).substring(0,600));
  }
}

async function notificarOwner(mensaje) {
  if (!NOTIFY_NUMBER || !WHATSAPP_TOKEN) return;
  try {
    await enviarWhatsApp(NOTIFY_NUMBER, mensaje);
  } catch(e) {}
}

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO');
    res.status(200).send(challenge);
  } else res.sendStatus(403);
});

// Webhook receiver
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return;
    
    const from = message.from;
    const nombre = value?.contacts?.[0]?.profile?.name || 'Cliente';
    let textoUsuario = '';
    let tipo = message.type;

    if (message.type === 'text') textoUsuario = message.text.body;
    else if (message.type === 'image') textoUsuario = '[Foto recibida] ¿Pueden imprimir esto?';
    else if (message.type === 'document') textoUsuario = `[Archivo: ${message.document?.filename}]`;
    else textoUsuario = `[${message.type}]`;

    console.log(`\n--- ${nombre} (${from}): ${textoUsuario} ---`);

    // Inicializar chat en DB si no existe
    if (!DB.chats[from]) {
      DB.chats[from] = { nombre, telefono: from, mensajes: [], ultimo: new Date().toISOString() };
    }

    // Guardar mensaje del cliente en historial
    DB.chats[from].mensajes.push({ de: 'cliente', texto: textoUsuario, hora: new Date().toISOString(), tipo });
    DB.chats[from].ultimo = new Date().toISOString();
    DB.chats[from].nombre = nombre;

    // Detectar si es pedido o cotización
    const intent = detectarIntencion(textoUsuario);
    if (intent.esPedido && !DB.pedidos.find(p => p.telefono === from && Date.now() - new Date(p.fecha).getTime() < 3600000)) {
      DB.pedidos.push({ id: Date.now(), nombre, telefono: from, descripcion: textoUsuario, fecha: new Date().toISOString(), estado: 'Nuevo' });
      await notificarOwner(`🛒 NUEVO PEDIDO\nDe: ${nombre} (${from})\nDice: ${textoUsuario}\n\nRevisa dashboard: https://soytusecre-lilab.onrender.com/admin?key=${ADMIN_KEY}`);
    }
    saveDB(DB);

    // Generar respuesta con historial reciente (últimos 6 mensajes para contexto y evitar bucles)
    const historialReciente = DB.chats[from].mensajes.slice(-6);
    const respuesta = await generarConGemini(
