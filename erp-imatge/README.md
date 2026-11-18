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

3. Per tornar enrere: treure aquesta línia.

Recomanat: provar-ho primer amb un sol usuari o en una còpia de la carpeta.
