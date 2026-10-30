
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// LOG DE TODO LO QUE LLEGA
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Body: ${JSON.stringify(req.body).substring(0,500)}`);
  next();
});

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'soytusecre_verify_123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1426928223838877';
const PORT = process.env.PORT || 10000;

// Health check
app.get('/', (req, res) => {
  res.send('SoyTuSecre - Lilab Estudio - Webhook Activo ✅ - ' + new Date().toISOString());
});

// Verificación del webhook (Meta te llama aquí)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`Verificación: mode=${mode} token=${token} challenge=${challenge}`);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO');
    res.status(200).send(challenge);
  } else {
    console.log('Verificación fallida');
    res.sendStatus(403);
  }
});

// Mensajes entrantes
app.post('/webhook', async (req, res) => {
  try {
    console.log('POST WEBHOOK RECIBIDO:', JSON.stringify(req.body).substring(0,1000));
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') {
      console.log('Objeto no es whatsapp_business_account:', body.object);
      return res.sendStatus(200);
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const messages = value.messages;
        if (!messages) {
          console.log('No hay messages en este change, solo status:', JSON.stringify(value).substring(0,500));
          continue;
        }

        for (const msg of messages) {
          const from = msg.from;
          const text = msg.text?.body?.toLowerCase() || '';
          const name = value.contacts?.[0]?.profile?.name || 'cliente';

          console.log(`Mensaje de ${name} (${from}): ${text}`);

          let reply = '';

          if (text.includes('hola') || text.includes('buenas') || text.includes('cotiz')) {
            reply = `¡Hola ${name}! Soy la secre de Lilab Estudio 👋\n\nTrabajamos Lun-Vie 9am-6pm en Impresión 3D. ¿Qué pieza necesitas imprimir? Si me mandas el archivo STL te cotizo en 10 min.`;
          } else if (text.includes('horario') || text.includes('abren') || text.includes('hora') || text.includes('8pm') || text.includes('20') || text.includes('sabado') || text.includes('domingo')) {
            reply = `No tengo espacio en ese horario, te parece si te agendo para mañana a las 9am que es el siguiente espacio más próximo? Estamos Lun-Vie 9am-6pm 🖨️`;
          } else if (text.includes('precio') || text.includes('cuanto') || text.includes('costo')) {
            reply = `Para cotizarte necesito el archivo STL o las medidas de tu pieza. ¿Me lo mandas por aquí? Te cotizo en 10 min.`;
          } else if (text.includes('agendar') || text.includes('cita') || text.includes('espacio') || text.includes('10am') || text.includes('mañana')) {
            reply = `Listo! Te agendo. ¿Me confirmas tu nombre completo para la cita de mañana a las 10am en Lilab Estudio?`;
          } else {
            reply = `Soy la secre de Lilab Estudio. Estamos Lun-Vie 9am-6pm en Impresión 3D. ¿En qué te ayudo?`;
          }

          if (WHATSAPP_TOKEN && reply) {
            console.log(`Intentando enviar respuesta a ${from}: ${reply.substring(0,100)}`);
            try {
              const resp = await axios.post(
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
              console.log(`Respuesta enviada OK: ${JSON.stringify(resp.data)}`);
            } catch (sendErr) {
              console.error('Error enviando respuesta:', sendErr.response?.data || sendErr.message);
            }
          } else {
            console.log('No hay WHATSAPP_TOKEN o reply vacío, no se envía');
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('Error webhook:', e.response?.data || e.message, e.stack);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`Servidor soytusecre en puerto ${PORT}`));
