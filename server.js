
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
const PORT = process.env.PORT || 3000;

// Health check
app.get('/', (req, res) => {
  res.send('SoyTuSecre - Lilab Estudio - Webhook Activo ✅');
});

// Verificación del webhook (Meta te llama aquí)
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

// Mensajes entrantes
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const messages = value.messages;
        if (!messages) continue;

        for (const msg of messages) {
          const from = msg.from; // número del cliente
          const text = msg.text?.body?.toLowerCase() || '';
          const name = value.contacts?.[0]?.profile?.name || 'cliente';

          console.log(`Mensaje de ${name} (${from}): ${text}`);

          let reply = '';

          if (text.includes('hola') || text.includes('buenas') || text.includes('cotiz')) {
            reply = `¡Hola ${name}! Soy la secre de Lilab Estudio 👋\n\nTrabajamos Lun-Vie 9am-6pm en Impresión 3D. ¿Qué pieza necesitas imprimir? Si me mandas el archivo STL te cotizo en 10 min.`;
          } else if (text.includes('horario') || text.includes('abren') || text.includes('hora')) {
            if (text.includes('8pm') || text.includes('20') || text.includes('sabado') || text.includes('domingo')) {
              reply = `No tengo espacio en ese horario, te parece si te agendo para mañana a las 9am que es el siguiente espacio más próximo? Estamos Lun-Vie 9am-6pm 🖨️`;
            } else {
              reply = `Claro, tenemos espacio. Trabajamos Lun-Vie 9am-6pm. ¿Te agendo? Solo necesito tu nombre.`;
            }
          } else if (text.includes('precio') || text.includes('cuanto') || text.includes('costo')) {
            reply = `Para cotizarte necesito el archivo STL o las medidas de tu pieza. ¿Me lo mandas por aquí? Te cotizo en 10 min.`;
          } else if (text.includes('agendar') || text.includes('cita') || text.includes('espacio') || text.includes('10am') || text.includes('mañana')) {
            reply = `Listo! Te agendo. ¿Me confirmas tu nombre completo para la cita de mañana a las 10am en Lilab Estudio?`;
          } else {
            reply = `Soy la secre de Lilab Estudio. Estamos Lun-Vie 9am-6pm en Impresión 3D. ¿En qué te ayudo?`;
          }

          // Enviar respuesta vía Cloud API
          if (WHATSAPP_TOKEN && reply) {
            await axios.post(
              `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
              {
                messaging_product: 'whatsapp',
                to: from,
                type: 'text',
                text: { body: reply }
              },
              {
                headers: {
                  'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            console.log(`Respuesta enviada a ${from}: ${reply}`);
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('Error webhook:', e.response?.data || e.message);
    res.sendStatus(200); // Siempre 200 para que Meta no reintente infinito
  }
});

app.listen(PORT, () => console.log(`Servidor soytusecre en puerto ${PORT}`));
