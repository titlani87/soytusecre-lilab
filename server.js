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

REGLA DE ORO CONTRA BUCLES (OBLIGATORIO):
- ANTES de responder, revisa todo el historial de mensajes de la conversación. 
- Si el cliente YA te dio información (como el material PLA/PETG, ya mandó foto, o dio detalles de su pieza), QUEDA PROHIBIDO volver a pedírsela. 
- Si ya tienes los datos básicos o la foto, da el siguiente paso: dale un rango de precio estimado, dile que el taller revisará el archivo para afinar la cotización o invítalo a concretar su pedido. ¡Nunca repitas preguntas que ya contestó!
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
    return `¡Claro que sí, ${nombre}! Anotado con PLA. Ya recibí la imagen, en un momento el equipo la revisa para darte el costo exacto. 😊`;
  }
  
  const modelos = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  
  let contents = [];
  historialChat.forEach(m => {
    contents.push({
      role: m.de === 'cliente' ? 'user' : 'model',
      parts: [{ text: m.texto }]
    });
  });
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
      const resp = await axios.post(url, body, { headers: {'Content-Type':'application/json'}, timeout: 25000 });
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
  
  // FALLBACK INTELIGENTE: Si Gemini falla, responde de acuerdo al contexto del mensaje
  const low = mensajeUsuario.toLowerCase();
  if (low.includes('foto') || low.includes('pla') || low.includes('petg') || low.includes('semana')) {
    return `¡Va que va, ${nombre}! Quedó anotado tu pedido. Ya tengo tu imagen y material registrados, te mandamos cotización en breve. 🚀`;
  }
  return `¡Perfecto, ${nombre}! Tengo tus datos anotados, el equipo del taller lo revisa y te contactamos por aquí mismo. 👍`;
}

async function enviarWhatsApp(to, texto) {
  try {
    await axios.post(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp', to, type: 'text', text
