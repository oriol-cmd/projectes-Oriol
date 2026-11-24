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

## Acta en PDF amb el teu logotip

A **Ajustos > Acta en PDF** pots crear **plantilles**: cadascuna amb el seu nom, **logotip** (qualsevol imatge), nom de l'organització, **color** i peu de pàgina. Per exemple, una per a cada empresa o entitat amb què treballes. Quan facis **Comparteix > Acta en PDF**, Xiu-xiu et pregunta quina plantilla vols (la darrera que has fet servir per a aquella reunió surt primer). L'opció «Xiu-xiu (estàndard)» sempre hi és.

## Reunions importants: acta professional

Tria el tipus **«⭐ Reunió important»** i, si vols, dona-li l'**ordre del dia**: escriu-lo (un punt per línia) o toca **«📷 O afegeix-ne una foto o captura»** per fer una foto de la convocatòria en paper o triar una captura de pantalla (o totes dues coses). Xiu-xiu fa l'acta per fases, com un secretari:

1. Treu l'**ordre del dia real** de la reunió (o fa servir el teu, i hi afegeix el que hagi sortit fora).
2. **Redacta cada punt per separat i amb detall**: context, què ha dit cadascú, arguments, dades i conclusió.
3. Escriu el **resum executiu**, els **acords**, les **tasques**, els temes oberts i les dades clau.

Fa servir el model més bo que permeti la teva clau (Gemini Pro si tens facturació activada; si no, Flash) i transcriu amb Flash. Triga uns minuts més i gasta més quota, per això és només per a les reunions importants. Una reunió ja gravada també es pot refer així: **⋯ > «Refés-la com a acta professional»**.

## Resum detallat o resumit

De sèrie, Xiu-xiu fa una **acta detallada**: no és la transcripció literal, sinó tot el que s'ha parlat ben ordenat per temes (què ha dit cadascú, arguments, dades, dubtes i conclusions), més les decisions i les tasques. Si d'una reunió en vols només el més important, toca **⋯ > «Fes-ne una versió més resumida»** (i al revés). Per canviar-ho per a totes les reunions: Ajustos > Resums > «Com vols el resum».

## Corregir l'acta

Si l'acta té **[dubtes de comprensió]**, a dalt del resultat surt un avís amb **«Corregeix-los»** (també a **⋯ > «Corregeix l'acta»**). Hi veuràs cada frase amb el dubte i hi podràs escriure què s'hi deia; també pots afegir altres correccions («el client és X, no Y»). Xiu-xiu aplica **només** aquestes correccions i deixa la resta igual, i recorda els noms corregits per a les properes reunions. Si ho prefereixes, també pots **editar el text de l'acta a mà**.

## Més funcions (v63)

- **Les meves plantilles de resum:** a Ajustos, escriu els apartats que vols (p. ex. «Acta de patronat») i surten com un tipus de reunió més.
- **Exportar** l'acta a **Word (.docx)** i **Markdown (.md)** des de «Comparteix» (el Word fa servir el color i l'organització de la plantilla de PDF per defecte).
- **Escoltar l'àudio:** a la transcripció, cada tros té un botó ▶ (o, a les gravacions importades, cada marca de temps). L'àudio es guarda els dies que triïs.
- **Privadesa i espai** (Ajustos): quant de temps es guarda l'àudio (de sèrie 7 dies) i si s'esborren les reunions antigues. Si el mòbil va just d'espai, s'esborra primer l'àudio més antic.
- **Mòbil i ordinador sincronitzats amb Google:** segueix la [guia pas a pas](docs/guia-vincular-google.md).

## Novetats de la v83

- **📋 Copia la transcripció**: a «Transcripció completa», copia el text literal (amb noms i temps) per enganxar-lo on vulguis.
- **Qui parla**: Gemini rep els noms de qui s'ha presentat i només posa «Persona no identificada» si de debò no és cap d'ells. A «Noms de qui parla», **🔎 Identifica les «Persona no identificada»** les assigna només quan és evident. I **tocant el nom d'una línia** el pots canviar només allà.
- **📅 Cites al calendari**: busca les cites, reunions, rodatges, formacions… acordades a la reunió, passa les dates relatives a dates reals (a partir del dia de la reunió) i les afegeix a **Google Calendar** o al **calendari del mòbil** (.ics). Les dates dubtoses surten marcades per revisar-les.

## Novetats de la v82: transcripció sense conversa inventada

