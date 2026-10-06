# Xiu-xiu — resums de reunions des del mòbil

App web per a l'iPhone (s'instal·la a la pantalla d'inici com una app normal) que **escolta la conversa, en mostra la transcripció en directe i, en acabar, en fa un resum ordenat**. Sense cap clau de pagament.

1. **Escolta** la reunió amb el micròfon de l'iPhone.
2. **Transcripció en directe:** el text apareix a la pantalla mentre parleu.
   - **Gemini** (recomanat): text nou cada ~20 segons, molt precís, en català i castellà encara que es barregin. L'app talla l'àudio aprofitant les pauses, per no partir paraules, i no envia els trams en silenci.
   - **Dictat de l'iPhone**: paraula a paraula a l'instant, però menys precís.
3. En acabar, en fa un **resum ordenat**: resum, punts tractats, decisions, tasques amb responsable i termini, temes oberts i dades clau.
4. *(Opcional)* **T'envia el resum per correu** a `oriol@esportec.cat` i **el desa en un Google Sheets**, amb una pestanya de tasques per fer-ne el seguiment.

Per començar **només cal una clau gratuïta de Gemini**. El correu i el Sheets es poden afegir més endavant.

Altres funcions:
- Pots posar el títol i els assistents de la reunió, i el resum en surt més precís.
- Botó per **marcar moments importants** durant la reunió.
- Pausa i represa de la gravació.
- **Historial** al mòbil, amb opcions per tornar a enviar el resum, refer-lo o copiar-lo.
- **No es perd res**: l'àudio es desa al mòbil. Si et quedes sense cobertura, tanques l'app o s'acaba la quota gratuïta del dia, en tornar a obrir-la continua on s'havia quedat.
- La pantalla es manté encesa mentre grava.

## Cost: 0 €

| Peça | Servei | Cost |
|---|---|---|
| Transcripció i resum | Gemini (Google AI Studio), nivell gratuït | Gratuït, sense targeta |
| Correu i registre | Google Sheets + Apps Script, amb el teu compte | Gratuït |
| Allotjament de l'app | Netlify o GitHub Pages | Gratuït |

### Quota

El nivell gratuït de Gemini té un límit de peticions diàries per model, que es renova cap a les 9 del matí. Per aprofitar-lo al màxim:
- La **transcripció** fa servir **Gemini Flash-Lite**, que té molta més quota gratuïta, i talla l'àudio en trams d'~1 minut. Els trams en silenci no es compten. Una reunió d'una hora gasta unes 50–60 peticions.
- El **resum** fa servir **Gemini Flash**, que és més bo, però només una petició per reunió.
- Si un model esgota la quota, l'app passa sola al següent. Si s'esgoten tots, ho avisa i ho reprèn l'endemà, sense perdre res.

Amb **unes 3 hores de reunió al dia** hauria de ser suficient. Si algun dia no n'hi ha prou:
- A *Configuració > Avançat*, puja el temps entre textos (p. ex. a 120 s). Gastaràs la meitat de peticions.
- O activa la **facturació** al projecte de Google AI Studio (*Settings > Billing*). Llavors no hi ha límit pràctic i es paga per ús, que per a aquest volum hauria de ser poc. A més, Google deixa de fer servir les teves dades.

> ⚠️ **Privadesa:** al nivell gratuït, Google pot fer servir el contingut que s'hi envia (l'àudio i les transcripcions) per millorar els seus productes, i el pot revisar personal humà. Per a reunions amb informació confidencial, tens dues opcions:
> - Activar la facturació al projecte d'AI Studio. Llavors Google deixa de fer-ho servir, i el cost seria de cèntims per reunió.
> - Triar a Configuració **«Dictat de l'iPhone»**. Així l'àudio no surt del mòbil cap a Gemini, tot i que la transcripció en text sí que s'envia per fer el resum. És menys precís.

## Posada en marxa (uns 10 minuts, només el primer cop)

### 1. Clau de Gemini (gratuïta)

1. Entra a https://aistudio.google.com/apikey amb un compte de Google.
2. **Create API key**. Copia la clau, que comença per `AIza…`.

> Si el compte d'esportec.cat no hi pot entrar perquè l'administrador de Workspace ho té desactivat, fes servir un compte de Gmail personal: funciona igual.

### 2. *(Opcional)* Full de Google Sheets (correu + registre)

1. Crea un full de càlcul nou a https://sheets.new i anomena'l, per exemple, **Reunions**.
2. Menú **Extensions > Apps Script**. Esborra el que hi hagi i enganxa-hi el fitxer [`apps-script/Code.gs`](apps-script/Code.gs).
3. A la línia `const SECRET = '...'`, posa-hi una frase llarga inventada (p. ex. `reunions-taronja-2026-x7k9`). Desa (💾).
4. A dalt, tria la funció `autoritza` i prem **Executa**. Accepta els permisos de Gmail i Sheets. Si surt «Google no ha verificat aquesta aplicació», ves a *Configuració avançada > Ves a… (no segur)*: l'script és teu.
5. **Implementa > Nova implementació >** ⚙️ **Aplicació web**
   - *Executa com a:* **Jo**
   - *Qui hi té accés:* **Qualsevol**
