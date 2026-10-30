
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'soytusecre_verify_123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1426928223838877';
const PORT = process.env.PORT || 10000;

const LILAB = {
  nombre: "Lilab Estudio",
  horario: "Lun-Vie 9am-6pm",
  horariosNo: ["8pm", "20:00", "20", "21", "22", "sabado", "sábado", "domingo"],
  PLA: { precio: 5.5, desc: "resistente pero para interior, ideal para prototipos, figuras y decoración" },
  PETG: { precio: 10, desc: "para exteriores, aguanta sol, agua y golpes, ideal para piezas funcionales" },
  entrega: "72 horas",
  punto: "Macropaza a las 12:00 pm",
  insta: "https://www.instagram.com/lilabestudio/",
  pago: "Sin anticipo, pagas cuando te entrego en Macropaza",
  siguiente: "mañana a las 9am"
};

function generarRespuesta(text, nombre) {
  const t = text.toLowerCase();
  const n = nombre || 'por ahí';

  // Horario no disponible - 8pm, sabado, domingo
  if (LILAB.horariosNo.some(h => t.includes(h))) {
    return `Ay ${n}, en ese horario no tengo espacio 🥲 ¿Te parece si te agendo para ${LILAB.siguiente} que es el siguiente espacio más próximo? Estamos ${LILAB.horario} y con gusto te atiendo a esa hora. ¿Te queda bien?`;
  }

  // Precios
  if (t.match(/precio|cuanto|cuánto|costo|cuesta|gramo|pesos/)) {
    if (t.includes('petg') || t.includes('pedg')) {
      return `Hola ${n}! El PETG está en $${LILAB.PETG.precio} el gramo. Es ${LILAB.PETG.desc}. ¿Tu pieza va para exterior? Si me mandas el archivo STL te digo exactamente cuántos gramos pesa y te cotizo en 10 min 😊`;
    }
    if (t.includes('pla')) {
      return `El PLA está en $${LILAB.PLA.precio} el gramo ${n}, es ${LILAB.PLA.desc}. ¿Qué pieza quieres imprimir? Mándame el STL y te digo el peso exacto.`;
    }
    return `Hola ${n}! Te cuento: PLA está en $${LILAB.PLA.precio}/gr y PETG en $${LILAB.PETG.precio}/gr. El PLA es ${LILAB.PLA.desc} y el PETG es ${LILAB.PETG.desc}. Para darte precio exacto necesito tu archivo STL porque ahí calculo los gramos. ¿Me lo mandas? Te cotizo en 10 min ✨`;
  }

  // Material
  if (t.match(/material|pla|petg|pedg|abs|cual me recomiendas|interior|exterior|sol|agua|resiste/)) {
    return `Mira ${n}, te explico rápido: tenemos PLA ($${LILAB.PLA.precio}/gr) que es resistente pero más para interior, y PETG ($${LILAB.PETG.precio}/gr) que es para exterior porque aguanta sol y agua. ¿Tu pieza va a estar adentro o afuera? Así te digo cuál te conviene más.`;
  }

  // Entrega / Macropaza
  if (t.match(/entrega|donde entreg|macropaza|macrop|donde queda|punto|envio|cuando queda|cuanto tarda/)) {
    return `Entregamos en ${LILAB.punto} ${n} ⏰ El tiempo es de ${LILAB.entrega} después de que me confirmes el archivo. ${LILAB.pago}, sin anticipo ni nada raro. ¿Te queda bien que nos veamos ahí a las 12?`;
  }

  // Horario
  if (t.match(/horario|abren|a que hora|cuando abren|cierran/)) {
    return `Estamos ${LILAB.horario} ${n} 🖨️ Entregamos en ${LILAB.punto} y tardamos ${LILAB.entrega} en imprimir. ¿Quieres que te agende para ${LILAB.siguiente}? Solo necesito tu nombre.`;
  }

  // Agendar
  if (t.match(/agendar|cita|espacio|agenda|reservar|apartar|quiero imprimir|me interesa/)) {
    return `Va, te agendo para ${LILAB.siguiente} ✅ Solo dime tu nombre completo y mándame el archivo STL. En ${LILAB.entrega} la tienes lista y nos vemos en ${LILAB.punto}. ¿Cómo te agendo?`;
  }

  // Instagram
  if (t.match(/instagram|fotos|trabajos|ejemplos|portafolio|que han hecho|ver/)) {
    return `Sii, mira nuestros trabajos aquí ${n}: ${LILAB.insta} Ahí vas a ver de todo lo que hemos impreso. ¿Me mandas tu idea y te digo si se puede hacer?`;
  }

  // Saludo inicial - MI TONO, NO ROBOT
  if (t.match(/hola|buenas|buenos|saludos|que tal|ola|hey/)) {
    const saludos = [
      `¡Hola ${n}! 👋 Soy la secre de Lilab Estudio. Trabajamos ${LILAB.horario} haciendo impresión 3D. ¿Qué pieza necesitas? Si me mandas el STL te cotizo en 10 min.`,
      `¡Hola ${n}! Qué bueno que escribes 😊 Soy de Lilab Estudio, hacemos impresión 3D de lunes a viernes de 9 a 6. ¿En qué te ayudo?`,
      `Hola ${n}! Soy la secre de Lilab Estudio 🖨️ Estamos ${LILAB.horario}. ¿Me cuentas qué quieres imprimir?`
    ];
    return saludos[Math.floor(Math.random() * saludos.length)];
  }

  // Fallback - yo respondiendo, no robot
  return `Hola ${n}! Soy la secre de Lilab Estudio 😊 Estamos ${LILAB.horario}. PLA está en $${LILAB.PLA.precio}/gr y PETG en $${LILAB.PETG.precio}/gr, entregamos en ${LILAB.punto} en ${LILAB.entrega} y sin anticipo. ¿Qué pieza quieres imprimir? Si me mandas el STL te cotizo en 10 min.`;
}

app.get('/', (req, res) => {
  res.send(`SoyTuSecre - Lilab Estudio V2.1 Humana ✅ - ${new Date().toISOString()}`);
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

          const reply = generarRespuesta(textRaw, name);

          if (WHATSAPP_TOKEN && reply) {
            try {
              await axios.post(
                `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
                { messaging_product: 'whatsapp', to: from, type: 'text', text: { body: reply } },
                { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
              );
              console.log(`Enviado OK a ${from}`);
            } catch (e) {
              console.error('Error envio:', e.response?.data || e.message);
            }
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('Error:', e.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`Lilab V2.1 Humana en puerto ${PORT}`));
