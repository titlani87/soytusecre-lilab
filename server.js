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

const SYSTEM_PROMPT = `Eres la secretaria de Lilab Estudio, estudio de impresion 3D en CDMX. Eres humana, mexicana, casual, calida.

DATOS REALES DE LILAB:
- PLA $5.5/gr (interior, bonito, muchos colores)
- PETG $10/gr (exterior, aguanta sol y agua, mas resistente)
- Entrega: 72h maximo, sin anticipo
- Horario: Lun-Vie 9am-6pm
- Entregas: Macropaza a las 12pm
- Instagram: https://www.instagram.com/lilabestudio/
- Para cotizar necesitas archivo STL, 3MF u OBJ. Si no tienen, ayudales a conseguirlo.

REGLAS DE ORO:
1. NUNCA dejes una frase incompleta. Termina siempre con punto o pregunta completa.
2. Responde en 2 a 4 oraciones cortas, completas.
3. Si preguntan precio de llavero con nombre: entre 30-80 pesos segun tamano, pides medidas.
4. Tono humano: "Hola! Soy la secre de Lilab 😊" etc. Max 2 emojis.
5. Si no sabes algo, di que consultas con el taller.
`;

async function generarConGemini(mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    return `Hola ${nombre}! Soy la secre de Lilab Estudio 😊 PLA $5.5/gr, PETG $10/gr. Mandame tu STL y te cotizo en 10 min.`;
  }

  // Orden: primero los que SI funcionan segun tus logs
  const modelos = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-3.8-flash'
  ];

  for (const modelo of modelos) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Cliente ${nombre} dice: "${mensajeUsuario}". Responde como la secre de Lilab, completo y humano:` }] }],
        generationConfig: { 
          temperature: 0.8, 
          maxOutputTokens: 1024,
          topP: 0.9
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      };

      console.log(`Probando: ${modelo} para "${mensajeUsuario.substring(0,40)}"`);
      const resp = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
      });

      const cand = resp.data?.candidates?.[0];
      if (!cand) {
        console.error(`Sin candidates en ${modelo}`, JSON.stringify(resp.data).substring(0,500));
        continue;
      }

      const parts = cand.content?.parts || [];
      let texto = parts.map(p => p.text || '').join('').trim();
      const finishReason = cand.finishReason;
      
      console.log(`FinishReason ${modelo}: ${finishReason} | Length: ${texto.length} | Text: ${texto.substring(0,200)}`);

      // Si se corto por MAX_TOKENS o SAFETY, intentar reparar
      if (finishReason === 'MAX_TOKENS') {
        console.log('Se corto por MAX_TOKENS, aumentando limite no necesario pero texto valido');
      }
      if (finishReason === 'SAFETY') {
        console.log('Bloqueado por SAFETY, probando siguiente modelo');
        continue;
      }

      if (texto && texto.length > 10) {
        // Si termina sin puntuacion, agregarle punto para no dejar incompleto
        if (!/[.!?]$/.test(texto.trim())) {
          texto = texto.trim() + ' 😊';
        }
        console.log(`Gemini ${modelo} FINAL OK: ${texto}`);
        return texto;
      }

    } catch (e) {
      const errData = e.response?.data;
      const errMsg = errData?.error?.message || e.message;
      console.error(`Fallo ${modelo}: ${errMsg?.substring(0,400)}`);
      if (errData) console.error(`Detalle: ${JSON.stringify(errData).substring(0,600)}`);
      
      // Si es error de API key o cuota, no probar mas
      if (errMsg && (errMsg.includes('API key') || errMsg.includes('quota') || errMsg.includes('PERMISSION_DENIED'))) {
        break;
      }
      continue;
    }
  }

  console.log('TODOS fallaron, fallback humano completo');
  const msg = mensajeUsuario.toLowerCase();
  if (msg.includes('clara') || msg.includes('nombre') || msg.includes('llavero')) {
    return `¡Hola ${nombre}! Para el llavero con el nombre "Clara" te sale entre $50 y $80 pesos según el tamaño 😊 ¿De qué tamaño lo quieres? Como de 5cm o más grande? Si me mandas una idea de la letra, te cotizo exacto en 10 min.`;
  }
  if (msg.includes('stl') || msg.includes('archivo')) {
    return `El STL es el archivito 3D de tu pieza, como el plano para imprimir 😊 Si no lo tienes no te preocupes, me dices qué quieres imprimir y te ayudo a conseguirlo. ¿Qué pieza es?`;
  }
  return `¡Hola ${nombre}! Soy la secre de Lilab Estudio 😊 Mándame tu archivo 3D y te cotizo en 10 min. Hacemos PLA $5.5/gr y PETG $10/gr para exterior. Estamos Lun-Vie 9am-6pm con entrega en Macropaza a las 12pm.`;
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
    console.log(`Enviado OK a ${to} (${texto.length} chars)`);
  } catch (e) {
    console.error('Error envio WA:', JSON.stringify(e.response?.data || e.message).substring(0,800));
  }
}

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

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message || message.type !== 'text') return;
    const from = message.from;
    const text = message.text.body;
    const nombre = change.value.contacts?.[0]?.profile?.name || 'Luis';
    console.log(`\n--- Nuevo mensaje de ${nombre} (${from}): ${text} ---`);
    const respuesta = await generarConGemini(text, nombre);
    console.log(`Respuesta final a enviar: ${respuesta}`);
    await enviarWhatsApp(from, respuesta);
  } catch (e) {
    console.error('Error webhook:', e.message);
  }
});

app.get('/', (req, res) => res.send('Lilab V3.4 Gemini FIX corte 🚀'));

app.listen(PORT, () => console.log(`Lilab V3.4 en puerto ${PORT}`));
