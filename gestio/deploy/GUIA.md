# Guia: posar la plataforma a internet gratis

Acabaràs amb la plataforma a **https://topgreentowers.duckdns.org**, funcionant 24 h i amb una còpia de seguretat cada nit.

- **Cost:** 0 €. Fa servir el nivell *Always Free* de Google Cloud i DuckDNS.
- **Temps:** uns 30 minuts, només el primer cop.

---

## Pas 1 · DuckDNS (l'adreça web) — 5 minuts

1. Entra a **https://www.duckdns.org** i inicia sessió amb el teu compte de Google (botó *google* a dalt a la dreta).
2. A *sub domain*, escriu **topgreentowers** i prem **add domain**.
3. A dalt de tot hi ha el teu **token**: una cadena llarga del tipus `a1b2c3d4-....`.
   - El necessitaràs al pas 4.
   - **No l'enviïs a ningú:** qui el tingui pot canviar on apunta la teva adreça.

El camp *current ip* el pots deixar com estigui: l'omplirà el servidor.

---

## Pas 2 · Compte de Google Cloud — 10 minuts

1. Entra a **https://console.cloud.google.com** amb el teu compte de Google.
2. Accepta les condicions. Si et proposa la **prova gratuïta**, activa-la.
   - Et demanarà una targeta. És per verificar el compte: **no et cobraran res** si només fas servir el que diu aquesta guia.
   - La prova regala 300 $ durant 90 dies. Quan acaba, la màquina *e2-micro* continua sent gratuïta per sempre.
3. A dalt, al selector de projecte, crea un **projecte nou** anomenat `gestio`.
4. **Recomanat:** posa una alerta de despesa perquè t'avisi si mai es cobra alguna cosa.
   - Ves a *Menú ☰ > Facturació > Pressupostos i alertes > Crear pressupost*.
   - Import: **1 €**.

---

## Pas 3 · Crear el servidor — 5 minuts

Ves a *Menú ☰ > Compute Engine > Instàncies de VM*. El primer cop, prem **Habilitar** i espera un minut. Després prem **Crear instància** i omple el formulari així:

| Camp | Valor |
|---|---|
| Nom | `gestio` |
| Regió | **us-central1 (Iowa)**. També valen us-west1 i us-east1. Altres regions, com les d'Europa, **no són gratuïtes**. |
| Sèrie / tipus de màquina | **E2** → **e2-micro** |
| Disc d'arrencada (*Sistema operatiu i emmagatzematge > Canvia*) | Sistema: **Debian 12**. Tipus de disc: **Disc persistent estàndard** ⚠️. Mida: **30 GB**. |
| Tallafoc (*Xarxa*) | ✅ **Permet el trànsit HTTP** i ✅ **Permet el trànsit HTTPS** |

> ⚠️ **Important:** el disc que surt per defecte és «equilibrat», i aquest **es paga**. Canvia'l a **estàndard**.
>
> El preu estimat que surt a la dreta del formulari (uns 7 $/mes) no té en compte el descompte del nivell gratuït. És normal que surti.

Prem **Crear**. En un minut tindràs la màquina funcionant.

---

## Pas 4 · Instal·lar la plataforma — 10 minuts

1. A la llista d'instàncies, a la fila de `gestio`, prem el botó **SSH**. S'obrirà una finestra negra: és el terminal del servidor.
2. Copia aquesta ordre, enganxa-la a la finestra i prem Retorn:

   ```bash
   curl -fsSLo instala.sh https://raw.githubusercontent.com/oriol-cmd/projectes-Oriol/claude/elegant-curie-fx9lna/gestio/deploy/instala.sh
   ```

3. Després copia aquesta, enganxa-la i prem Retorn:

   ```bash
   sudo bash instala.sh
   ```

4. Respon les dues preguntes que et farà:
   - **Subdomini:** prem Retorn per acceptar `topgreentowers`.
   - **Token:** enganxa el token de DuckDNS i prem Retorn. Mentre l'enganxes no es veu res a la pantalla; és normal.