6. Copia l'**URL de l'aplicació web**, que acaba en `/exec`.

Les pestanyes *Reunions* i *Tasques* es creen soles amb la primera reunió.

> Si a «Qui hi té accés» no surt l'opció *Qualsevol*, l'administrador de Google Workspace d'esportec.cat ho té limitat. Fes el full amb un compte de Gmail personal: el correu continuarà arribant a oriol@esportec.cat.

### 3. Publicar l'app

Necessita una adreça `https://`. Tens dues opcions:

**Opció A: Netlify (gratuït, 2 minuts, la més fàcil)**
1. Descarrega la carpeta `app/` d'aquest repositori.
2. Entra a https://app.netlify.com/drop i arrossega-hi la carpeta `app`.
3. Et donarà una adreça del tipus `https://nom-aleatori.netlify.app`. Si et fas un compte, la pots personalitzar.

**Opció B: GitHub Pages (aquest repositori)**
Aquest repositori ja inclou l'automatització (`.github/workflows/pages.yml`). Com que el repositori és privat, GitHub Pages requereix un pla GitHub Pro. Si el tens:
*Settings > Pages > Source: GitHub Actions*. L'app quedarà a `https://oriol-cmd.github.io/projectes-Oriol/`.

### 4. Instal·lar-la al mòbil

1. Obre l'adreça amb **Safari**.
2. Botó **Compartir > Afegeix a la pantalla d'inici**.
3. Obre l'app des de la icona **Xiu-xiu**, ves a ⚙️ **Configuració** i omple:
   - Clau de Gemini (i prem **Comprova la clau**)
   - *(Opcional)* URL i clau secreta de l'script del full (i prem **Envia un correu de prova**) Si tot surt amb ✓, ja la pots fer servir.

