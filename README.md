# Reunions: resums automàtics de reunions des de l'iPhone

App web per a l'iPhone (s'instal·la a la pantalla d'inici com una app normal), **sense cap clau de pagament**. Fa això:

1. **Grava** la reunió amb el micròfon de l'iPhone.
2. **Transcriu** l'àudio mentre graves, en trams de 5 minuts, amb **Gemini de Google** (nivell gratuït). Entén català i castellà, encara que es barregin.
3. En acabar, Gemini en fa un **resum estructurat**: resum, punts tractats, decisions, tasques amb responsable i termini, temes oberts i dades clau.
4. **T'envia el resum per correu automàticament** a `oriol@esportec.cat`, amb la transcripció completa adjunta.
5. **Ho desa tot en un full de Google Sheets**: a la pestanya *Reunions* hi ha cada reunió amb el seu resum i la transcripció, i a la pestanya *Tasques* hi ha totes les tasques, amb una casella per marcar-les com a fetes.

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

El nivell gratuït de Gemini té un límit de peticions diàries. Cada hora de reunió en fa unes 13, de manera que dona per a moltes reunions cada dia. Si algun dia s'esgota, l'app ho avisa i ho reprèn sola l'endemà.

> ⚠️ **Privadesa:** al nivell gratuït, Google pot fer servir el contingut que s'hi envia (l'àudio i les transcripcions) per millorar els seus productes, i el pot revisar personal humà. Per a reunions amb informació confidencial, tens dues opcions:
> - Activar la facturació al projecte d'AI Studio. Llavors Google deixa de fer-ho servir, i el cost seria de cèntims per reunió.
> - Triar a Configuració **«Dictat de l'iPhone»**. Així l'àudio no surt del mòbil cap a Gemini, tot i que la transcripció en text sí que s'envia per fer el resum. És menys precís.

## Posada en marxa (uns 10 minuts, només el primer cop)

### 1. Clau de Gemini (gratuïta)

1. Entra a https://aistudio.google.com/apikey amb un compte de Google.
2. **Create API key**. Copia la clau, que comença per `AIza…`.

> Si el compte d'esportec.cat no hi pot entrar perquè l'administrador de Workspace ho té desactivat, fes servir un compte de Gmail personal: funciona igual.

### 2. Full de Google Sheets (correu + registre)

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

### 4. Instal·lar-la a l'iPhone

1. Obre l'adreça amb **Safari**.
2. Botó **Compartir > Afegeix a la pantalla d'inici**.
3. Obre l'app des de la icona **Reunions**, ves a ⚙️ **Configuració** i omple:
   - URL i clau secreta de l'script del full
   - Clau de Gemini
4. Prem **Envia un correu de prova** i **Comprova la clau**. Si tot surt amb ✓, ja la pots fer servir.

## Ús

1. Obre l'app, escriu el títol i qui hi ha a la reunió (opcional) i toca el **botó vermell**.
2. Deixa l'iPhone damunt la taula **amb l'app oberta i la pantalla encesa**.
3. En acabar, toca **Acaba la reunió**. En un minut o dos tindràs el resum a la pantalla, al correu i al full de càlcul.

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
