# Amic invisible: tauler de desitjos

Un tauler perquè cada persona del grup escrigui què li agradaria rebre. Els altres veuen aquestes llistes i poden marcar un desig («El regalo jo») **sense que ningú sàpiga qui l'ha marcat**.

- **Tu no veus mai si algú ha marcat res de la teva llista.** El servidor ni tan sols envia aquesta informació al teu mòbil.
- Els altres només veuen «Ja està agafat», mai qui l'ha agafat. Així no es regala dues vegades el mateix.
- Qui l'ha marcat veu «El regales tu» i el pot desmarcar.
- Cada desig pot tenir un enllaç i un preu aproximat. Es poden editar i esborrar.

## Accés: un enllaç per persona

No cal crear cap compte ni instal·lar res. Cada persona rep **el seu enllaç personal** (per WhatsApp, per exemple) i, en obrir-lo, ja hi és dins. El mòbil se'n recorda per a la propera vegada.

L'enllaç porta un codi de 6 lletres (`…/exec?codi=K7MPQ2`). Si algú el perd, pot obrir l'enllaç general i escriure-hi el codi.

> Cadascú ha de rebre només el seu enllaç: qui tingui l'enllaç d'una altra persona podria veure què li han marcat.

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

- Què ha marcat cadascú es desa a la pestanya **Marques**, que està **amagada**. No la mostris.
- Fins i tot allà, qui ha marcat es desa xifrat (no hi surt cap nom), i els desitjos s'identifiquen amb un codi, no amb el text.

### Canvis més endavant

- **Canviar noms o afegir-ne:** edita `PARTICIPANTS`, desa i torna a executar `prepara`. Qui ja hi era conserva el seu codi i el seu enllaç.
- **Canviar el codi de la pàgina:** enganxa el codi nou, desa, i ves a **Implementa > Gestiona les implementacions > ✏️ > Versió: Versió nova > Implementa**. L'enllaç no canvia.
- **Si algú ha perdut el codi:** el tens a la pestanya Participants.

## Proves

```
node tests/amic-invisible.mjs
```

Executa el `Code.gs` real amb un Google Sheets simulat i obre la pàgina a Chromium amb tres persones: entrar amb l'enllaç o amb el codi, afegir, marcar, que el propietari no en vegi res, que no es pugui marcar dues vegades, desmarcar, editar i esborrar.
