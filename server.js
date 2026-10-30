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

const SYSTEM_PROMPT = `Eres Lupita, la asistente virtual de Lilab Estudio, un estudio de impresión 3D en CDMX y Mérida. Tu tono es cálido, humano, cercano y natural (mexicanismo ligero como "va que va", "claro que sí"). 

DATOS OFICIALES:
- PLA: $5.50/gr (interior). PETG: $10.00/gr (exterior, sol/agua).
- Entrega: 24-72h. Entregas en Macropaza 12:00 pm. Sin anticipo.
- Tamaños máx: 22 x 22 x 25 cm.

REGLA DE ORO ESTRICTA:
- Si el cliente ya mandó una foto, un archivo, o ya dijo qué material quiere (PLA/PETG), QUEDA PROHIBIDO pedirle de nuevo la foto o el material. 
- Saluda con naturalidad, reconoce lo que te mandó y dile que el equipo lo revisa para cotizar. Sé breve (máximo 3 oraciones). Máximo 2 emojis.
`;

function detectarIntencion(texto) {
  const low = texto.toLowerCase();
  const esPedido = /quiero|cotiz|cuanto|precio|pedido|comprar|encargar|llavero|imprimir|pieza|foto/.test(low);
  return { esPedido };
}

async function generarConGemini(historialChat, mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    return `¡Claro que sí, ${nombre}! Ya tengo tu imagen y material registrados, el taller lo revisa y te cotizamos en un momento. 😊`;
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
      continue; // Si falla un modelo, pasa al siguiente de forma silenciosa
    }
  }
  
  // FALLBACK INTELIGENTE ABSOLUTO (Evita respuestas genéricas de bienvenida)
  return `¡Va que va, ${nombre}! Recibí tu mensaje y la imagen. El equipo del taller lo checa y te mandamos la cotización exacta por aquí. 🚀`;
}

async function enviarWhatsApp(to, texto) {
  try {
    await axios.post(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp', to, type: 'text', text: { body: texto }
    }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
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

    // CAPTURA LIMPIA SIN TEXTOS RAROS QUE CONFUNDAN A LA IA
    if (message.type === 'text') {
      textoUsuario = message.text.body;
    } else if (message.type === 'image') {
      textoUsuario = message.image?.caption ? `Envié una foto con este texto: "${message.image.caption}"` : `Envié una imagen para cotizar impresión.`;
    } else if (message.type === 'document') {
      textoUsuario = `Envié un archivo: ${message.document?.filename || 'documento'}`;
    } else {
      textoUsuario = `[Mensaje multimedia tipo ${message.type}]`;
    }

    if (!DB.chats[from]) {
      DB.chats[from] = { nombre, telefono: from, mensajes: [], ultimo: new Date().toISOString() };
    }

    DB.chats[from].mensajes.push({ de: 'cliente', texto: textoUsuario, hora: new Date().toISOString(), tipo });
    DB.chats[from].ultimo = new Date().toISOString();
    DB.chats[from].nombre = nombre;

    const intent = detectarIntencion(textoUsuario);
    if (intent.esPedido && !DB.pedidos.find(p => p.telefono === from && Date.now() - new Date(p.fecha).getTime() < 3600000)) {
      DB.pedidos.push({ id: Date.now(), nombre, telefono: from, descripcion: textoUsuario, fecha: new Date().toISOString(), estado: 'Nuevo' });
      await notificarOwner(`🛒 NUEVO PEDIDO\nDe: ${nombre} (${from})\nDice: ${textoUsuario}\n\nDashboard: https://soytusecre-lilab.onrender.com/admin?key=${ADMIN_KEY}`);
    }
    saveDB(DB);

    const historialReciente = DB.chats[from].mensajes.slice(-8);
    const respuesta = await generarConGemini(historialReciente, textoUsuario, nombre);

    DB.chats[from].mensajes.push({ de: 'bot', texto: respuesta, hora: new Date().toISOString() });
    saveDB(DB);

    await enviarWhatsApp(from, respuesta);
  } catch (e) { console.error('Error webhook:', e.message); }
});

