# Secretari: el teu assistent per WhatsApp

Un contacte de WhatsApp a qui escrius com si fos un secretari:

| Tu li dius… | Ell… |
|---|---|
| «Dentista dijous a les 10» | Ho apunta al Google Calendar i t'avisa 30 min abans |
| «Reunió amb l'Ignasi dimarts de 9 a 11 a l'oficina, avisa'm el dia abans» | Cita amb lloc i avís el dia abans |
| «Recorda'm a les 6 que truqui a la gestoria» | Tasca per avui i un WhatsApp a les 18:00 |
| «He de preparar el pressupost de l'Ajuntament» | Tasca pendent, que surt al resum cada dia fins que diguis «fet» |
| «Gimnàs cada dilluns i dimecres a les 8 del vespre» | Cita que es repeteix |
| «Què tinc demà?» / «Quan és el dentista?» | Et respon mirant l'agenda |
| «Passa el dentista a divendres» / «Anul·la el sopar» | Ho mou o ho esborra |
| «Ja he trucat a la gestoria» | Marca la tasca com a feta ✅ |
| 🎤 Una nota de veu | L'escolta i fa el mateix |
| 📷 La foto d'una convocatòria, un cartell o un PDF | N'apunta les dates |

A més, **cada matí a les 8** t'envia l'agenda del dia i les tasques pendents, i **cada vespre a les 21 h** et fa un repàs del que ha quedat per fer i del que tens l'endemà.

Tot es desa al **teu Google Calendar**: les cites com a esdeveniments normals i les tasques com a esdeveniments de tot el dia que comencen per «☐» (quan les acabes, «✅»). Ho veus i ho pots tocar des de l'app de Calendar com sempre. Les cites que hi apuntis a mà també te les recorda.

## Com funciona

```
WhatsApp ──► Meta (API oficial de WhatsApp) ──► Script de Google (Secretari.gs) ──► Google Calendar
                                                       │
                                                       └──► Gemini: entén el missatge i decideix què fer
```

- **L'API oficial de WhatsApp de Meta**. El secretari té **el seu propi número**: és un contacte més del teu WhatsApp. No toca el teu compte personal i Meta no te'l pot bloquejar.
- **Google Apps Script**, amb el teu compte de Google: rep els missatges, apunta les coses al Calendar i envia els avisos. No cal cap servidor.
- **Gemini** (la mateixa clau gratuïta que fas servir a Xiu-xiu).

## Cost

| Peça | Cost |
|---|---|
| Apps Script i Google Calendar | Gratuït |
| Gemini, nivell gratuït | Gratuït. Cada missatge gasta 1 petició. |
| Respostes del secretari quan li escrius tu | Gratuït |
| Avisos i resums quan fa més de 24 h que no li has escrit | Uns 2 cèntims cadascun (plantilla «utility» a Espanya) |

WhatsApp només deixa que una empresa t'escrigui lliurement fins a **24 hores després del teu darrer missatge**. Si fa més temps, els avisos s'envien amb una **plantilla aprovada** (pas 5), que Meta cobra. Si li escrius cada dia, gairebé tot és gratuït. Com a molt, uns pocs euros al mes. Si WhatsApp falla, l'avís t'arriba **per correu**.

> ⚠️ **Privadesa:** al nivell gratuït de Gemini, Google pot fer servir el que li envies per millorar els seus productes. Si hi apuntes coses confidencials, activa la facturació al projecte d'AI Studio (cèntims al mes per a aquest ús).

## Posada en marxa (uns 30 minuts, només el primer cop)

### 1. L'script de Google

1. Entra a https://script.new amb el compte de Google del teu calendari. Anomena el projecte **Secretari**.
2. Esborra el que hi hagi i enganxa-hi [`Secretari.gs`](Secretari.gs). Desa (💾).
3. **Implementa > Nova implementació >** ⚙️ **Aplicació web**
   - *Executa com a:* **Jo**
   - *Qui hi té accés:* **Qualsevol**
4. Accepta els permisos (Calendar, correu, connexions externes). Si surt «Google no ha verificat aquesta aplicació»: *Configuració avançada > Ves a Secretari (no segur)*. L'script és teu.
5. Copia l'**URL de l'aplicació web** (acaba en `/exec`).

