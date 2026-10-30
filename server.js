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
    if (existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch(e) {}
  return { chats: {}, citas: [] };
}
// Función auxiliar por si acaso
function existsSync(filePath) {
  try { return fs.existsSync(filePath); } catch(e) { return false; }
}

function saveDB(db) {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch(e) { console.error('Error saveDB', e.message); }
}
let DB = loadDB();

const SYSTEM_PROMPT = `Eres Lupita, la asesora virtual oficial de COCDEP. Tu tono es amable, profesional, cálido y de confianza (mexicano cercano, usa expresiones como "claro que sí", "con gusto", "va que va").

BASE DE CONOCIMIENTOS OFICIAL DE COCDEP (Usa esto para responder dudas):
1. CRÉDITOS INDIVIDUALES ("Credimpulsados / Emprendedores y Negocios"):
   - Montos: Desde $1,000 hasta $300,000 pesos (Crédito Impulsa desde $5,000).
   - Plazos: De 1 hasta 18 meses.
   - Pagos: Semanales, bisemanales o quincenales (fijos).
   - Requisitos (Acreditado y Aval): Credencial de elector (INE) y comprobante de domicilio (no mayor a 3 meses), garantía y 4 referencias.
2. CRÉDITOS GRUPALES:
   - Integrantes: De al menos 3 personas. ¡Sin aval!, pagos fijos y a tu medida.
   - Garantía líquida: Se entrega después de recibir tu crédito.
   - Requisitos: INE y comprobante de domicilio (no mayor a 3 meses) de cada integrante.

INSTRUCCIONES CRÍTICAS DE FLUJO (EVITA BUCLES):
1. **VERIFICA LA DUDA:** Si el cliente pregunta algo específico (ej. montos, plazos, requisitos), búscalo en la base de conocimientos de arriba y **respóndele claramente primero**.
2. **SI NO TIENES LA RESPUESTA:** Si el cliente pregunta algo muy específico que no está en la base de datos, dile textualmente: "Esa duda en específico se la consulto a un asesor para que te dé los detalles exactos".
3. **PIDE LA CITA DESPUÉS:** Únicamente cuando ya hayas respondido su duda (o indicado que un asesor se la resolverá), pídele con naturalidad su dirección y el horario/día que le queda cómodo para que un asesor lo visite.
4. **MEMORIA DE DATOS:** Si el cliente ya dio su dirección o un dato, NUNCA se lo vuelvas a pedir. 
5. Sé breve (máximo 3 oraciones). Máximo 2 emojis.
`;

function detectarIntencion(texto) {
  const low = texto.toLowerCase();
  const esCita = /credito|crédito|prestamo|préstamo|individual|grupal|asesor|visita|cita|dinero|financiamiento|necesito|interesa|domicilio|horario|dia|días|calle|colonia|numero|número|monto|cuanto|cuánto/.test(low);
  return { esCita };
}

async function generarConGemini(historialChat, mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    return `¡Hola ${nombre}! En COCDEP manejamos créditos individuales (desde $1,000 hasta $300,000 con plazos de 1 a 18 meses) y grupales (desde 3 personas sin aval). ¿En qué más te puedo ayudar o qué día te puede visitar un asesor? 😊`;
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
  
  return `¡Claro que sí, ${nombre}! En los créditos individuales manejamos montos desde $1,000 hasta $300,000 con plazos de hasta 18 meses. Para darte una atención más personalizada, ¿qué día y horario te queda mejor para que te visite un asesor? 🤝`;
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

    const intent = detectarIntencion(textoUsuario);
    if (intent.esCita && !DB.citas.find(p => p.telefono === from && Date.now() - new Date(p.fecha).getTime() < 3600000)) {
      DB.citas.push({ id: Date.now(), nombre, telefono: from, detalle: textoUsuario, fecha: new Date().toISOString(), estado: 'Cita Solicitada' });
      await notificarOwner(`📅 NUEVA SOLICITUD COCDEP\nDe: ${nombre} (${from})\nMensaje: ${textoUsuario}\n\nRevisa el Dashboard: https://soytusecre-lilab.onrender.com/admin?key=${ADMIN_KEY}`);
    }
    saveDB(DB);

    const historialReciente = DB.chats[from].mensajes.slice(-8);
    const respuesta = await generarConGemini(historialReciente, textoUsuario, nombre);

    DB.chats[from].mensajes.push({ de: 'bot', texto: respuesta, hora: new Date().toISOString() });
    saveDB(DB);

    await enviarWhatsApp(from, respuesta);
  } catch (e) { console.error('Error webhook:', e.message); }
});

