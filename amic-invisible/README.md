# Amic invisible: tauler de temes de regal

Un tauler on cada persona del grup escriu **2 temes de regal**, els que vulgui (p. ex. «Cuina» i «Japó»). Els altres llegeixen els temes de cadascú i **trien una persona: serà a qui regalen**. Com interpreta els 2 temes, ho decideix qui regala. Ningú sap qui l'ha triat.

- **Tu no saps si algú t'ha triat, ni qui.** El servidor ni tan sols envia aquesta informació al teu mòbil.
- Els altres només veuen «Ja està triada», mai qui l'ha triada. Cada persona només la pot triar algú.
- **Cadascú tria una sola persona.** Qui tria veu «Regales a …» amb els 2 temes, i pot desfer-ho o canviar-ho mentre quedin persones lliures.
- El tauler evita que l'última persona es quedi sense ningú a qui regalar: si una tria ho provocaria, demana que se'n triï una altra.

## Accés: un enllaç per persona

No cal crear cap compte ni instal·lar res. Cada persona rep **el seu enllaç personal** (per WhatsApp, per exemple) i, en obrir-lo, ja hi és dins. El mòbil se'n recorda per a la propera vegada.

L'enllaç porta un codi de 6 lletres (`…/exec?codi=K7MPQ2`). Si algú el perd, pot obrir l'enllaç general i escriure-hi el codi.

> Cadascú ha de rebre només el seu enllaç: qui tingui l'enllaç d'una altra persona podria veure a qui regala.

## Cost: 0 €

Tot funciona amb un full de Google Sheets i Apps Script, amb el teu compte de Google.

## Com posar-lo en marxa (uns 5 minuts)

1. Crea un full de càlcul nou a [Google Sheets](https://sheets.new) (p. ex. «Amic invisible»).
2. Menú **Extensions > Apps Script**. Esborra el que hi hagi a `Code.gs` i enganxa-hi [`Code.gs`](Code.gs).
3. Al costat de «Fitxers», prem **+ > HTML**, posa-li de nom `Index` (sense `.html`) i enganxa-hi [`Index.html`](Index.html).
4. A dalt de `Code.gs`, escriu els noms a `PARTICIPANTS` i canvia l'`AVIS` (pressupost, data de l'intercanvi…). Desa (💾).
5. **Implementa > Nova implementació >** ⚙️ **Aplicació web**
   - Executa com a: **Jo**
   - Qui hi té accés: **Qualsevol**
   - Prem **Implementa** i accepta els permisos (si surt «Google no ha verificat aquesta aplicació», prem *Configuració avançada > Ves a … (no segur)*: l'aplicació és teva).
6. A l'editor, tria la funció **`prepara`** i prem **Executa**.
7. Torna al full: a la pestanya **Participants** hi ha l'enllaç personal de cadascú. Envia a cada persona el seu.

### Si hi participes tu també

Tu tens accés al full, però pots jugar igual sense fer trampes sense voler:

- Qui ha triat cada persona es desa a la pestanya **Tries**, que està **amagada**. No la mostris.
- Fins i tot allà, qui ha triat es desa xifrat (no hi surt cap nom), i els temes s'identifiquen amb un codi, no amb el text.

### Canvis més endavant

- **Canviar noms o afegir-ne:** edita `PARTICIPANTS`, desa i torna a executar `prepara`. Qui ja hi era conserva el seu codi i el seu enllaç.
- **Canviar el codi de la pàgina:** enganxa el codi nou, desa, i ves a **Implementa > Gestiona les implementacions > ✏️ > Versió: Versió nova > Implementa**. L'enllaç no canvia.
- **Si algú ha perdut el codi:** el tens a la pestanya Participants.

## Proves

```
node tests/amic-invisible.mjs
```

Executa el `Code.gs` real amb un Google Sheets simulat i obre la pàgina a Chromium amb tres persones: entrar amb l'enllaç o amb el codi, escriure i canviar els 2 temes, triar, que la persona triada no en sàpiga res, que no es pugui triar dues vegades, canviar i desfer la tria, i que l'última persona no es quedi sense ningú a qui regalar.
