
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Body: ${JSON.stringify(req.body).substring(0,800)}`);
  next();
});

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'soytusecre_verify_123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1426928223838877';
const PORT = process.env.PORT || 10000;

// === CONOCIMIENTO REAL DE LILAB ESTUDIO - SOY TU SECRE BY CLOSERME ===
const LILAB = {
  nombre: "Lilab Estudio",
  horario: "Lun-Vie 9am-6pm",
  horariosNo: ["8pm", "20:00", "20", "21", "22", "sabado", "sábado", "domingo"],
  materiales: {
    PLA: { precio: 5.5, uso: "resistente pero para interior, ideal para prototipos, figuras, decoración", temp: "hasta 60°C" },
    PETG: { precio: 10, uso: "para exteriores, resiste sol, agua y golpes, ideal para piezas funcionales" }
  },
  entrega: "72 horas después de confirmar el archivo y pago",
  puntoEntrega: "Macropaza a las 12:00 pm",
  instagram: "https://www.instagram.com/lilabestudio/",
  pago: "Sin anticipo, pagas al entregar en Macropaza",
  siguienteEspacio: "mañana a las 9am"
};

function esHorarioNoDisponible(text) {
  const t = text.toLowerCase();
  return LILAB.horariosNo.some(h => t.includes(h));
}

function generarRespuesta(text, nombre) {
  const t = text.toLowerCase().trim();

  // Saludo / Cotización inicial
  if (t.match(/hola|buenas|buenos|que tal|saludos|cotiz|impresion|impresión|3d|stl/)) {
    if (t.includes('precio') || t.includes('cuanto') || t.includes('costo') || t.includes('gramo')) {
      // Si pregunta precio directamente
    } else {
      return `¡Hola ${nombre}! 👋 Soy la secre de ${LILAB.nombre}\n\nTrabajamos ${LILAB.horario} en Impresión 3D profesional.\n\nManejamos:\n• PLA: $${LILAB.materiales.PLA.precio}/gr - ${LILAB.materiales.PLA.uso}\n• PETG: $${LILAB.materiales.PETG.precio}/gr - ${LILAB.materiales.PETG.uso}\n\n¿Me mandas tu archivo STL o las medidas de tu pieza? Te cotizo en 10 min y te digo cuántos gramos pesa.`;
    }
  }

  // Horarios no disponibles
  if (esHorarioNoDisponible(t)) {
    return `No tengo espacio en ese horario, te parece si te agendo para ${LILAB.siguienteEspacio} que es el siguiente espacio más próximo? 😊\n\nEstamos ${LILAB.horario}. ¿Te queda bien ${LILAB.siguienteEspacio}?`;
  }

  // Pregunta por horarios
  if (t.match(/horario|abren|cierran|a que hora|cuando abren/)) {
    return `¡Claro! Estamos ${LILAB.horario} en ${LILAB.nombre} 🖨️\n\nEntregamos en ${LILAB.puntoEntrega}. Tiempo de impresión: ${LILAB.entrega}.\n\n¿Te agendo para ${LILAB.siguienteEspacio}? Solo necesito tu nombre.`;
  }

  // Pregunta precios
  if (t.match(/precio|cuanto cuesta|costo|cuánto|gramo|cuanto sale/)) {
    return `Te explico nuestros precios de ${LILAB.nombre}:\n\n• PLA: $${LILAB.materiales.PLA.precio} por gramo - ${LILAB.materiales.PLA.uso}\n• PETG: $${LILAB.materiales.PETG.precio} por gramo - ${LILAB.materiales.PETG.uso}\n\nPara darte precio exacto necesito tu archivo STL. El sistema calcula los gramos automáticamente.\n\n¿Me lo mandas por aquí? Te cotizo en 10 min.\n\nPuedes ver trabajos en: ${LILAB.instagram}`;
  }

  // Pregunta material
  if (t.match(/material|pla|petg|pedg|abs|resistente|exterior|interior|sol|agua/)) {
    return `¡Buena pregunta! En ${LILAB.nombre} manejamos 2 materiales:\n\n🔹 PLA ($${LILAB.materiales.PLA.precio}/gr): ${LILAB.materiales.PLA.uso}\n🔹 PETG ($${LILAB.materiales.PETG.precio}/gr): ${LILAB.materiales.PETG.uso}\n\n¿Tu pieza va para interior o exterior? Así te recomiendo el mejor.`;
  }

  // Entrega / Macropaza
  if (t.match(/entrega|donde entregan|macropaza|macrop|donde queda|punto de entrega|envio|envío/)) {
    return `Entregamos en ${LILAB.puntoEntrega} ⏰\n\nTiempo de impresión: ${LILAB.entrega}.\n\n${LILAB.pago}. Sin anticipo.\n\n¿Te queda bien que te vea ahí a las 12pm cuando esté lista tu pieza?`;
  }

  // Agendar / Cita
  if (t.match(/agendar|cita|espacio|agenda|mañana|10am|9am|reservar|apartar/)) {
    return `¡Listo! Te agendo para ${LILAB.siguienteEspacio} en ${LILAB.nombre} ✅\n\nSolo confirmame:\n1. Tu nombre completo\n2. El archivo STL\n\nTiempo de entrega: ${LILAB.entrega} y nos vemos en ${LILAB.puntoEntrega}. ¿Me confirmas tu nombre?`;
  }

  // Instagram / Trabajos
  if (t.match(/instagram|fotos|trabajos|ejemplos|que han hecho|portafolio/)) {
    return `¡Claro! Aquí puedes ver nuestros trabajos de ${LILAB.nombre}:\n${LILAB.instagram}\n\nImprimimos figuras, prototipos, piezas funcionales, todo en PLA y PETG.\n\n¿Me mandas tu idea por aquí y te digo si se puede hacer?`;
  }

  // Fallback inteligente - soy yo respondiendo
  return `Soy la secre de ${LILAB.nombre} 😊 Estamos ${LILAB.horario}.\n\nTe ayudo con:\n• Cotización (mándame STL)\n• Precios: PLA $${LILAB.materiales.PLA.precio}/gr, PETG $${LILAB.materiales.PETG.precio}/gr\n• Entrega: ${LILAB.puntoEntrega} en 72h\n• Trabajos: ${LILAB.instagram}\n\n¿Qué necesitas imprimir?`;
}

app.get('/', (req, res) => {
  res.send(`SoyTuSecre - ${LILAB.nombre} - Webhook Activo ✅ - Versión 2.0 con info real - ${new Date().toISOString()}`);
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log(`Verificación: mode=${mode} token=${token}`);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO');
    res.status(200).send(challenge);
  } else {
    console.log('Verificación fallida');
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    console.log('POST WEBHOOK RECIBIDO:', JSON.stringify(req.body).substring(0,1200));
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(200);
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const messages = value.messages;
        if (!messages) {
          console.log('Solo status, no mensaje:', JSON.stringify(value).substring(0,500));
          continue;
        }

        for (const msg of messages) {
          const from = msg.from;
          const textRaw = msg.text?.body || '';
          const name = value.contacts?.[0]?.profile?.name || 'cliente';
          console.log(`Mensaje de ${name} (${from}): ${textRaw}`);

          const reply = generarRespuesta(textRaw, name);
          console.log(`Respuesta generada: ${reply.substring(0,150)}`);

          if (WHATSAPP_TOKEN && reply) {
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
              console.error('Error enviando:', sendErr.response?.data || sendErr.message);
            }
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('Error webhook:', e.message, e.stack);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`Servidor soytusecre ${LILAB.nombre} V2 en puerto ${PORT}`));

});

app.listen(PORT, () => console.log(`Servidor soytusecre en puerto ${PORT}`));