> Si a «Qui hi té accés» no surt *Qualsevol*, l'administrador de Workspace d'esportec.cat ho té limitat. Fes-ho amb un compte de Gmail personal i comparteix-hi el calendari de la feina (a l'script, posa'n l'ID a `CALENDAR_ID`).

### 2. L'app de WhatsApp a Meta

1. Entra a https://developers.facebook.com amb el teu Facebook i fes-te **compte de desenvolupador** (és gratuït).
2. **Les meves apps > Crea una app >** tipus **Empresa** (*Business*). Si et demana un portfoli empresarial, crea'n un (pot ser a nom teu).
3. A l'app, **Afegeix producte > WhatsApp > Configura**.
4. A **WhatsApp > Configuració de l'API** (*API Setup*):
   - Meta et dona un **número de prova** gratuït. Per a ús personal ja va bé. Si prefereixes un número «de veritat» (p. ex. una SIM de prepagament o un fix que no tingui WhatsApp), afegeix-lo amb **Afegeix un número de telèfon**.
   - Copia el **Phone number ID** (identificador del número, no el número).
   - Si fas servir el número de prova: a **Per a (To)**, afegeix **el teu mòbil** i verifica'l amb el codi que t'arriba.
   - Prem **Envia el missatge**: t'ha d'arribar un «Hello World» al WhatsApp. Desa aquest xat: és el teu secretari. Pots canviar-li el nom a l'agenda del mòbil.

### 3. Token permanent

El token que surt a *API Setup* caduca en 24 hores. Per fer-ne un de permanent:

1. Ves a https://business.facebook.com/settings > **Usuaris > Usuaris del sistema > Afegeix**. Nom: `secretari`, rol **Administrador**.
2. **Assigna actius**: l'app (control total) i el **compte de WhatsApp** (control total).
3. **Genera un token**: tria l'app, caducitat **Mai**, i marca els permisos `whatsapp_business_messaging` i `whatsapp_business_management`.
4. Copia el token (comença per `EAA…`). Només es mostra un cop.

### 4. Les claus a l'script

A l'script: ⚙️ **Configuració del projecte > Propietats de l'script > Afegeix**:

| Propietat | Valor |
|---|---|
| `GEMINI_KEY` | La clau de Gemini (`AIza…`) |
| `WA_TOKEN` | El token permanent (`EAA…`) |
| `WA_PHONE_ID` | El *Phone number ID* |
| `WA_VERIFY` | Una paraula inventada, p. ex. `secretari-taronja-27` |
| `MY_NUMBER` | El teu mòbil amb el prefix, sense `+` ni espais: `34600111222` |
| `WEBHOOK_KEY` | *(Recomanat)* Una altra frase inventada, p. ex. `x7k9-pinya-2026` |
| `CALENDAR_ID` | *(Opcional)* Si no vols fer servir el calendari principal: Calendar > ⚙️ > el calendari > *ID del calendari* |

El secretari **només fa cas dels missatges del teu número**.

### 5. Connectar WhatsApp amb l'script (webhook)

1. A Meta, **WhatsApp > Configuració** (*Configuration*) **> Webhook > Edita**:
   - **URL de devolució de trucada:** l'URL de l'script seguit de `?k=` i la teva `WEBHOOK_KEY`:
     `https://script.google.com/macros/s/…/exec?k=x7k9-pinya-2026`
   - **Token de verificació:** el mateix que has posat a `WA_VERIFY`.
   - **Verifica i desa.**
2. A **Camps del webhook**, **subscriu-te** a `messages`.
3. Envia «Hola» al secretari des del teu WhatsApp. T'ha de respondre en uns segons.

### 6. Plantilla per als avisos

Perquè els avisos t'arribin encara que faci més d'un dia que no li escrius:

1. https://business.facebook.com/wa/manage/message-templates **> Crea una plantilla**
   - Categoria: **Utilitat** (*Utility*)
   - Nom: `recordatori`
   - Idioma: **Català**
   - Cos: `Recordatori de la teva agenda: {{1}}` (com a exemple de `{{1}}`: `Dentista dijous a les 10:00`)
2. Envia-la a revisió. Normalment s'aprova en pocs minuts.

Mentre no estigui aprovada, els avisos fora de les 24 h t'arriben per correu.

### 7. Activar-ho

1. A l'script, tria la funció **`configura`** a dalt i prem **Executa**. Crea els avisos automàtics (cada 5 minuts, el resum del matí i el del vespre) i t'envia un missatge de benvinguda.
2. Llest! 🎉

## Ajustos

A dalt de `Secretari.gs`:

| Ajust | De sèrie | Què fa |
|---|---|---|
| `AVIS_PER_DEFECTE` | `30` | Minuts abans de cada cita que t'avisa (`-1` = cap avís) |
| `HORA_RESUM_MATI` | `8` | Hora del resum del matí (`null` = cap) |
| `HORA_RESUM_VESPRE` | `21` | Hora del repàs del vespre (`null` = cap) |
| `DIES_AGENDA` | `30` | Quants dies endavant té en compte en respondre |

Per a una cita concreta, només cal demanar-ho: «avisa'm una hora abans», «no cal que m'avisis».

Després de canviar els ajustos o d'enganxar-hi una versió nova del codi: desa, torna a executar **`configura`** i fes **Implementa > Gestiona les implementacions > ✏️ > Versió: Versió nova > Implementa**. L'URL no canvia i les claus es conserven.

## Si alguna cosa no va

- **No respon:** a l'script, menú de l'esquerra **Execucions**: hi veuràs cada missatge rebut i l'error, si n'hi ha. Si no hi surt cap `doPost`, Meta no arriba a l'script: revisa l'URL del webhook (amb el `?k=…`) i que estiguis subscrit a `messages`. Després afegeix la propietat `WA_ACCOUNT_ID` (el número que surt després de `waba_id=` a l'adreça de https://business.facebook.com/wa/manage/home/) i executa **`connectaWhatsApp`**: ha de dir `200 {"success":true}`.
- **La resposta t'arriba per correu amb «Object with ID … does not exist»:** el `WA_PHONE_ID` no és bo. Amb `WA_ACCOUNT_ID` posat, executa **`trobaNumero`**: el busca i el desa sol.
- **«Falta la propietat de l'script…»:** revisa el pas 4 (els noms en majúscules, exactes).
- **Error 401 de WhatsApp:** el token ha caducat o no té els permisos del pas 3.
- **Error 131047 o els avisos arriben per correu:** fa més de 24 h que no li has escrit i la plantilla encara no està aprovada (pas 6).
- **Prova sense WhatsApp:** executa `provaSecretari`. Al registre veuràs què respondria a «Què tinc aquesta setmana?».