- Quan un tros d'àudio no s'entén, Gemini a vegades **s'inventa una conversa sencera** per omplir-lo. Ara cada tros es transcriu sabent quant dura (i amb un límit de text proporcional), i es compara el **nombre de paraules amb la durada**: ningú no pot dir més de ~230 paraules per minut.
- Si un tros en té més, es torna a transcriure amb el model precís i més estricte; si continua igual, queda **marcat amb ⚠️ com a dubtós** (es guarda l'àudio per escoltar-lo) i **l'acta no en treu acords, tasques ni xifres** si no es confirmen en altres parts.
- També es revisen les **reunions ja fetes**: els trossos impossibles surten marcats a l'informe de la gravació; toca ⋯ › «Refés l'acta».

## Novetats de la v80: revisió de l'acta amb la gravació

- Quan l'acta està feta (en segon pla, sense fer esperar), Gemini la torna a llegir al costat de la transcripció i comprova **frase per frase** que tot surti de la reunió: temes, noms, marques, xifres, colors, qui diu cada cosa, acords i conclusions.
- El que no es troba a la gravació queda **ressaltat en groc**. A l'avís de dalt: **«Mira-les»** (motiu, què es va dir realment i ▶ el moment) i **«Corregeix-les»** (l'acta queda només amb el que es va dir, i es torna a comprovar).
- També es pot fer a mà: **⋯ › Comprova l'acta amb la gravació**. Es pot desactivar a Ajustos (gasta 1 petició més per reunió).

## Novetats de la v77: reunions llargues més ràpides

- **L'acta es mostra en el moment que està feta**; el correu, el Google Doc i les etiquetes s'acaben en segon pla (abans calia esperar-los).
- **Trams pendents en acabar** (p. ex. si una estona no hi havia cobertura): es transcriuen **3 alhora** en lloc d'un en un. Mentre es grava, continuen d'un en un i en ordre.
- **Reunió important**: cada punt de l'ordre del dia rep només el tros de reunió on es parla d'aquell punt (amb 4 minuts de marge) i se'n redacten 3 alhora. En una reunió de 2 hores, cada punt llegeix ~1/6 de la transcripció en lloc de tota.

## Novetats de la v73: transcripció més ràpida

- **Gravacions llargues importades**: el primer tros de 5 minuts es fa sol (per agafar els noms de qui parla) i la resta, **3 trossos alhora**. Cada tros rep els noms que han sortit fins llavors perquè siguin els mateixos a tota la transcripció. Una gravació de 2 hores passa de ~12 minuts a ~4–5.
- **Diversos àudios alhora** (p. ex. notes de veu): se'n transcriuen 2 a la vegada.
- Si una part falla, la feina feta queda desada i en tornar-ho a provar es reprèn pels trossos que falten.

## Novetats de la v72: trucades durant la gravació

- Si entra una trucada (o una altra app agafa el micròfon), Xiu-xiu ho detecta i, en penjar, **torna a obrir el micròfon sol** i continua al mateix document.
- Mentre no s'està gravant surt un **avís a tota la pantalla, «⚠️ No s'està gravant»**, amb un botó gran **«Continua gravant»** (també vibra, a Android). Passa el mateix si es deixa de compartir una videotrucada o si la gravadora s'atura per qualsevol motiu.
- El que s'ha gravat abans de la interrupció no es perd, i a la transcripció queda marcat el tall.

## Novetats de la v71: triar el micròfon

- **Ajustos › Micròfon**: tria el micròfon (extern, auriculars…) i toca «Prova'l» per veure si et sent. També es pot triar a la finestra que surt abans de gravar una videotrucada.
- **Indicadors mentre grava una videotrucada**: «🔊 So de la trucada» i «🎤 El teu micròfon» s'encenen quan arriba so. Si al cap d'una estona una de les dues entrades no ha rebut res, surt un avís.
- **En videotrucades, cap tros es descarta com a silenci**, i si al final no surt cap paraula, l'app torna a transcriure els trossos dubtosos abans de donar error.

## Novetats de la v70

- **Fotos d'apunts o PDF → resum**: a l'inici, «📷 O fes-ne el resum d'unes fotos d'apunts o d'un PDF» (fins a 15). Gemini primer en treu el text tal com és (es pot llegir i corregir a «Transcripció completa») i després en fa el resum, sense afegir-hi res.
- **Text en directe**: mentre grava, cada ~20 s surt un esborrany (en cursiva) del que s'està dient; quan arriba la transcripció bona del tros, el substitueix. L'acta es fa sempre amb la transcripció completa. Es pot desactivar a Ajustos (gasta més quota de Google).

## Novetats de la v67

