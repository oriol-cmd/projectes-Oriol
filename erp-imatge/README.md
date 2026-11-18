# Nova imatge de l'ERP "Gestió de grups"

L'ERP actual (esportec.info) fa servir Bootstrap 3.3.5 + jQuery + `css/main.css`.
`esportec-2026.css` és una capa de disseny que es carrega **després** de `main.css`:
no toca cap PHP ni JavaScript, només l'aspecte.

## Instal·lació (5 minuts)

1. Pujar `esportec-2026.css` a la carpeta `css/` del servidor.
2. Al fitxer PHP que conté el `<head>` (la capçalera comuna de totes les pàgines, i `estades.php` per a la pantalla d'accés), afegir sota `main.css`:

   ```html
   <link href="css/esportec-2026.css" rel="stylesheet" type="text/css" />
   ```

3. Tipografia: crear la carpeta `css/fonts/` al servidor i pujar-hi
   `AkzidenzGrotesk-Bold.woff2` i `AkzidenzGrotesk-LightExtended.woff2`
   (versió web dels .otf de la carpeta del Drive "TIPOGRAFIA ESPORTEC").
   No es desen en aquest repositori perquè són fonts de pagament (Berthold).
   Si no hi són, l'ERP fa servir Helvetica/Arial i tot continua funcionant.
4. Per tornar enrere: treure aquesta línia.

Recomanat: provar-ho primer amb un sol usuari o en una còpia de la carpeta.

## Tipografia

- **Akzidenz-Grotesk Bold**: títols, menú, botons.
- **Akzidenz-Grotesk Light Extended**: etiquetes en majúscules (capçaleres de taula, filtres), com "OUTDOOR SPORT" al logo.
- **Inter** (Google Fonts, gratuïta): text corrent i taules, per llegibilitat.

Cal comprovar que la llicència d'Akzidenz-Grotesk permet l'ús web (@font-face).