app.get('/admin', (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).send('<h1>401 - No autorizado</h1>');
  
  DB = loadDB();
  const totalChats = Object.keys(DB.chats).length;
  const totalPedidos = DB.pedidos.length;
  const totalMensajes = Object.values(DB.chats).reduce((acc, c) => acc + c.mensajes.length, 0);

  let chatsHtml = Object.values(DB.chats).sort((a,b) => new Date(b.ultimo) - new Date(a.ultimo)).map(chat => {
    const msgs = chat.mensajes.slice(-10).map(m => `
      <div style="margin:6px 0;padding:8px 12px;border-radius:12px;max-width:80%;${m.de==='cliente'?'background:#f0f0f0;align-self:flex-start':'background:#dcf8c6;align-self:flex-end;margin-left:auto'}">
        <small style="color:#666">${m.de} - ${new Date(m.hora).toLocaleString('es-MX')}</small><br>${m.texto}
      </div>
    `).join('');
    return `
    <div style="border:1px solid #e0e0e0;border-radius:12px;padding:16px;margin:12px 0;background:white">
      <strong>👤 ${chat.nombre}</strong> - ${chat.telefono} <small style="color:#888">${new Date(chat.ultimo).toLocaleString('es-MX')}</small>
      <div style="display:flex;flex-direction:column;margin-top:10px">${msgs}</div>
      <a href="https://wa.me/${chat.telefono}" target="_blank" style="display:inline-block;margin-top:10px;background:#25D366;color:white;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px">Responder en WhatsApp</a>
    </div>
    `;
  }).join('') || '<p style="color:#888">Aún no hay chats.</p>';

  let pedidosHtml = DB.pedidos.slice().reverse().map(p => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${new Date(p.fecha).toLocaleString('es-MX')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee"><strong>${p.nombre}</strong><br><small>${p.telefono}</small></td>
      <td style="padding:8px;border-bottom:1px solid #eee">${p.descripcion}</td>
      <td style="padding:8px;border-bottom:1px solid #eee"><span style="background:#ffeb3b;padding:2px 8px;border-radius:12px;font-size:12px">${p.estado}</span></td>
    </tr>
  `).join('') || '<tr><td colspan=4 style="padding:20px;color:#888;text-align:center">No hay pedidos</td></tr>';

  res.send(`
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lilab Estudio - Panel SoyTuSecre</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f5f5f7;margin:0;padding:0;color:#222}
  header{background:#111;color:white;padding:20px 24px;display:flex;justify-content:space-between;align-items:center}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;padding:20px 24px}
  .stat{background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
  .stat b{font-size:28px;display:block}
  .container{padding:0 24px 40px;max-width:1100px;margin:0 auto}
  table{width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-collapse:collapse}
  th{text-align:left;padding:12px;background:#fafafa;font-size:13px;color:#666}
  .tab{cursor:pointer;padding:10px 18px;border-radius:8px;border:1px solid #ddd;background:white;margin-right:8px}
  .tab.active{background:#111;color:white;border-color:#111}
  h2{margin:24px 0 12px}
</style>
</head>
<body>
<header>
  <div><h1 style="margin:0;font-size:20px">Lilab Estudio 🚀 Panel SoyTuSecre</h1><small style="opacity:0.7">WhatsApp: +52 55 5494 5365</small></div>
  <div><small>by Closerme</small></div>
</header>

<div class="stats">
  <div class="stat"><b>${totalChats}</b><small>Chats</small></div>
  <div class="stat"><b>${totalPedidos}</b><small>Pedidos</small></div>
  <div class="stat"><b>${totalMensajes}</b><small>Mensajes</small></div>
  <div class="stat"><b>✅ Online</b><small>Estado</small></div>
</div>

<div class="container">
  <div style="margin:10px 0">
    <button class="tab active" onclick="show('pedidos')">🛒 Pedidos</button>
    <button class="tab" onclick="show('chats')">💬 Chats</button>
  </div>
  <div id="pedidos">
    <h2>Pedidos y cotizaciones</h2>
    <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Detalle</th><th>Estado</th></tr></thead><tbody>${pedidosHtml}</tbody></table>
  </div>
  <div id="chats" style="display:none">
    <h2>Conversaciones</h2>
    ${chatsHtml}
  </div>
</div>

<script>
function show(id){ document.getElementById('pedidos').style.display=id==='pedidos'?'block':'none'; document.getElementById('chats').style.display=id==='chats'?'block':'none'; document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active')); event.target.classList.add('active'); }
setTimeout(()=>location.reload(),30000);
</script>
</body></html>
  `);
});

app.get('/', (req, res) => res.send('Lilab V3.9 Activo 🚀 - <a href="/admin?key=lilab123">Ver Panel</a>'));
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