- **Gravar amb un toc**: a Ajustos, «En obrir Xiu-xiu, preparat per gravar amb un sol toc» (surt un botó gran a tota la pantalla). A Android, mantén premuda la icona › «Grava ara». També funciona l'enllaç `…/projectes-Oriol/?rec=1`.
- **Correu a cada assistent** (Comparteix): un correu per persona amb els acords i les seves tasques, per revisar i enviar.
- **Anàlisi de la reunió** (⋯): quant ha parlat cadascú, temps per tema, temes oberts, preguntes sense resposta i acords sense responsable.
- **Pregunta sobre aquesta reunió**: sota l'acta. Les respostes porten el moment ▶ [mm:ss] per escoltar-lo.
- **Documents PDF**: a l'inici («Adjunta documents») o després (⋯). Gemini els llegeix per escriure bé noms, xifres i punts.
- **Vídeos de YouTube**: «O fes-ne el resum d'un vídeo de YouTube» (públic o no llistat, fins a 4 hores).
- **Resum de diverses reunions** (Historial): un recull amb l'evolució dels temes, decisions i tasques.
- **Etiquetes automàtiques**: cada reunió en rep d'1 a 3; es poden filtrar a l'historial i canviar a ⋯ › Etiquetes.

## Calendari, plantilles, versions i editar (v66)

- **📅 Omple-ho amb el calendari**: a l'inici, agafa el títol, els convidats, el lloc i la convocatòria de la reunió que tens ara al Google Calendar (cal l'script de Google actualitzat i tornar a executar `autoritza`).
- **Biblioteca de plantilles**: 12 tipus de reunió en català (junta de veïns, consell escolar, patronat, visita a client…) a Ajustos › Plantilles › «Més plantilles». I el tipus **Automàtic**, que mira la transcripció i tria la plantilla que hi encaixa.
- **Diverses versions**: a la pantalla de l'acta, «+ Una altra versió» crea un resum per a direcció, un correu per al client, les tasques per a l'equip, un WhatsApp, notes personals o el que demanis. Cada versió queda en una pestanya i es pot exportar i enviar.
- **Editar la transcripció**: a «Transcripció completa», «Edita la transcripció» per corregir-la a mà i refer l'acta amb la versió bona. Sempre pots tornar a l'original.

## Mapa mental, tasques, noms i Google Docs