5. Espera uns 5 minuts. Quan acabi, veuràs **✅ Tot a punt!**

---

## Pas 5 · Primer accés

1. Obre **https://topgreentowers.duckdns.org**. Si el primer cop dona error, espera un minut i torna-ho a provar: s'està creant el certificat de seguretat.
2. Crea l'**usuari administrador**, amb una contrasenya llarga.
3. A **Configuració**, omple:
   - **Empresa:** dades fiscals i logotip.
   - **Correu:** perquè els correus surtin de debò. Amb Gmail:
     - servidor `smtp.gmail.com`, port `587`;
     - usuari: la teva adreça;
     - contrasenya: una [contrasenya d'aplicació](https://myaccount.google.com/apppasswords).

     Després prem *Envia un correu de prova*.
   - **Plantilla de factura:** el disseny i els colors.

Ja està! 🎉

---

## Manteniment

Totes aquestes ordres s'escriuen a la finestra **SSH** del servidor.

| Vull… | Què he de fer |
|---|---|
| Actualitzar a la versió nova | `sudo gestio-actualitza` |
| Veure què està passant (errors) | `sudo journalctl -u gestio -f` (per sortir, Ctrl+C) |
| Reiniciar la plataforma | `sudo systemctl restart gestio` |
| Veure les còpies de cada nit | `ls /var/backups/gestio` (es guarden les dels últims 14 dies) |
| Descarregar una còpia al meu ordinador | A la plataforma: **Configuració > Còpia de seguretat > Descarrega**. Fes-ho cada mes i guarda-la al Drive. |

### Recuperar una còpia de seguretat

Si mai has de restaurar una còpia (per exemple, `gestio-2026-11-18_0330.tar.gz`), escriu aquestes ordres a la finestra SSH, una per una:

```bash
sudo systemctl stop gestio
```

```bash
sudo tar xzf /var/backups/gestio/gestio-2026-11-18_0330.tar.gz -C /var/lib/gestio
```

```bash
sudo rm -f /var/lib/gestio/gestio.db-wal /var/lib/gestio/gestio.db-shm
```

```bash
sudo chown -R gestio:gestio /var/lib/gestio
```

```bash
sudo systemctl start gestio
```

Si la còpia l'havies descarregat al teu ordinador, primer puja-la al servidor amb el botó ⚙️ **Puja el fitxer** de la finestra SSH. Després, a la segona ordre, posa `~/nom-del-fitxer.tar.gz` en lloc de la ruta `/var/backups/...`.

### Si alguna cosa no va

- **No s'obre l'adreça o diu que no és segura:**
  - comprova que la instància té marcats *Permet el trànsit HTTP/HTTPS*;
  - mira a duckdns.org que la *current ip* és la mateixa que la *IP externa* de la instància;
  - consulta l'estat de l'HTTPS amb `sudo journalctl -u caddy -n 30`.
- **Ha canviat la IP del servidor:** no cal fer res. Cada 5 minuts el servidor avisa DuckDNS de la seva IP.
- **Els correus no surten:** mira *Correus enviats*. Si hi diu *error*, posa el ratolí a sobre i veuràs el motiu.

---

## Bo de saber

- **Les dades són al servidor**, a `/var/lib/gestio`. El codi de la plataforma és en un repositori públic de GitHub, però les dades (clients, treballadors, factures…) no hi són mai.
- La màquina gratuïta té **1 GB de memòria**, que és suficient per a aquesta plataforma i uns quants usuaris alhora.
- Google només inclou **1 GB al mes de trànsit de sortida** gratuït. Amb aquest ús n'hi ha de sobres, però evita pujar-hi vídeos o fitxers molt grans per compartir.
- Si més endavant vols una adreça pròpia (com `gestio.topgreentowers.cat`):
  1. compra el domini (uns 10–20 € l'any);
  2. fes que apunti a la IP del servidor;
  3. canvia la primera línia de `/etc/caddy/Caddyfile` pel domini nou;
  4. a la plataforma, posa l'adreça nova a *Configuració > Correu > Adreça pública*.