**A Android (Chrome):** obre l'adreça amb **Chrome** > menú **⋮** > **«Instal·la l'aplicació»** (o «Afegeix a la pantalla d'inici»). La resta funciona igual.

## Qui parla

Per saber qui diu què (i a qui toca cada tasca):
1. En començar la gravació, **presenteu-vos un a un** dient el nom: «Soc l'Oriol», «Jo soc la Montse»…
2. Toqueu **«👋 Presentacions fetes»**.
3. L'app fa servir aquest tros com a **mostra de veus**: a cada tram, Gemini compara les veus amb la mostra i etiqueta cada intervenció amb el nom («**Oriol:** …»). El resum atribueix les tasques i decisions a cada persona.

Si no es pot saber amb seguretat qui parla, hi posa «Persona no identificada». Es pot desactivar a *Configuració > Avançat*. Enviar la mostra amb cada tram fa que el cost de transcripció sigui aproximadament el doble (uns 10 € al mes per 15 h setmanals).

## Enviar el resum a altres persones

A cada reunió hi ha el botó **«👥 Envia a altres persones»**: escrius les adreces (o tries les que ja has fet servir) i el resum els arriba amb format, enviat des del teu compte. Pots adjuntar-hi la transcripció. Les respostes et tornen a tu.

> Si l'script de Google és d'abans d'aquesta funció, cal actualitzar-lo: enganxa-hi el codi nou d'`apps-script/Code.gs` (mantenint el teu `SECRET`), desa, i ves a **Implementa > Gestiona les implementacions > ✏️ > Versió: Versió nova > Implementa**. L'URL no canvia.

## Fotos de documents

Si a la reunió parleu d'un document (notes escrites a mà, un esquema, un pressupost…), toca **«📷 Foto d'un document»** mentre graves. L'app guarda en quin minut s'ha fet. En fer el resum, Gemini llegeix les fotos juntament amb la transcripció, les relaciona amb el que es deia i afegeix una secció **«Documents comentats»**. El que no es llegeixi bé surt marcat com a [dubte de comprensió]. També pots afegir fotos després, des de la reunió guardada, i tocar «Refés el resum».

## Compartir l'app amb altres persones

Qualsevol persona pot fer servir l'app amb el mateix enllaç: **https://oriol-cmd.github.io/projectes-Oriol/**

- Cada persona hi posa **la seva pròpia clau de Gemini**, que es guarda només al seu mòbil. El cost (o la quota gratuïta) és seu.
- Les reunions, l'historial i la configuració de cadascú es queden al seu mòbil: ningú veu les dels altres.
- El primer cop que l'obre, l'app li explica com treure la clau.
- *(Opcional)* Per rebre els resums automàticament i desar-los en un Google Sheets, ha de fer **el seu propi** full amb l'script (secció «Full de Google Sheets»). L'script envia sempre al compte de Google de qui l'instal·la, de manera que només cal canviar-hi el `SECRET`. Sense script, pot fer servir el botó «✉️ Envia'm el resum per correu».

## Més funcions

- **Tipus de reunió**: abans de gravar, tria General, Reunió d'equip, Comercial / client, 1 a 1, Entrevista, Formació o Seguiment de projecte. El resum s'adapta (p. ex. en una comercial afegeix «Client i necessitats»).
- **Resum en castellà o anglès**: a cada reunió, els botons *Català / Castellano / English* el tradueixen mantenint l'estructura. A *Configuració > Resum* pots triar l'idioma per defecte (és el que s'envia per correu).
- **PDF amb el disseny de Xiu-xiu**: capçalera, dades de la reunió, tasques en una taula amb caselles i dubtes ressaltats. Es pot desar o compartir (correu, WhatsApp, Fitxers…).
- **Còpia de seguretat**: a *Configuració > Còpia de seguretat*, desa en un fitxer la configuració, les reunions i les fotos (p. ex. a iCloud Drive o Google Drive) i recupera-ho en un altre mòbil. ⚠️ El fitxer inclou les teves claus: guarda'l en un lloc privat. No esborris mai la icona de l'app sense haver fet abans una còpia.
- **Pantalla d'inici**: tasques de l'última reunió i últimes reunions a primer cop d'ull.
- **Avís de versió nova**: quan hi ha una actualització, surt un avís amb el botó «Actualitza».
- **Errors entenedors**: si alguna cosa falla, l'app ho explica clarament i ho torna a provar sola (el detall tècnic queda amagat).

### Importar àudios i vídeos
A la pantalla de gravar, **«📂 Importa un àudio o vídeo»** fa el resum d'una gravació que ja tens: una nota de veu, un àudio de WhatsApp (desa'l abans a *Fitxers*), una gravació de Zoom o Teams, un MP3, M4A, WAV, OGG, MP4… Els fitxers grans es pugen a Google per transcriure'ls.

### Videotrucades a l'ordinador
Obre Xiu-xiu a l'ordinador amb **Chrome o Edge** i tria **«🖥️ Videotrucada»**. En començar, el navegador et demana què vols compartir: tria la **pestanya** de Meet, Teams o Zoom web (o **tota la pantalla**, a Windows, si fas servir l'aplicació d'escriptori) i marca **«Comparteix també l'àudio»**. Xiu-xiu grava el so de la trucada i el teu micròfon alhora. (Al Mac, Chrome només pot gravar el so d'una pestanya, no el d'aplicacions.)

### Pregunta a les reunions
A la pestanya **«Pregunta»**, escriu una pregunta («Què vam decidir amb l'Ignasi sobre el pressupost?») i Xiu-xiu respon a partir dels resums (i, si cal, de les transcripcions) de les teves reunions, indicant de quina reunió treu cada dada. Pots limitar la cerca a un tipus de reunió o a un grup.

### Classificar les reunions
Cada reunió té un **tipus** (equip, entrevista, comercial…) i, si vols, un **grup o projecte** (camp «Grup o projecte» abans de gravar, o *⋯ > Grup o projecte* després). A **«Reunions»**, els filtres de dalt les agrupen per tipus i per grup.

## Ús

1. Obre l'app, escriu el títol i qui hi ha a la reunió (opcional) i toca el **botó vermell**.
2. Deixa l'iPhone damunt la taula **amb l'app oberta i la pantalla encesa**.
3. Mentre parleu, veuràs la transcripció a la pantalla.
4. En acabar, toca **Acaba la reunió**. En pocs segons tindràs el resum ordenat a la pantalla (i, si ho has configurat, al correu i al full de càlcul).

### Important a l'iPhone
- **No bloquegis el mòbil ni canviïs d'app mentre grava.** L'iPhone talla el micròfon de les apps web quan passen a segon pla. L'app es manté la pantalla encesa sola. Si mai es talla, en tornar-hi reconnecta el micròfon i continua, però el tros que no s'ha gravat es perd.
- Si reps una trucada, la gravació es pausa. En tornar a l'app es reprèn.
- Per a reunions molt llargues, connecta el mòbil al carregador.

## Privadesa

- La clau i l'historial de l'app es desen **només al teu iPhone**.
- L'àudio i la transcripció s'envien a Gemini (Google). Llegeix l'avís del nivell gratuït a l'apartat *Cost*.
- Un cop transcrit, l'àudio s'esborra del mòbil. A *Configuració > Avançat* pots triar conservar-lo.
- L'script del full només envia correus a les adreces de la llista `ALLOWED_RECIPIENTS` i només si rep la clau secreta.

## Estructura

```
app/                 L'app web (HTML + JS, sense dependències)
  index.html
  app.js             Gravació, transcripció i resum (Gemini) i enviament
  style.css
  sw.js              Funcionament sense connexió
  manifest.webmanifest
  icons/
apps-script/Code.gs  Script del full de Google: correu + registre de reunions i tasques
```

---
*Xiu-xiu by Oriolbop*
