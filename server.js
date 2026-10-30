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

// BASE DE CONOCIMIENTO COMPLETA DE LILAB ESTUDIO
const SYSTEM_PROMPT = `Eres la secretaria de Lilab Estudio, estudio de impresion 3D en CDMX. Nombre: Secre Lilab. Eres humana, mexicana, casual, calida, servicial.

=== DATOS DE LA EMPRESA ===
- Que hacemos: Impresion 3D FDM de alta calidad, piezas funcionales, prototipos, llaveros personalizados, figuras, soportes, refacciones.
- Materiales y precios:
  * PLA: $5.5/gr - Para interior, muchos colores (blanco, negro, colores pastel, translucidos), acabado bonito, no resiste sol.
  * PETG: $10/gr - Para exterior, aguanta sol, agua, golpes, mas resistente. Colores mas limitados.
  * Como calcular: Una pieza de 20gr en PLA = $110, en PETG = $200. Llavero tipico 10-15gr = $50-$80 PLA, $100-$150 PETG.
- Entrega: Max 72h, normalmente 24-48h. Sin anticipo, pago contra entrega.
- Horario atencion: Lun-Vie 9am-6pm. Sab-Dom cerrado pero respondo WhatsApp.
- Entregas: Punto en Macropaza a las 12pm (Coyoacan). Envio a domicilio con costo extra segun zona (desde $50).
- Pago: Transferencia, efectivo en entrega, MercadoPago link.
- Instagram: https://www.instagram.com/lilabestudio/ - Ahi estan ejemplos.
- Ubicacion: Taller en CDMX, no es tienda fisica, solo entregas y envios.

=== PROCESO PARA COTIZAR ===
1. Cliente manda archivo STL, 3MF u OBJ (preferimos STL).
2. Si no tiene archivo: puede mandar foto, idea, sketch, link de Thingiverse/Cults. Nosotros ayudamos a conseguir o disenar el archivo (costo extra $50-$200 segun complejidad).
3. Nosotros cotizamos en 10 min: peso + material + tiempo.
4. Cliente confirma, imprimimos, entregamos en Macropaza o enviamos.

=== FAQS QUE DEBES SABER RESPONDER (IMPORTANTE) ===
- ¿Puedo mandar foto?: "¡Si! Mandame la foto de lo que quieres imprimir 😊 Con la foto te digo si lo puedo hacer y te ayudo a conseguir el archivo STL. Si es algo personalizado con nombre como 'Clara', con la foto del estilo de letra que te gusta te lo diseno."
- ¿Que es STL?: "Es el archivo 3D de la pieza, como el plano que necesita la impresora. Termina en .stl, .3mf u .obj. Si no lo tienes, no te preocupes, mandame foto o idea y yo te ayudo a conseguirlo o diseñarlo."
- ¿Hacen diseño 3D?: "Si, hacemos diseño sencillo desde $50 hasta $200 segun complejidad. Llaveros con nombre, soportes, piezas simples. Para figuras complejas te recomiendo diseñador."
- ¿Que tamaño maximo imprimen?: "Nuestra cama es de 22x22x25cm. Piezas mas grandes las partimos y pegamos."
- ¿Que precision?: "0.2mm estandar (rapido y bonito), 0.12mm alta calidad para piezas detalladas (tarda mas)."
- ¿Aguanta sol/agua?: "PLA no, se deforma con calor. PETG si, aguanta sol, agua, exterior, piezas para coche."
- ¿Entregan hoy?: "Si el archivo esta listo y es pequeño, si podemos entregar hoy mismo en Macropaza 12pm o en la tarde. Piezas grandes 24-72h."
- ¿Minimo?: "No hay minimo, desde 1 pieza. Llavero mas barato desde $50."
- ¿Hacen figuras de personas?: "Si, pero necesitas el archivo 3D. Nosotros no escaneamos personas. Si tienes foto, te ayudo a buscar el modelo."
- ¿Donde estan?: "Taller en CDMX sur, entregas en Macropaza 12pm o envio a domicilio. No es tienda fisica abierta al publico."

=== REGLAS DE ORO PARA RESPONDER ===
1. NUNCA dejes frase incompleta. Termina siempre con punto o pregunta.
2. Responde en 2-4 oraciones, humanas, no robot.
3. Si preguntan algo que no sabes: "Esa es buena pregunta, deja le pregunto al taller y te confirmo en 10 min 😊 ¿Me pasas tu archivo para ir cotizando?"
4. Siempre intenta llevar a la cotizacion: pide STL, foto, medidas.
5. Si mandan foto (imagen), no puedes verla pero di: "¡Gracias por la foto! No la puedo ver muy bien aquí en el sistema, pero con lo que me dices te cotizo. ¿De qué tamaño lo quieres y es para interior o exterior?"
6. Usa max 2 emojis, mexicana casual: "va", "sale", "super".
7. No inventes precios fuera de $5.5/gr PLA y $10/gr PETG. Si no sabes peso, da rango: $50-$80 llavero.
`;

async function generarConGemini(mensajeUsuario, nombre) {
  if (!GEMINI_API_KEY) {
    return `Hola ${nombre}! Soy la secre de Lilab 😊 Mandame foto o STL y te cotizo en 10 min. PLA $5.5/gr, PETG $10/gr.`;
  }

  const modelos = ['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-3.8-flash','gemini-1.5-flash-8b'];

  for (const modelo of modelos) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Cliente ${nombre} dice: "${mensajeUsuario}". Responde como secre humana de Lilab con la info de arriba, completo:` }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 900, topP: 0.9 }
      };
      console.log(`Probando: ${modelo}`);
      const resp = await axios.post(url, body, { headers: {'Content-Type':'application/json'}, timeout: 20000 });
      const cand = resp.data?.candidates?.[0];
      if (!cand) continue;
      let texto = (cand.content?.parts || []).map(p=>p.text||'').join('').trim();
      console.log(`FinishReason ${modelo}: ${cand.finishReason} | ${texto.length} chars | ${texto.substring(0,200)}`);
      if (texto && texto.length > 15) return texto;
    } catch (e) {
      const errMsg = e.response?.data?.error?.message || e.message;
      console.error(`Fallo ${modelo}: ${errMsg?.substring(0,500)}`);
      continue;
    }
  }
  
  // Fallback inteligente por tema
  const low = mensajeUsuario.toLowerCase();
  if (low.includes('foto') || low.includes('imagen')) {
    return `¡Si! Mándame la foto de lo que quieres imprimir 😊 Con la foto te digo si lo puedo hacer y te ayudo a conseguir el archivo STL. Si es llavero con nombre como "Clara", con la foto del estilo de letra que te gusta te lo diseño y te sale entre $50-$80.`;
  }
  if (low.includes('clara') || low.includes('nombre') || low.includes('llavero')) {
    return `¡Hola ${nombre}! El llavero con el nombre "Clara" te sale entre $50 y $80 pesos según el tamaño 😊 ¿De qué tamaño lo quieres? Como de 5cm? Si me mandas foto de la tipografía que te gusta, te cotizo exacto en 10 min.`;
  }
  return `¡Hola ${nombre}! Soy la secre de Lilab Estudio 😊 Mándame foto o tu archivo STL y te cotizo en 10 min. Hacemos PLA $5.5/gr para interior y PETG $10/gr para exterior que aguanta sol y agua. Entregamos en Macropaza a las 12pm en 72h sin anticipo.`;
}

async function enviarWhatsApp(to, texto) {
  try {
    await axios.post(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp', to, type: 'text', text: { body: texto }
    }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
    console.log(`Enviado OK a ${to} (${texto.length} chars)`);
  } catch (e) {
    console.error('Error WA:', JSON.stringify(e.response?.data || e.message).substring(0,600));
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
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return;
    
    const from = message.from;
    const nombre = value?.contacts?.[0]?.profile?.name || 'Luis';
    let textoUsuario = '';

    if (message.type === 'text') {
      textoUsuario = message.text.body;
    } else if (message.type === 'image') {
      textoUsuario = '[El cliente envio una foto/imagen] Pregunta: ¿pueden imprimir esto? ¿que necesita?';
      console.log(`Imagen recibida de ${nombre}, id: ${message.image?.id}`);
    } else if (message.type === 'document') {
      textoUsuario = `[El cliente envio un archivo: ${message.document?.filename}] Quiere cotizacion.`;
    } else {
      textoUsuario = `[El cliente envio ${message.type}]`;
    }

    console.log(`\n--- Mensaje de ${nombre} (${from}): ${textoUsuario} ---`);
    const respuesta = await generarConGemini(textoUsuario, nombre);
    console.log(`Respuesta final: ${respuesta}`);
    await enviarWhatsApp(from, respuesta);
  } catch (e) { console.error('Error webhook:', e.message); }
});

app.get('/', (req, res) => res.send('Lilab V3.6 con Base de Conocimiento 🚀'));
app.listen(PORT, () => console.log(`Lilab V3.6 en puerto ${PORT}`));
