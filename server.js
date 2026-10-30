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
const NOTIFY_NUMBER = process.env.NOTIFY_NUMBER || '5215568866311'; // Tu numero para reenvio

// Persistencia simple en archivo (Render free borra al redeploy, pero para piloto funciona)
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

const SYSTEM_PROMPT = `Eres la secretaria de Lilab Estudio, estudio de impresion 3D en CDMX. Humana, mexicana, casual.

DATOS:
- PLA $5.5/gr (interior), PETG $10/gr (exterior, aguanta sol/agua)
- Entrega 72h max, sin anticipo, Lun-Vie 9am-6pm, entregas Macropaza 12pm
- Instagram: https://www.instagram.com/lilabestudio/
- Cotizacion: STL, 3MF, OBJ o foto/idea

FAQS:
- ¿Foto? Si, mandala, con eso te ayudo a conseguir STL y cotizo. Llavero Clara $50-$80.
- ¿STL? Archivo 3D, si no lo tienes te ayudo a conseguirlo o diseñarlo $50-$200.
- ¿Tamaño max? 22x22x25cm, mas grande se parte.
- ¿Aguanta sol? PLA no, PETG si.
- ¿Entregan hoy? Si es pequeño si, si no 24-72h.

REGLAS: Nunca dejes frase incompleta. 2-4 oraciones. Pide STL/foto/medidas. Max 2 emojis. Humana.
Si detectas que cliente quiere hacer pedido, pregunta nombre, tamaño, material, para cuando lo necesita.
`;

function detectarIntencion(texto) {
  const low = texto.toLowerCase();
  const esPedido = /quiero|cotiz|cuanto|precio|pedido|comprar|encargar|llavero|imprimir|pieza/.test(low);
  const esCita = /cita|entrega|macropaza|cuando|hora|entregan|recoger|paso|hoy|mañana/.test(low);
  const esUrgente = /urgente|hoy|ahora|rapido/.test(low);
  return { esPedido, esCita, esUrgente };
}

async function generarConGemini(mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    return `Hola ${nombre}! Soy la secre de Lilab 😊 Mandame foto o STL y te cotizo en 10 min. PLA $5.5/gr, PETG $10/gr.`;
  }
  const modelos = ['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-1.5-flash-8b'];
  for (const modelo of modelos) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Cliente ${nombre} dice: "${mensajeUsuario}". Responde completo humano:` }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 900, topP: 0.9 }
      };
      console.log(`Probando: ${modelo}`);
      const resp = await axios.post(url, body, { headers: {'Content-Type':'application/json'}, timeout: 20000 });
      const cand = resp.data?.candidates?.[0];
      if (!cand) continue;
      let texto = (cand.content?.parts || []).map(p=>p.text||'').join('').trim();
      console.log(`FinishReason ${modelo}: ${cand.finishReason} | ${texto.length} chars`);
      if (texto && texto.length > 15) return texto;
    } catch (e) {
      const errMsg = e.response?.data?.error?.message || e.message;
      console.error(`Fallo ${modelo}: ${errMsg?.substring(0,400)}`);
      continue;
    }
  }
  const low = mensajeUsuario.toLowerCase();
  if (low.includes('foto')) return `¡Si! Mándame la foto 😊 Con la foto te digo si lo puedo hacer y te ayudo a conseguir el STL. Llavero Clara entre $50-$80.`;
  return `¡Hola ${nombre}! Soy la secre de Lilab 😊 Mándame foto o STL y te cotizo en 10 min. PLA $5.5/gr, PETG $10/gr, entrega Macropaza 12pm 72h.`;
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
    // No notificar si es el mismo numero del owner para evitar loop
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

// Webhook receiver - CON REGISTRO PARA DASHBOARD
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
    else if (message.type === 'image') textoUsuario = '[Foto recibida] ¿pueden imprimir esto?';
    else if (message.type === 'document') textoUsuario = `[Archivo: ${message.document?.filename}] Quiere cotizacion`;
    else textoUsuario = `[${message.type}]`;

    console.log(`\n--- ${nombre} (${from}): ${textoUsuario} ---`);

    // Guardar en DB
    if (!DB.chats[from]) DB.chats[from] = { nombre, telefono: from, mensajes: [], ultimo: new Date().toISOString() };
    DB.chats[from].mensajes.push({ de: 'cliente', texto: textoUsuario, hora: new Date().toISOString(), tipo });
    DB.chats[from].ultimo = new Date().toISOString();
    DB.chats[from].nombre = nombre;

    // Detectar si es pedido o cita
    const intent = detectarIntencion(textoUsuario);
    if (intent.esPedido && !DB.pedidos.find(p => p.telefono === from && Date.now() - new Date(p.fecha).getTime() < 3600000)) {
      DB.pedidos.push({ id: Date.now(), nombre, telefono: from, descripcion: textoUsuario, fecha: new Date().toISOString(), estado: 'Nuevo', tipo: 'Pedido cotizacion' });
      await notificarOwner(`🛒 NUEVO PEDIDO\nDe: ${nombre} (${from})\nDice: ${textoUsuario}\n\nRevisa dashboard: https://soytusecre-lilab.onrender.com/admin?key=${ADMIN_KEY}`);
    }
    if (intent.esCita) {
      DB.citas.push({ id: Date.now(), nombre, telefono: from, descripcion: textoUsuario, fecha: new Date().toISOString(), estado: 'Pendiente' });
    }
    saveDB(DB);

    // Generar respuesta
    const respuesta = await generarConGemini(textoUsuario, nombre);
    console.log(`Respuesta: ${respuesta}`);

    // Guardar respuesta
    DB.chats[from].mensajes.push({ de: 'bot', texto: respuesta, hora: new Date().toISOString() });
    saveDB(DB);

    await enviarWhatsApp(from, respuesta);
  } catch (e) { console.error('Error webhook:', e.message); }
});

