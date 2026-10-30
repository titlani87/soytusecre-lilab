
# SoyTuSecre - Webhook Lilab Estudio

## Deploy en Render.com (gratis, 24/7)

1. Sube este repo a GitHub
2. En render.com -> New Web Service -> Conecta repo
3. Build: npm install, Start: npm start
4. Agrega Env Vars:
   - VERIFY_TOKEN=soytusecre_verify_123
   - WHATSAPP_TOKEN= (el token permanente de Meta)
   - PHONE_NUMBER_ID=1426928223838877
5. Render te da URL: https://soytusecre-lilab.onrender.com

## Configurar Webhook en Meta

En developers.facebook.com > Tu App > WhatsApp > Configuración:
- URL de callback: https://soytusecre-lilab.onrender.com/webhook
- Token de verificación: soytusecre_verify_123
- Suscribir a: messages

Activa el switch "Suscribir webhooks"

## Probar
Manda WhatsApp a +52 1 55 5494 5365 con "Hola"
