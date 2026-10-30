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
const ADMIN_KEY = process.env.ADMIN_KEY || 'cocdep123';
const NOTIFY_NUMBER = process.env.NOTIFY_NUMBER || '5219993243402';

const DB_PATH = path.join('/tmp', 'cocdep_db.json');
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch(e) {}
  return { chats: {}, citas: [] };
}
function saveDB(db) {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch(e) { console.error('Error saveDB', e.message); }
}
let DB = loadDB();

const SYSTEM_PROMPT = `Eres Lupita, la asesora virtual oficial de COCDEP. Tu tono es amable, profesional, cálido y de confianza (mexicano cercano, usa expresiones como "claro que sí", "con gusto", "va que va").

INFORMACIÓN OFICIAL DE LOS PRODUCTOS Y SERVICIOS DE COCDEP:
1. PRÉSTAMOS / CRÉDITOS INDIVIDUALES ("Credimpulsados / Emprendedores y Negocios"):
   - Montos: Desde $1,000 hasta $300,000 pesos (con opciones de Crédito Impulsa desde $5,000).
   - Plazos: De 1 hasta 18 meses.
   - Modalidad de pagos: Semanales, bisemanales o quincenales (pagos fijos y a tu medida).
   - Requisitos (Acreditado y Aval): Credencial de elector (INE) y comprobante de domicilio con antigüedad no mayor a 3 meses. Además pide garantía y 4 referencias.
2. CRÉDITOS GRUPALES:
   - Integrantes: De al menos 3 personas.
   - Beneficios: ¡Sin aval!, pagos fijos a tu medida. 
   - Garantía líquida: Se entrega después de recibir tu crédito.
   - Requisitos: Credencial de elector (INE) y comprobante de domicilio (no mayor a 3 meses) de cada integrante.

OBJETIVO PRINCIPAL DE LA CONVERSACIÓN:
Resolver dudas sobre los créditos, orientar al cliente según lo que necesite (individual o grupo) y **agendar la visita presencial de un asesor** en su domicilio o negocio.

DATOS QUE DEBES RECABAR (Paso a paso, sin abrumar):
1. Qué tipo de crédito le interesa (Individual o Grupal) y monto aproximado.
2. Nombre completo.
3. Dirección exacta / colonia para la visita del asesor.
4. Qué día y horario exacto le queda cómodo recibirlo.

REGLA DE ORO CONTRA BUCLES:
- Revisa el historial de mensajes. Si el usuario ya te dio su dirección, el horario o el tipo de crédito, NUNCA se los vuelvas a pedir. 
- Cuando tengas completos los datos de la cita (Nombre, Dirección, Día y Hora), confírmale de enterado, felicítalo y dile que su cita quedó agendada y que un asesor se presentará puntualmente. 
- Sé breve (máximo 3 oraciones). Máximo 2 emojis.
`;

function detectarIntencion(texto) {
  const low = texto.toLowerCase();
  const esCita = /credito|crédito|prestamo|préstamo|individual|grupal|asesor|visita|cita|dinero|financiamiento|necesito|interesa|domicilio|horario|dia|días|requisitos|monto/.test(low);
  return { esCita };
}

async function generarConGemini(historialChat, mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    return `¡Hola ${nombre}! Con gusto te atendemos en COCDEP. Tenemos créditos individuales (hasta $300k) y grupales desde 3 personas. ¿Qué tipo de crédito te interesa y qué día te puede visitar un asesor? 😊`;
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
        generationConfig: { temperature: 0.7, maxOutputTokens: 500, topP: 0.9 }
      };
      
      const resp = await axios.post(url, body, { headers: {'Content-Type':'application/json'}, timeout: 20000 });
      const cand = resp.data?.candidates?.[0];
      if (!cand) continue;
      let texto = (cand.content?.parts || []).map(p=>p.text||'').join('').trim();
      if (texto && texto.length > 5) return texto;
    } catch (e) {
      continue;
    }
  }
  
  return `¡Claro que sí, ${nombre}! En COCDEP te apoyamos con créditos individuales o grupales. Para agendar la visita de nuestro asesor, ¿me podrías confirmar tu dirección y qué día y horario te queda mejor? 🤝`;
}

async function enviarWhatsApp(to, texto) {
  try {
    await axios.post(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Error WA:', e.message);
  }
}

async function notificarOwner(mensaje) {
  if (!NOTIFY_NUMBER || !WHATSAPP_TOKEN) return;
  try {
    await enviarWhatsApp(NOTIFY_NUMBER, mensaje);
  } catch(e) {}
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else res.sendStatus(403);
});

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

    if (message.type === 'text') {
      textoUsuario = message.text.body;
    } else if (message.type === 'image') {
      textoUsuario = `[El cliente envió una imagen / documento]`;
    } else {
      textoUsuario = `[Mensaje tipo ${message.type}]`;
    }

    if (!DB.chats[from]) {
      DB.chats[from] = { nombre, telefono: from, mensajes: [], ultimo: new Date().toISOString() };
    }

    DB.chats[from].mensajes.push({ de: 'cliente', texto: textoUsuario, hora: new Date().toISOString(), tipo });
    DB.chats[from].ultimo = new Date().toISOString();
    DB.chats[from].nombre = nombre;

    // Detectar intención de cita o solicitud de crédito
    const intent = detectarIntencion(textoUsuario);
    if (intent.esCita && !DB.citas.find(p => p.telefono === from && Date.now() - new Date(p.fecha).getTime() < 3600000)) {
      DB.citas.push({ id: Date.now(), nombre, telefono: from, detalle: textoUsuario, fecha: new Date().toISOString(), estado: 'Cita Solicitada' });
      await notificarOwner(`📅 NUEVA SOLICITUD COCDEP\nDe: ${nombre} (${from})\nMensaje:${textoUsuario}\n\nRevisa el Dashboard:
