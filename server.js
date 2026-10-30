
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'soytusecre_verify_123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1426928223838877';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

// Prompt de Lilab Estudio - SOY TU SECRE
const SYSTEM_PROMPT = `
Eres la secre de Lilab Estudio, estudio de impresión 3D en CDMX. Hablas como humana, amigable, cercana, no como robot. Usas emojis moderados.

Datos reales:
- Nombre: Lilab Estudio
- Horario: Lun-Vie 9am-6pm
- NO tienes espacio: 8pm, 20:00, 21:00, 22:00, sábados, domingos. Si piden esos horarios, di: "Ay [nombre], en ese horario no tengo espacio 🥲 ¿te parece si te agendo para mañana a las 9am que es el siguiente espacio más próximo?"
- Materiales:
  * PLA: $5.5 el gramo, resistente pero para interior, ideal para prototipos, figuras, decoración, aguanta hasta 60°C
  * PETG: $10 el gramo, para exteriores, resiste sol, agua y golpes, ideal para piezas funcionales
- Tiempo entrega: 72 horas después de confirmar archivo
- Punto entrega: Macropaza a las 12:00 pm
- Pago: Sin anticipo, pagas cuando te entrego en Macropaza
- Instagram: https://www.instagram.com/lilabestudio/
- Si preguntan precio: pide archivo STL para calcular gramos exactos, no inventes precio sin archivo
- Si preguntan material: pregunta si es para interior o exterior para recomendar
- Si quieren agendar: pide nombre completo y archivo STL
- Si no sabes algo: di "Déjame consultarlo con Lilab y te escribo en 10 min" - no inventes

Estilo: humano, corto, 2-3 frases máximo por mensaje, pregunta de vuelta, usa el nombre de la persona.

Ejemplos de tu tono:
Usuario: Hola cotización impresión 3D
Tú: ¡Hola Luis! 👋 Soy la secre de Lilab Estudio. ¿Qué pieza necesitas? Si me mandas el STL te cotizo en 10 min.

Usuario: Cuanto cuesta en petg?
Tú: Hola por ahí! El PETG está en $10 el gramo, es para exteriores porque aguanta sol y agua. ¿Tu pieza va para exterior? Si me mandas el archivo te digo cuántos gramos pesa.

Usuario: Entregan en sábado?
Tú: Ay, en sábado no tengo espacio 🥲 ¿te parece si te agendo para mañana a las 9am que es el siguiente espacio más próximo? Estamos Lun-Vie 9am-6pm.
`;

async function generarConGemini(mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    console.log('No hay GEMINI_API_KEY, usando fallback');
    return `Hola ${nombre}! Soy la secre de Lilab Estudio 😊 Estamos Lun-Vie 9am-6pm. PLA $5.5/gr, PETG $10/gr, entregamos en Macropaza a las 12pm en 72h sin anticipo. ¿Qué pieza quieres imprimir?`;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${SYSTEM_PROMPT}\n\nUsuario ${nombre} dice: ${mensajeUsuario}\n\nResponde como la secre de Lilab Estudio, corto, humano, con el nombre:` }]
        }
      ],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 300
      }
    };

    const resp = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    const texto = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (texto) {
      console.log(`Gemini respondió: ${texto.substring(0,150)}`);
      return texto.trim();
    } else {
      console.log('Gemini no devolvió texto:', JSON.stringify(resp.data).substring(0,500));
      return `Hola ${nombre}! Soy la secre de Lilab Estudio, ¿en qué te ayudo?`;
    }
  } catch (e) {
    console.error('Error Gemini:', JSON.stringify(e.response?.data || e.message).substring(0,800));
    // Fallback si Gemini falla
    return `Hola ${nombre}! Soy la secre de Lilab Estudio 😊 ¿Me mandas tu archivo STL para cotizarte? Estamos Lun-Vie 9am-6pm.`;
  }
}

app.get('/', (req, res) => {
  res.send(`SoyTuSecre - Lilab Estudio V3 Gemini ✅ - ${new Date().toISOString()}`);
});

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
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return res.sendStatus(200);

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const messages = value.messages;
        if (!messages) continue;

        for (const msg of messages) {
          const from = msg.from;
          const textRaw = msg.text?.body || '';
          const name = value.contacts?.[0]?.profile?.name || 'por ahí';
          console.log(`Mensaje de ${name} (${from}): ${textRaw}`);

          const reply = await generarConGemini(textRaw, name);
          console.log(`Respuesta: ${reply.substring(0,200)}`);

          if (WHATSAPP_TOKEN && reply) {
            try {
              await axios.post(
                `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
                { messaging_product: 'whatsapp', to: from, type: 'text', text: { body: reply } },
                { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
              );
              console.log(`Enviado OK a ${from}`);
            } catch (e) {
              console.error('Error envio WA:', e.response?.data || e.message);
            }
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('Error webhook:', e.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`Lilab V3 Gemini en puerto ${PORT}`));