- **Mapa mental:** al resultat, toca **«Mapa mental»**. Es fa a partir de l'acta (temes, acords, tasques…), sense afegir-hi res. Es pot desar o compartir com a imatge.
- **Tasques:** a l'inici, **«Totes les tasques →»** mostra les tasques de totes les reunions. Les pots marcar com a fetes, filtrar per persona, **afegir al calendari** (del mòbil o de Google; la data es proposa a partir del termini dit a la reunió) i **enviar a cada persona les seves pendents**.
- **Noms de qui parla:** al resultat, **«Noms de qui parla»** canvia «Persona 1» pel nom real a tota la transcripció i l'acta, i el recorda per a les properes reunions.
- **Google Docs:** amb l'script actualitzat, cada acta es desa també com a Google Doc a la carpeta **«Xiu-xiu · Actes»** del teu Drive (i s'actualitza si refàs el resum). L'enllaç surt al correu i al resultat.
- **Trucades:** a la UE (Espanya inclosa) l'iPhone no permet gravar trucades des de l'app Telèfon. Alternatives: altaveu i gravar amb un altre aparell; des d'un PC amb Windows i l'app Enllaç mòbil (Xiu-xiu › Videotrucada › Pantalla sencera amb l'àudio del sistema); trucades per Meet/Teams/Zoom; o apps de pagament. Fora de la UE, iOS 18.1+ grava des de Telèfon i ho desa a Notes. A l'inici hi ha la guia **«Mira com fer-ho»**.

## Gravar sense talls (iPhone) i reunions llargues

A l'iPhone, una web no pot fer servir el micròfon si canvies d'app o bloqueges la pantalla. Si necessites fer servir el mòbil durant la reunió, grava-la amb **Notes de veu** (Apple) i després importa-la a Xiu-xiu: a la pantalla d'inici hi ha la drecera **«Grava-la amb Notes de veu»** amb els passos. Les gravacions llargues (1–3 h) es tallen en trossos de 5 minuts per les pauses de la conversa i es transcriuen sencers, amb el temps de cada part; si es talla a mitges, es reprèn pel tros on era.

## Si es perd àudio

A l'iPhone, si la pantalla es bloqueja o canvies d'app, el micròfon s'atura. Xiu-xiu t'avisa en tornar, marca la interrupció a la transcripció i, al resultat, et diu quanta estona no s'ha gravat. Si algun tros d'àudio torna sense text, el guarda i pots tocar **«Torna'ls a transcriure»** (amb el model més precís).

## Veus fluixes i noms difícils

- **Amplifica les veus fluixes o llunyanes** (Ajustos > Transcripció, activat de sèrie): abans d'enviar cada tros a Gemini, l'app puja el volum de les parts fluixes, treu el brunzit greu i dona claredat a la veu.
- **Transcripció més precisa** (desactivat de sèrie): fa servir Gemini Flash en comptes de Flash-Lite. Entén millor les veus difícils, però costa uns 10 cops més i la quota gratuïta de Flash és molt petita (pot deixar el resum sense Flash). Si s'esgota, passa sol a Flash-Lite.
- **Noms i paraules que surten sovint**: escriu-hi noms de persones, empreses, llocs i sigles perquè surtin ben escrits a la transcripció i al resum.
- Consell: posa el mòbil al mig de la taula, a prop de qui parla més fluix, i no el tapis.

## Revisar la feina d'algú

A la pantalla Gravar, toca **«📝 Revisa una feina (dicta correccions)»**. Escriu per a qui és (i el seu correu, si vols enviar-l'hi) i què revises. Grava't mentre repasses la feina i digues el que cal canviar: on és (pàgina, apartat), què i com. Pots afegir fotos de la feina durant la revisió.

En acabar, Xiu-xiu en fa un document net: valoració general, **correccions a fer** ordenades per apartat (marcant les importants), suggeriments, el que està bé, dubtes i termini. El botó **«✉️ Envia-ho a …»** ja porta el correu de la persona preparat (sense la transcripció).

Si no l'acabes d'una tirada, toca **«➕ Continua aquesta revisió»** (un altre moment o un altre dia): el que diguis s'afegeix al mateix document i se'n refà el resum amb tot. També funciona amb les reunions («➕ Continua gravant aquí»).

## Enviar el resum a altres persones

A cada reunió hi ha el botó **«👥 Envia a altres persones»**: escrius les adreces (o tries les que ja has fet servir) i el resum els arriba amb format, enviat des del teu compte. Pots adjuntar-hi la transcripció. Les respostes et tornen a tu.

> Si l'script de Google és d'abans d'aquesta funció, cal actualitzar-lo: enganxa-hi el codi nou d'`apps-script/Code.gs` (mantenint el teu `SECRET`), desa, i ves a **Implementa > Gestiona les implementacions > ✏️ > Versió: Versió nova > Implementa**. L'URL no canvia.

## Fotos de documents

Si a la reunió parleu d'un document (notes escrites a mà, un esquema, un pressupost…), toca **«📷 Foto d'un document»** mentre graves. L'app guarda en quin minut s'ha fet. En fer el resum, Gemini llegeix les fotos juntament amb la transcripció, les relaciona amb el que es deia i afegeix una secció **«Documents comentats»**. El que no es llegeixi bé surt marcat com a [dubte de comprensió]. També pots afegir fotos després, des de la reunió guardada, i tocar «Refés l'acta».

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
A la pantalla de gravar, **«📂 Importa àudios o vídeos»** fa el resum d'una gravació que ja tens: una nota de veu, un àudio de WhatsApp (desa'l abans a *Fitxers*), una gravació de Zoom o Teams, un MP3, M4A, WAV, OGG, MP4… Els fitxers grans es pugen a Google per transcriure'ls.

Pots triar **diversos fitxers alhora** (fins a 30): es transcriuen per ordre de nom (les notes de veu porten la data i l'hora al nom) i se'n fa **un sol resum conjunt**.

Als àudios importats, Xiu-xiu millora el so abans de transcriure'ls (si duren menys de 15 minuts) i en fa un **resum curt**: resum, una línia per àudio, punts clau i tasques. Si el vols complet, desmarca «Resum curt per als àudios importats» a Ajustos > Resums.

En importar, Xiu-xiu et pregunta què vols: **«Fes-ne el resum»** o **«Només el text»**. «Només el text» et dona la transcripció neta (sense crosses ni repeticions, amb puntuació i paràgrafs, però sense escurçar res), per copiar-la a un document o passar-la a un assistent com Claude. Si després vols el resum, toca «⋯ > Refés el resum».

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
  js/                El codi, per temes (es carreguen en aquest ordre)
    core.js          Configuració, utilitats, Markdown i base de dades (IndexedDB)
    ai.js            Gemini: transcripció, resum, acta professional i documents
    pipeline.js      Cua de feina, correu automàtic, importar (àudio, vídeo, YouTube), etiquetes, privadesa
    recording.js     Gravació (micròfon i videotrucada) i «gravar amb un toc»
    home.js          Navegació, inici, historial, tasques, calendari, recull i preguntes
    result.js        Pantalla de l'acta: versions, transcripció, mapa, noms, correccions, preguntes, anàlisi
    share.js         PDF, Word, Markdown, enviar a altres persones i correus de seguiment
    settings.js      Ajustos, plantilles, còpia de seguretat, actualitzacions i compte de Google
    main.js          Esdeveniments generals i arrencada
  style.css
  sw.js              Funcionament sense connexió
  manifest.webmanifest
  icons/
tests/               Proves automàtiques (node tests/e2e.mjs) i de gravació a l'iPhone
apps-script/Code.gs  Script del full de Google: correu + registre de reunions i tasques
```

---
*Xiu-xiu by Oriolbop*
