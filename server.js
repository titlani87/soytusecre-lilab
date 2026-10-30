const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'soytusecre_verify_123';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1426928223838877';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Eres la secretaria de Lilab Estudio, estudio de impresion 3D en CDMX. Humana, mexicana, casual.

DATOS:
- PLA $5.5/gr (interior), PETG $10/gr (exterior, aguanta sol y agua)
- Entrega 72h, sin anticipo, Lun-Vie 9am-6pm, entregas Macropaza 12pm
- Instagram: https://www.instagram.com/lilabestudio/
- Para cotizar necesitas STL, 3MF u OBJ

REGLAS: NUNCA dejes frase incompleta. Responde 2-4 oraciones completas. Si es llavero con nombre como Clara: $50-$80 segun tamano. Max 1-2 emojis. Humana, no robot.
`;

async function generarConGemini(mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    return `Hola ${nombre}! Soy la secre de Lilab 😊 PLA $5.5/gr, PETG $10/gr, entrega Macropaza 12pm. Mandame tu STL.`;
  }

  // Modelos que Google confirma que existen AHORA (Oct 2026)
  // 3.8-flash es el que Google mismo te recomienda en el error
  const modelos = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-flash'
  ];

  for (const modelo of modelos) {
    try {
      // v1beta ES necesario para systemInstruction segun tu error
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Cliente ${nombre} dice: "${mensajeUsuario}". Responde completo, humano, 2-3 oraciones:` }] }],
        generationConfig: { 
          temperature: 0.85, 
          maxOutputTokens: 800,
          topP: 0.9
        }
      };

      console.log(`Probando: ${modelo}`);
      const resp = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
      });

      const cand = resp.data?.candidates?.[0];
      if (!cand) continue;

      const texto = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
      console.log(`FinishReason ${modelo}: ${cand.finishReason} | ${texto.length} chars | ${texto.substring(0,180)}`);

      if (texto && texto.length > 15) {
        return texto;
      }

    } catch (e) {
      const errMsg = e.response?.data?.error?.message || e.message;
      console.error(`Fallo ${modelo}: ${errMsg?.substring(0,500)}`);
      if (errMsg && (errMsg.includes('API key') || errMsg.includes('quota') || errMsg.includes('PERMISSION_DENIED'))) break;
      continue;
    }
  }

  console.log('Fallback humano completo');
  const low = mensajeUsuario.toLowerCase();
  if (low.includes('clara') || low.includes('nombre') || low.includes('llavero')) {
    return `¡Hola ${nombre}! El llavero con el nombre "Clara" te sale entre $50 y $80 pesos según el tamaño que lo quieras 😊 ¿De qué tamaño lo tienes en mente? Como de 5cm? Si me mandas foto de la tipografía que te gusta, te cotizo exacto en 10 min.`;
  }
  return `¡Hola ${nombre}! Soy la secre de Lilab Estudio 😊 Mándame tu archivo 3D y te cotizo en 10 min. Hacemos PLA $5.5/gr y PETG $10/gr para exterior. Estamos Lun-Vie 9am-6pm.`;
}

async function enviarWhatsApp(to, texto) {
  try {
    await axios.post(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp',
      to, type: 'text', text: { body: texto }
    }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
    console.log(`Enviado OK a ${to} (${texto.length} chars)`);
  } catch (e) {
    console.error('Error WA:', JSON.stringify(e.response?.data || e.message).substring(0,800));
  }
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO');
    res.status(200).send(challenge);
  } else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') return;
    const from = message.from;
    const text = message.text.body;
    const nombre = req.body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || 'Luis';
    console.log(`\n--- Mensaje de ${nombre} (${from}): ${text} ---`);
    const respuesta = await generarConGemini(text, nombre);
    console.log(`Respuesta final: ${respuesta}`);
    await enviarWhatsApp(from, respuesta);
  } catch (e) { console.error('Error webhook:', e.message); }
});

app.get('/', (req, res) => res.send('Lilab V3.5 FIX v1beta 🚀'));
app.listen(PORT, () => console.log(`Lilab V3.5 en puerto ${PORT}`));
