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

const SYSTEM_PROMPT = `Eres la secretaria humana de Lilab Estudio, estudio de impresion 3D en CDMX.

DATOS REALES:
- Materiales: PLA $5.5/gr (interior, colores bonitos), PETG $10/gr (exterior, aguanta sol y agua)
- Entrega: 72h maximo, sin anticipo, pago contra entrega
- Horario: Lun-Vie 9am-6pm
- Entregas: Macropaza a las 12pm
- Instagram: https://www.instagram.com/lilabestudio/
- Cotizacion: necesitas archivo STL o 3MF

TONO: Humana, corta, casual, mexicana, 1-2 emojis max. No suenes robot. Responde en 2-3 oraciones completas, nunca dejes frase a medias. Si cotizas, da precio.
Si preguntan algo fuera de impresion 3D, di que solo ves temas de Lilab pero con amabilidad.

Ejemplos:
- "hola" -> "Hola! Soy la secre de Lilab Estudio 😊 ¿Que quieres imprimir?"
- "cuanto cuesta?" -> "PLA $5.5/gr para interior y PETG $10/gr para exterior que aguanta sol y agua. Mandame tu STL y te cotizo en 10 min"
- "que es stl?" -> "Es el archivo 3D de tu pieza, como un .obj o .3mf. Si no lo tienes te ayudo a conseguirlo 😊"
`;

async function generarConGemini(mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    console.log('No GEMINI_API_KEY, fallback humano');
    return `Hola ${nombre}! Soy la secre de Lilab Estudio 😊 PLA $5.5/gr, PETG $10/gr, entrega en Macropaza 12pm en 72h. Mandame tu STL y te cotizo.`;
  }

  // Modelos en orden de preferencia - Google dijo usar 3.8-flash
  const modelos = [
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest'
  ];

  for (const modelo of modelos) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      
      const body = {
        contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\nCliente ${nombre} dice: ${mensajeUsuario}\nResponde corto y humano:` }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 500, topP: 0.9, topK: 40 }
      };

      console.log(`Probando Gemini modelo: ${modelo}`);
      const resp = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 12000
      });

      const cand = resp.data?.candidates?.[0];
      const parts = cand?.content?.parts || [];
      const texto = parts.map(p => p.text || '').join('');
      const finishReason = cand?.finishReason;
      console.log(`FinishReason: ${finishReason}`);
      if (texto) {
        console.log(`Gemini ${modelo} OK (${texto.length} chars): ${texto.substring(0,150)}`);
        return texto.trim();
      }
    } catch (e) {
      const err = e.response?.data?.error?.message || e.message;
      console.error(`Fallo ${modelo}: ${err?.substring(0,250)}`);
      if (err && (err.includes('API key') || err.includes('quota') || err.includes('PERMISSION_DENIED'))) {
        break; // Error de key, no probar mas
      }
      continue; // Probar siguiente modelo si es NOT_FOUND
    }
  }

  console.log('Todos los modelos fallaron, usando fallback');
  // Fallback inteligente sin repetir lo mismo
  const msg = mensajeUsuario.toLowerCase();
  if (msg.includes('stl') || msg.includes('que es eso') || msg.includes('archivo')) {
    return `El STL es el archivo 3D de tu pieza 😊 como el plano para imprimir. Si no lo tienes, me dices que quieres imprimir y te ayudo a conseguirlo. ¿Que pieza es?`;
  }
  return `Hola ${nombre}! Soy la secre de Lilab Estudio 😊 Mandame tu archivo 3D y te cotizo en 10 min. PLA $5.5/gr, PETG $10/gr para exterior. Estamos Lun-Vie 9am-6pm.`;
}

async function enviarWhatsApp(to, texto) {
  try {
    const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
    await axios.post(url, {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: texto }
    }, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
    });
    console.log(`Enviado OK a ${to}`);
  } catch (e) {
    console.error('Error envio WA:', JSON.stringify(e.response?.data || e.message).substring(0,800));
    throw e;
  }
}

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook receiver
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responder rapido a Meta
  
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    
    if (!message || message.type !== 'text') return;
    
    const from = message.from;
    const text = message.text.body;
    const nombre = change.value.contacts?.[0]?.profile?.name || 'Luis';
    
    console.log(`Mensaje de ${nombre} (${from}): ${text}`);
    
    const respuesta = await generarConGemini(text, nombre);
    console.log(`Respuesta: ${respuesta}`);
    
    await enviarWhatsApp(from, respuesta);
  } catch (e) {
    console.error('Error webhook:', e.message);
  }
});

app.get('/', (req, res) => res.send('Lilab V3.2 Gemini 3.8-flash funcionando 🚀'));

app.listen(PORT, () => console.log(`Lilab V3 Gemini en puerto ${PORT} - ${new Date().toISOString()}`));