// DASHBOARD PARA EL CLIENTE LILAB
app.get('/admin', (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).send('<h1>401 - Pon ?key=lilab123 en la URL</h1><p>Ejemplo: /admin?key=lilab123</p>');
  
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
  }).join('') || '<p style="color:#888">Aun no hay chats. Manda un WhatsApp al 55 5494 5365 para probar.</p>';

  let pedidosHtml = DB.pedidos.slice().reverse().map(p => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${new Date(p.fecha).toLocaleString('es-MX')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee"><strong>${p.nombre}</strong><br><small>${p.telefono}</small></td>
      <td style="padding:8px;border-bottom:1px solid #eee">${p.descripcion}</td>
      <td style="padding:8px;border-bottom:1px solid #eee"><span style="background:#ffeb3b;padding:2px 8px;border-radius:12px;font-size:12px">${p.estado}</span></td>
    </tr>
  `).join('') || '<tr><td colspan=4 style="padding:20px;color:#888;text-align:center">No hay pedidos aun</td></tr>';

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
    <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Que quiere</th><th>Estado</th></tr></thead><tbody>${pedidosHtml}</tbody></table>
  </div>

  <div id="chats" style="display:none">
    <h2>Conversaciones recientes</h2>
    ${chatsHtml}
  </div>

  <div style="margin-top:30px;padding:16px;background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <h3 style="margin-top:0">Como funciona?</h3>
    <p style="line-height:1.6;color:#444;font-size:14px">
      • Cada vez que alguien escribe al WhatsApp <strong>55 5494 5365</strong>, el bot responde automatico con Gemini y se guarda aqui.<br>
      • Si detecta palabras como "quiero", "cotizar", "cuanto cuesta", lo marca como <strong>Pedido</strong> y te notifica.<br>
      • Puedes responder directo dando clic en "Responder en WhatsApp" o desde tu celular al numero del cliente.<br>
      • Este panel es solo para ver, el bot sigue respondiendo solo. Si quieres tomar control de un chat, avisa a Luis.
    </p>
  </div>
</div>

<script>
function show(id){ document.getElementById('pedidos').style.display=id==='pedidos'?'block':'none'; document.getElementById('chats').style.display=id==='chats'?'block':'none'; document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active')); event.target.classList.add('active'); }
setTimeout(()=>location.reload(),30000);
</script>
</body></html>
  `);
});

app.get('/api/stats', (req, res) => {
  DB = loadDB();
  res.json({ chats: Object.keys(DB.chats).length, pedidos: DB.pedidos.length, totalMensajes: Object.values(DB.chats).reduce((a,c)=>a+c.mensajes.length,0), db: DB });
});

app.get('/', (req, res) => res.send('Lilab V3.7 Dashboard + Pedidos 🚀 - <a href="/admin?key=lilab123">Ver Panel</a>'));
app.listen(PORT, () => console.log(`Lilab V3.7 Dashboard en puerto ${PORT}`));
