# Com vincular el mòbil i l'ordinador amb Google

Amb aquesta guia tindràs **les mateixes reunions, actes i configuració al mòbil i a l'ordinador** (i a qualsevol altre aparell), a través del teu compte de Google.

- Les reunions es guarden en una **carpeta privada i oculta del teu Google Drive** que només Xiu-xiu pot llegir.
- Es sincronitzen: reunions, actes, transcripcions, fotos, tasques fetes i la configuració (clau de Gemini, correu, script, plantilles, si ho deixes marcat).
- **No** es sincronitza l'àudio (ocupa massa).

Hi ha tres parts. La **part 1 només es fa un cop** i és millor fer-la des de l'ordinador (uns 10 minuts).

---

## Part 1 — Crear l'accés a Google (només un cop, des de l'ordinador)

### 1. Obre Google Cloud
1. Ves a **https://console.cloud.google.com** i entra amb el **mateix compte de Google** amb què faràs servir Xiu-xiu.
2. A dalt de tot, al costat del logotip, hi ha el **selector de projecte**. Tria el projecte que ja tens (normalment es diu **«Default Gemini Project»**, el va crear Google AI Studio) o crea'n un de nou anomenat **Xiu-xiu**.

### 2. Activa Google Drive
1. Al menú de l'esquerra: **APIs i serveis › Biblioteca** (*APIs & Services › Library*).
2. Cerca **Google Drive API**, obre-la i toca **Habilita** (*Enable*).

### 3. Configura la pantalla d'accés
1. Al menú: **APIs i serveis › Pantalla de consentiment d'OAuth** (pot sortir com **Google Auth Platform**).
2. Si et demana **Comença** (*Get started*):
   - **Nom de l'app:** `Xiu-xiu`
   - **Correu d'assistència:** el teu correu
   - **Públic** (*Audience*): **Extern** (*External*)
   - **Informació de contacte:** el teu correu
   - Accepta les condicions i **Crea**.
3. Ves a **Públic** (*Audience*) i toca **Publica l'app** (*Publish app*) › **Confirma**.
   - Xiu-xiu només demana accés a la seva carpeta oculta del Drive (*drive.appdata*), que Google considera un permís **no sensible**: no cal cap revisió de Google.
   - *Alternativa:* si prefereixes no publicar-la, deixa-la en mode **Prova** (*Testing*) i, a **Usuaris de prova** (*Test users*), afegeix el teu correu i el de les persones que la faran servir.

### 4. Crea el client (l'identificador)
1. Ves a **Clients** (o **Credencials › Crea credencials › ID de client d'OAuth**).
2. **Tipus d'aplicació:** **Aplicació web** (*Web application*). **Nom:** `Xiu-xiu web`.
3. A **Orígens de JavaScript autoritzats** (*Authorized JavaScript origins*) afegeix:
   ```
   https://oriol-cmd.github.io
   ```
4. A **URI de redirecció autoritzats** (*Authorized redirect URIs*) afegeix, **exactament així** (amb la «O» majúscula i la barra final):
   ```
   https://oriol-cmd.github.io/projectes-Oriol/
   ```
5. Toca **Crea**. Et sortirà l'**Identificador de client** (*Client ID*), que acaba en **`.apps.googleusercontent.com`**. **Copia'l.** (No cal el «secret del client».)

> Pot trigar uns minuts a funcionar després de crear-lo.

---

## Part 2 — Vincular el primer aparell (per exemple, el mòbil)

1. Obre Xiu-xiu i ves a **Ajustos › Compte i sincronització**.
2. Enganxa l'identificador a **«Identificador de client de Google»** i toca **Desa**.
3. Toca **Entra amb Google**, tria el teu compte i accepta.
4. Tornaràs a Xiu-xiu i posarà **«✅ Connectat com a …»**. Les reunions que ja tens es pugen al teu Drive.
5. Deixa marcat **«Desa també les claus al meu Drive»** si vols que a l'altre aparell no hagis de tornar a posar la clau de Gemini, el correu ni l'script.

> **Fes abans una còpia de seguretat** (Ajustos › Còpia de seguretat) per si de cas.

---

## Part 3 — Vincular l'ordinador (o qualsevol altre aparell)

1. Al mòbil, a **Ajustos › Compte i sincronització**, toca **«Copia l'enllaç per vincular un altre aparell»**.
2. Envia't l'enllaç (per correu o WhatsApp Web) i **obre'l a l'ordinador** amb **Chrome o Edge**.
3. A la pantalla de benvinguda (o a Ajustos) toca **Entra amb Google** amb **el mateix compte**.
4. En uns segons apareixeran totes les reunions i la configuració.

> **A l'iPhone o iPad:** si ja tens Xiu-xiu a la pantalla d'inici, l'enllaç s'obriria a Safari (que és «un altre aparell» per a l'iPhone). En aquest cas, obre Xiu-xiu des de la icona, ves a **Ajustos › Compte i sincronització** i enganxa-hi l'identificador a mà (el trobaràs a Google Cloud, o copia'l de l'enllaç: és el que hi ha després de `gcid=`).

A partir d'aquí, tot el que facis en un aparell surt a l'altre (es sincronitza en obrir l'app, cada 5 minuts i amb el botó **«Sincronitza ara»**).

---

## Altres persones (la teva parella, companys…)

Poden fer servir **el mateix identificador**: passa'ls l'enllaç de la part 3. Cadascú entra amb **el seu propi compte de Google** i només veu **les seves** reunions (cadascú té la seva carpeta oculta al seu Drive). Si has deixat l'app en mode **Prova**, afegeix-los com a usuaris de prova (part 1, pas 3).

---

## Si alguna cosa falla

| Missatge | Què fer |
|---|---|
| **redirect_uri_mismatch** | L'adreça del pas 4.4 no és exacta. Ha de ser `https://oriol-cmd.github.io/projectes-Oriol/` (amb «O» majúscula i barra final). |
| **Accés bloquejat / l'app no està verificada / access_denied** | Publica l'app (part 1, pas 3) o afegeix el teu correu com a usuari de prova. |
| **Error 403 en sincronitzar** | Comprova que has activat la **Google Drive API** (part 1, pas 2) al mateix projecte. |
| **Cal tornar a connectar amb Google** | Normal de tant en tant: toca **«Torna a connectar»**. |
| A l'iPhone, després d'entrar amb Google, s'obre Safari en lloc de Xiu-xiu | Tanca Safari, obre Xiu-xiu des de la icona i torna a tocar **Entra amb Google**. |

Si t'encalles, envia una captura de la pantalla on estàs.
