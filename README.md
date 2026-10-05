# Reunions: resums automàtics de reunions des de l'iPhone

App web per a l'iPhone (s'instal·la a la pantalla d'inici com una app normal) que:

1. **Grava** la reunió amb el micròfon de l'iPhone.
2. **Transcriu** l'àudio mentre graves, en trams de 5 minuts, amb el model `gpt-4o-transcribe` d'OpenAI. Entén català i castellà, encara que es barregin.
3. En acabar, en fa un **resum estructurat amb Claude**: resum, punts tractats, decisions, tasques amb responsable i termini, temes oberts i dades clau.
4. **T'envia el resum per correu automàticament** a `oriol@esportec.cat`, amb la transcripció completa adjunta.

Altres funcions:
- Pots posar el títol i els assistents de la reunió, i el resum en surt més precís.
- Botó per **marcar moments importants** durant la reunió.
- Pausa i represa de la gravació.
- **Historial** de reunions, amb opcions per tornar a enviar el resum, refer-lo o copiar-lo.
- **No es perd res**: l'àudio es desa al mòbil. Si et quedes sense cobertura o tanques l'app, en tornar a obrir-la continua on s'havia quedat.
- La pantalla es manté encesa mentre grava.

## Posada en marxa (uns 15 minuts, només el primer cop)

### 1. Claus d'API

| Servei | Per a què | On aconseguir-la | Cost aproximat |
|---|---|---|---|
| OpenAI | Transcripció | https://platform.openai.com/api-keys | ~0,35 $ per hora de reunió |
| Anthropic | Resum (Claude) | https://console.anthropic.com/settings/keys | ~0,10–0,20 $ per reunió |

Totes dues necessiten una mica de saldo de prepagament (amb 10 $ en tens per a moltes reunions).

> Si no vols fer servir OpenAI, a Configuració pots triar el motor **«Dictat de l'iPhone»**, que és gratuït però força menys precís i va pitjor en reunions llargues.

### 2. Enviament de correu (Google Apps Script)

Així el correu surt del teu mateix compte de Google, sense cap servei extern.

1. Entra a https://script.google.com amb el compte `oriol@esportec.cat` i fes **Projecte nou**.
2. Esborra el contingut i enganxa-hi el fitxer [`apps-script/Code.gs`](apps-script/Code.gs).
3. A la línia `const SECRET = '...'`, posa-hi una frase llarga inventada (p. ex. `reunions-taronja-2026-x7k9`). Desa.
4. A dalt, tria la funció `autoritza` i prem **Executa**. Accepta els permisos de Gmail. Si surt «Google no ha verificat aquesta aplicació», ves a *Configuració avançada > Ves a… (no segur)*: l'script és teu.
5. **Implementa > Nova implementació > Tipus: Aplicació web**
   - *Executa com a:* **Jo**
   - *Qui hi té accés:* **Qualsevol**
6. Copia l'**URL de l'aplicació web**, que acaba en `/exec`.

> Si a l'opció «Qui hi té accés» no surt *Qualsevol*, és que l'administrador de Google Workspace d'esportec.cat ho té limitat. Cal que ho permeti a la Consola d'administració (*Aplicacions > Google Workspace > Drive i Documents*, o la política d'Apps Script), o bé fer servir un compte de Gmail personal per a l'script.

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
   - URL i clau secreta de l'Apps Script
   - Clau d'OpenAI i clau d'Anthropic
4. Prem **Envia un correu de prova** i **Comprova les claus**. Si tot surt amb ✓, ja la pots fer servir.

## Ús

1. Obre l'app, escriu el títol i qui hi ha a la reunió (opcional) i toca el **botó vermell**.
2. Deixa l'iPhone damunt la taula **amb l'app oberta i la pantalla encesa**.
3. En acabar, toca **Acaba la reunió**. En menys d'un minut tindràs el resum a la pantalla i al correu.

### Important a l'iPhone
- **No bloquegis el mòbil ni canviïs d'app mentre grava.** L'iPhone talla el micròfon de les apps web quan passen a segon pla. L'app es manté la pantalla encesa sola. Si mai es talla, en tornar-hi reconnecta el micròfon i continua, però el tros que no s'ha gravat es perd.
- Si reps una trucada, la gravació es pausa. En tornar a l'app es reprèn.
- Per a reunions molt llargues, connecta el mòbil al carregador.

## Privadesa

- Les claus i les reunions es desen **només al teu iPhone**.
- L'àudio s'envia a OpenAI per transcriure'l i la transcripció a Anthropic per resumir-la. Per defecte, cap dels dos fa servir les dades de l'API per entrenar models.
- Un cop transcrit, l'àudio s'esborra del mòbil. A *Configuració > Avançat* pots triar conservar-lo.
- L'script de Google només envia correus a les adreces de la llista `ALLOWED_RECIPIENTS` i només si rep la clau secreta.

## Estructura

```
app/                 L'app web (HTML + JS, sense dependències)
  index.html
  app.js             Gravació, transcripció, resum i enviament
  style.css
  sw.js              Funcionament sense connexió
  manifest.webmanifest
  icons/
apps-script/Code.gs  Script de Google per enviar el correu
```
