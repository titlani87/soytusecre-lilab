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
    const respuesta = await generarConGemini(historialReciente, textoUsuario, nombre);
    console.log(`Respuesta: ${respuesta}`);

    // Guardar respuesta del bot en historial
    DB.chats[from].mensajes.push({ de: 'bot', texto: respuesta, hora: new Date().toISOString() });
    saveDB(DB);

    await enviarWhatsApp(from, respuesta);
  } catch (e) { console.error('Error webhook:', e.message); }
});

// DASHBOARD PARA EL CLIENTE LILAB
app.get('/admin', (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).send('<h1>401 - Acceso No Autorizado</h1><p>Pon ?key=lilab123 en la URL</p>');
  
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
  }).join('') || '<p style="color:#888">Aún no hay chats registrados.</p>';

  let pedidosHtml = DB.pedidos.slice().reverse().map(p => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${new Date(p.fecha).toLocaleString('es-MX')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee"><strong>${p.nombre}</strong><br><small>${p.telefono}</small></td>
      <td style="padding:8px;border-bottom:1px solid #eee">${p.descripcion}</td>
      <td style="padding:8px;border-bottom:1px solid #eee"><span style="background:#ffeb3b;padding:2px 8px;border-radius:12px;font-size:12px">${p.estado}</span></td>
    </tr>
  `).join('') || '<tr><td colspan=4 style="padding:20px;color:#888;text-align:center">No hay pedidos aún</td></tr>';

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
  <div><h1 style="margin:0;font-size:20px">Lilab Estudio 🚀 Panel SoyTuSecre</h1><small style="opacity:0.7">WhatsApp: +52 55 5494 5365 • Auto-refresh cada 30s</small></div>
  <div><small>by Closerme</small></div>
</header>

<div class="stats">
  <div class="stat"><b>${totalChats}</b><small>Chats totales</small></div>
  <div class="stat"><b>${totalPedidos}</b><small>Pedidos / Cotizaciones</small></div>
  <div class="stat"><b>${totalMensajes}</b><small>Mensajes</small></div>
  <div class="stat"><b>✅ Online</b><small>Bot activo con Gemini</small></div>
</div>

<div class="container">
  <div style="margin:10px 0">
    <button class="tab active" onclick="show('pedidos')">🛒 Pedidos / Cotizaciones</button>
    <button class="tab" onclick="show('chats')">💬 Chats en vivo</button>
  </div>

  <div id="pedidos">
    <h2>Pedidos y cotizaciones detectadas</h2>
    <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Qué quiere</th><th>Estado</th></tr></thead><tbody>${pedidosHtml}</tbody></table>
  </div>

  <div id="chats" style="display:none">
    <h2>Conversaciones recientes</h2>
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

app.get('/', (req, res) => res.send('Lilab V3.8 Activo 🚀 - <a href="/admin?key=lilab123">Ver Panel</a>'));
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
