# Plataforma de gestió

Plataforma web amb usuari i contrasenya per gestionar treballadors, activitats, clients, productes, pressupostos, factures i automatismes. Tot es pot personalitzar des de **Configuració**.

## Què fa

| Apartat | Funcions |
|---|---|
| **Tauler** | Properes activitats, treballadors pendents de confirmar, pressupostos en seguiment i factures per cobrar. |
| **Treballadors** | Nom, cognoms, DNI, correu i telèfon, més els camps que hi afegeixis. Pots pujar-hi documents (amb categoria i opció d'amagar-los al treballador). Té una disponibilitat setmanal i dates concretes en què no pot treballar (o en què sí que pot, excepcionalment). També li pots crear un **usuari d'accés limitat**. |
| **Activitats** | Calendari mensual i vista de llista. En crear una activitat, la plataforma et demana el **lloc i la data**, les **dades del client** (en tries un d'existent o n'entres un de nou, que **es desa sol a Clients**), els **productes** i els **treballadors assignats a cada producte**. Al costat de cada treballador hi surt si està disponible (✅ / ⚠️ / ⛔), segons la seva disponibilitat i les altres feines que té. |
| **Clients** | Nom, NIF/CIF, correu, telèfon i adreça. A la fitxa hi ha l'historial d'activitats, pressupostos i factures. No es dupliquen: si el NIF o el correu ja hi són, s'actualitza el client que ja existeix. |
| **Productes** | Els crees tu: preu, IVA, color al calendari i quants treballadors calen. |
| **Pressupostos** | Pressupostos sense compromís, amb **descompte per línia i/o general** (en % o en €), que surt al document amb l'estalvi per al client, i un text de presentació propi. Es fan a partir dels productes o amb línies lliures, i s'envien per correu. El client rep un enllaç on el pot veure, descarregar en PDF i **acceptar o rebutjar**. Pots fer-ne el **seguiment**: si l'ha obert, quantes vegades, quan i què ha respost. Un pressupost es pot convertir en activitat o en factura. |
| **Contractes** | Contracte tipus editable (Configuració > Contracte tipus) que s'omple sol amb les dades del client, l'activitat i el pressupost. Cada contracte es pot editar abans d'enviar-lo. El client el rep per correu, el llegeix i **el signa en línia** amb el dit o el ratolí; queda registrat el nom, el NIF, la data, l'hora i l'IP. Amb recordatori automàtic si no el signa. |
| **Factures** | Es veuen amb **la teva plantilla**. Són editables i poden portar **paga i senyal** (en percentatge o en import fix), amb botons per marcar com a pagat el senyal o el total. També s'envien per correu amb un enllaç. |
| **Automatismes** | Envien recordatoris sols: al client, si no ha obert el pressupost o si l'ha vist i no ha respost, si li falta pagar el senyal o si la factura està a punt de vèncer o ja ha vençut; al treballador, la convocatòria amb els detalls i el **grup de WhatsApp**, un avís si no l'ha obert o no ha confirmat el dia, i un recordatori el dia abans. Tu tries quan s'envien, cada quant es repeteixen i el text de cada missatge. |
| **Correus enviats** | Tots els correus, amb l'estat i si s'han obert. |
| **Configuració** | Dades de l'empresa i logotip; nom, color i apartats del menú (els pots amagar o canviar-los el nom); camps personalitzats per a treballadors, clients i activitats; estats de les activitats, rols i categories de documents; IVA, venciment, senyal per defecte i numeració; plantilla de factura i de pressupost (3 dissenys o el teu propi HTML, amb vista prèvia); textos dels missatges; servidor de correu; usuaris administradors. |

### Accés dels treballadors (limitat)
A la fitxa del treballador, a la pestanya **Accés**, li crees un usuari i una contrasenya. Pots enviar-li les dades per WhatsApp amb un sol clic. El treballador entra a la mateixa adreça i **només veu**:
- les seves feines, amb el botó per confirmar-les o rebutjar-les i l'enllaç al grup de WhatsApp;
- la seva disponibilitat, que pot editar;
- els seus documents, i en pot pujar de nous;
- el seu perfil i la contrasenya.

Les dades dels clients, les factures i els altres treballadors no les pot veure: el servidor ho bloqueja.

### WhatsApp
WhatsApp no permet que una aplicació creï grups ni hi afegeixi gent automàticament. Per això funciona així:
1. Al WhatsApp, crea el grup de la feina > **Convida al grup amb un enllaç** > copia l'enllaç.
2. Enganxa'l a l'activitat, al camp «Enllaç d'invitació al grup de WhatsApp».
3. La convocatòria que rep cada treballador (per correu i a la seva pàgina de confirmació) porta els detalls de la feina i el botó **«Entrar al grup de WhatsApp»**.
4. Si ho prefereixes, a cada treballador de l'activitat hi ha el botó **WhatsApp**. Obre el WhatsApp amb el missatge ja escrit (detalls, enllaç per confirmar i enllaç del grup) i només cal prémer Envia.

### Seguiment dels correus
Saps que el client ha obert un pressupost per dues vies: quan obre l'enllaç (és el més fiable) o quan el seu programa de correu carrega una imatge invisible del missatge. Alguns programes bloquegen aquestes imatges i d'altres (com Apple Mail) les obren automàticament, així que «obert» és una indicació, no una certesa.

## Posar-la en marxa

Cal **Node.js 22.13 o posterior**. No cal cap base de dades externa: s'usa SQLite, i tot (dades i documents) es desa a la carpeta `data/`.

```bash
cd gestio
npm install
npm start
```

Obre http://localhost:3000. El primer cop et demana que creïs l'usuari administrador.

Variables opcionals: `PORT` (port, per defecte 3000), `DATA_DIR` (on es desen les dades) i `TZ` (zona horària, per defecte `Europe/Madrid`).

### Publicar-la a internet
👉 **Guia pas a pas gratuïta (Google Cloud + DuckDNS): [deploy/GUIA.md](deploy/GUIA.md)**. L'script [`deploy/instala.sh`](deploy/instala.sh) ho instal·la tot amb una sola ordre.

Perquè els clients i els treballadors puguin obrir els enllaços, la plataforma ha d'estar en un servidor accessible des d'internet amb HTTPS. Algunes opcions:
- un servidor propi (VPS) amb Node i un proxy com Caddy o Nginx;
- serveis com Render, Railway o Fly.io, amb un **disc persistent** muntat a `DATA_DIR`.

Un cop publicada, posa'n l'adreça a **Configuració > Correu > Adreça pública**.

### Correu
A **Configuració > Correu**, posa-hi les dades SMTP i fes servir el botó per enviar un correu de prova. Amb Gmail o Google Workspace:
- servidor `smtp.gmail.com`, port `587`;
- usuari: la teva adreça;
- contrasenya: una [contrasenya d'aplicació](https://myaccount.google.com/apppasswords).

Mentre no el configuris, els correus es desen a «Correus enviats» amb l'estat *simulat* i no s'envien.

### Còpies de seguretat
Copia la carpeta `data/` (conté `gestio.db` i `uploads/`).

## Proves
```bash
npm test
```
Arrenca la plataforma amb una base de dades buida i fa tot el recorregut amb un navegador: crea un treballador amb el seu usuari, una activitat amb un client nou, envia les convocatòries i les confirma, fa un pressupost que el client accepta, una factura amb paga i senyal, comprova els automatismes, la configuració i el portal del treballador. Necessita Playwright.