// DASHBOARD PARA COCDEP
app.get('/admin', (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).send('<h1>401 - No autorizado. Usa ?key=cocdep123 en la URL</h1>');
  
  DB = loadDB();
  const totalChats = Object.keys(DB.chats).length;
  const totalCitas = DB.citas.length;
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
      <a href="https://wa.me/${chat.telefono}" target="_blank" style="display:inline-block;margin-top:10px;background:#25D366;color:white;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px">Contactar por WhatsApp</a>
    </div>
    `;
  }).join('') || '<p style="color:#888">Aún no hay chats.</p>';

  let citasHtml = DB.citas.slice().reverse().map(c => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${new Date(c.fecha).toLocaleString('es-MX')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee"><strong>${c.nombre}</strong><br><small>${c.telefono}</small></td>
      <td style="padding:8px;border-bottom:1px solid #eee">${c.detalle}</td>
      <td style="padding:8px;border-bottom:1px solid #eee"><span style="background:#e0f7fa;color:#00796b;padding:2px 8px;border-radius:12px;font-size:12px">${c.estado}</span></td>
    </tr>
  `).join('') || '<tr><td colspan=4 style="padding:20px;color:#888;text-align:center">No hay citas registradas aún</td></tr>';

  res.send(`
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel COCDEP - SoyTuSecre</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f5f5f7;margin:0;padding:0;color:#222}
  header{background:#0d47a1;color:white;padding:20px 24px;display:flex;justify-content:space-between;align-items:center}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;padding:20px 24px}
  .stat{background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
  .stat b{font-size:28px;display:block;color:#0d47a1}
  .container{padding:0 24px 40px;max-width:1100px;margin:0 auto}
  table{width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-collapse:collapse}
  th{text-align:left;padding:12px;background:#fafafa;font-size:13px;color:#666}
  .tab{cursor:pointer;padding:10px 18px;border-radius:8px;border:1px solid #ddd;background:white;margin-right:8px}
  .tab.active{background:#0d47a1;color:white;border-color:#0d47a1}
  h2{margin:24px 0 12px}
</style>
</head>
<body>
<header>
  <div><h1 style="margin:0;font-size:20px">Panel COCDEP - Citas y Prospectos 🌟</h1><small style="opacity:0.8">Asistente Virtual Activa</small></div>
  <div><small>by SoyTuSecre & Closerme</small></div>
</header>

<div class="stats">
  <div class="stat"><b>${totalChats}</b><small>Prospectos Totales</small></div>
  <div class="stat"><b>${totalCitas}</b><small>Citas / Visitas Agendadas</small></div>
  <div class="stat"><b>${totalMensajes}</b><small>Mensajes Procesados</small></div>
  <div class="stat"><b>✅ Online</b><small>Estado del Bot</small></div>
</div>

<div class="container">
  <div style="margin:10px 0">
    <button class="tab active" onclick="show('citas')">📅 Citas y Visitas de Asesores</button>
    <button class="tab" onclick="show('chats')">💬 Conversaciones en Vivo</button>
  </div>
  <div id="citas">
    <h2>Prospectos que solicitaron información o visita</h2>
    <table><thead><tr><th>Fecha Registro</th><th>Cliente / Teléfono</th><th>Detalles / Dirección / Horario</th><th>Estado</th></tr></thead><tbody>${citasHtml}</tbody></table>
  </div>
  <div id="chats" style="display:none">
    <h2>Historial de Chats Recientes</h2>
    ${chatsHtml}
  </div>
</div>

<script>
function show(id){ document.getElementById('citas').style.display=id==='citas'?'block':'none'; document.getElementById('chats').style.display=id==='chats'?'block':'none'; document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active')); event.target.classList.add('active'); }
setTimeout(()=>location.reload(),30000);
</script>
</body></html>
  `);
});

app.get('/', (req, res) => res.send('SoyTuSecre - Módulo COCDEP Activo 🚀 - <a href="/admin?key=cocdep123">Ver Panel de Citas</a>'));
app.listen(PORT, () => console.log(`Servidor COCDEP en puerto ${PORT}`));
