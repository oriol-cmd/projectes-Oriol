// Plantilles de documents (factura, pressupost i contracte)
// Colors, lletra i opcions surten de Configuració > Plantilles

const STYLE_BASE = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: {{{estil.font}}}; color: #1f2937; font-size: 13px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 16mm 15mm 24mm; margin: 0 auto; background: #fff; position: relative; }
  table { width: 100%; border-collapse: collapse; }
  .right { text-align: right; } .muted { color: #6b7280; }
  .lines th, .lines td { padding: 8px 6px; vertical-align: top; }
  .lines td:first-child { white-space: pre-wrap; }
  .lines .dte { color: {{{estil.color2}}}; font-weight: 600; }
  .totals td { padding: 4px 6px; }
  .totals .disc td { color: {{{estil.color2}}}; font-weight: 600; }
  .saving { text-align: right; margin-top: 6px; font-size: 12px; color: {{{estil.color2}}}; font-weight: 600; }
  .intro { margin: 0 0 18px; white-space: pre-wrap; line-height: 1.55; }
  .notes { margin-top: 20px; white-space: pre-wrap; }
  .tagline { font-size: 12px; color: {{{estil.color2}}}; margin-top: 4px; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 36px; page-break-inside: avoid; }
  .sign div { border-top: 2px solid {{{estil.color2}}}; padding-top: 8px; min-height: 90px; }
  .foot { position: absolute; bottom: 10mm; left: 15mm; right: 15mm; font-size: 10px; text-align: center; color: #6b7280; }
  @media print { .page { margin: 0; } @page { size: A4; margin: 0; } }
`;

// Blocs comuns a tots els dissenys
const LINES = `<table class="lines"><thead><tr><th>Concepte</th><th class="right">Quant.</th><th class="right">Preu</th>{{#if doc.te_dte_linia}}<th class="right">Dte.</th>{{/if}}{{#if opt.columna_iva}}<th class="right">IVA</th>{{/if}}<th class="right">Import</th></tr></thead>
  <tbody>{{#each linies}}<tr><td>{{descripcio}}</td><td class="right">{{quantitat}}</td><td class="right">{{preu}}</td>{{#if doc.te_dte_linia}}<td class="right dte">{{descompte}}</td>{{/if}}{{#if opt.columna_iva}}<td class="right">{{iva}}%</td>{{/if}}<td class="right">{{import}}</td></tr>{{/each}}</tbody></table>`;
const TOTALS = `<table class="totals">
    {{#if doc.te_descompte}}<tr><td>Subtotal</td><td class="right">{{doc.brut}}</td></tr><tr class="disc"><td>{{doc.descompte_text}}</td><td class="right">−{{doc.descompte}}</td></tr>{{/if}}
    <tr><td>Base imposable</td><td class="right">{{doc.base}}</td></tr>
    {{#each doc.ivas}}<tr><td>IVA {{tipus}}%</td><td class="right">{{quota}}</td></tr>{{/each}}
    <tr class="big"><td>TOTAL</td><td class="right">{{doc.total}}</td></tr></table>
  {{#if doc.estalvi_total}}<div class="saving">🎁 Estalvi aplicat: {{doc.estalvi}}</div>{{/if}}`;
const AFTER = `{{#if doc.te_senyal}}<div class="deposit"><b>Paga i senyal:</b> {{doc.senyal}} {{doc.senyal_estat}} · <b>Resta:</b> {{doc.pendent}}</div>{{/if}}
  {{#if doc.notes}}<div class="notes">{{doc.notes}}</div>{{/if}}
  {{#if doc.condicions}}<div class="notes muted">{{doc.condicions}}</div>{{/if}}
  {{#if empresa.pagament}}<div class="notes"><b>Forma de pagament:</b> {{empresa.pagament}}{{#if empresa.iban}} · IBAN {{empresa.iban}}{{/if}}</div>{{/if}}
  {{#if doc.signatura}}<div class="sign"><div><b>Conformitat del client</b><br><span class="muted">Nom, data i signatura</span></div><div><b>{{empresa.nom}}</b></div></div>{{/if}}
  <div class="foot">{{empresa.peu}}</div>`;
const INTRO = `{{#if doc.intro}}<div class="intro">{{doc.intro}}</div>{{/if}}`;
const COMPANY_LINES = `{{empresa.nom}}{{#if empresa.nif}} · NIF {{empresa.nif}}{{/if}}{{#if empresa.adreca}}<br>{{empresa.adreca}}{{/if}}{{#if empresa.poblacio}}<br>{{empresa.cp}} {{empresa.poblacio}}{{/if}}{{#if empresa.telefon}}<br>{{empresa.telefon}}{{/if}}{{#if empresa.email}}<br>{{empresa.email}}{{/if}}`;
const CLIENT_LINES = `<b>{{client.nom}}</b>{{#if client.nif}}<br>NIF/CIF: {{client.nif}}{{/if}}{{#if client.adreca}}<br>{{client.adreca}}{{/if}}{{#if client.poblacio}}<br>{{client.cp}} {{client.poblacio}}{{/if}}{{#if client.email}}<br>{{client.email}}{{/if}}`;
const SERVICE = `{{#if opt.caixa_servei}}{{#if activitat.data}}<div class="box"><h4>Servei</h4>{{activitat.titol}}<br>Data: {{activitat.data}} {{activitat.hora}}<br>Lloc: {{activitat.lloc}}</div>{{/if}}{{/if}}`;

const PRESETS = {
  classica: `<!doctype html><html><head><meta charset="utf-8"><title>{{doc.tipus}} {{doc.numero}}</title><style>${STYLE_BASE}
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid {{{estil.color}}}; padding-bottom: 14px; }
  .head img { max-height: {{{estil.logo_h}}}px; max-width: 240px; }
  h1 { color: {{{estil.color}}}; margin: 0; font-size: 28px; letter-spacing: 2px; }
  .boxes { display:flex; gap: 20px; margin: 22px 0; }
  .box { flex:1; border:1px solid #e5e7eb; border-radius:6px; padding:12px; }
  .box h4 { margin:0 0 6px; font-size: 11px; text-transform: uppercase; color: {{{estil.color}}}; }
  .lines thead th { background: {{{estil.color}}}; color:#fff; text-align:left; }
  .lines tbody td { border-bottom: 1px solid #e5e7eb; }
  .lines tbody tr:nth-child(even) td { background: color-mix(in srgb, {{{estil.color}}} 5%, white); }
  .totals { width: 45%; margin-left: auto; margin-top: 14px; }
  .totals .big td { font-size: 16px; font-weight: bold; border-top: 2px solid {{{estil.color}}}; color: {{{estil.color}}}; }
  .deposit { margin-top: 14px; padding: 10px 12px; background: color-mix(in srgb, {{{estil.color2}}} 10%, white); border-left: 4px solid {{{estil.color2}}}; }
  .foot { border-top: 1px solid #e5e7eb; padding-top: 6px; }
</style></head><body><div class="page">
  <div class="head">
    <div>{{#if empresa.logo}}<img src="{{empresa.logo}}" alt="logo">{{else}}<h2 style="margin:0;color:{{{estil.color}}}">{{empresa.nom}}</h2>{{/if}}
      {{#if opt.eslogan}}<div class="tagline">{{opt.eslogan}}</div>{{/if}}
      <div class="muted" style="margin-top:6px">${COMPANY_LINES}</div></div>
    <div class="right"><h1>{{doc.tipus}}</h1><div><b>Núm.:</b> {{doc.numero}}</div><div><b>Data:</b> {{doc.data}}</div>
      {{#if doc.venciment}}<div><b>{{doc.etiqueta_venciment}}:</b> {{doc.venciment}}</div>{{/if}}</div>
  </div>
  <div class="boxes"><div class="box"><h4>Client</h4>${CLIENT_LINES}</div>${SERVICE}</div>
  {{#if doc.titol}}<h3 style="color:{{{estil.color}}};margin:0 0 10px">{{doc.titol}}</h3>{{/if}}
  ${INTRO}${LINES}${TOTALS}${AFTER}
</div></body></html>`,

  moderna: `<!doctype html><html><head><meta charset="utf-8"><title>{{doc.tipus}} {{doc.numero}}</title><style>${STYLE_BASE}
  .band { background: linear-gradient(120deg, {{{estil.color}}}, {{{estil.color2}}}); color:#fff; margin: -16mm -15mm 0; padding: 14mm 15mm 10mm; display:flex; justify-content:space-between; align-items:center; }
  .band img { max-height: {{{estil.logo_h}}}px; max-width:220px; background:#fff; padding:6px; border-radius:8px; }
  .band h1 { margin:0; font-size: 34px; font-weight: 300; letter-spacing: 3px; }
  .band .tagline { color: #fff; opacity: .9; }
  .grid { display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin: 22px 0; }
  .grid h4, .box h4 { margin:0 0 4px; font-size: 10px; text-transform: uppercase; color:{{{estil.color}}}; letter-spacing:1px; }
  .lines thead th { border-bottom: 2px solid {{{estil.color}}}; color: {{{estil.color}}}; text-align:left; font-size: 11px; text-transform: uppercase; }
  .lines tbody td { border-bottom: 1px solid #f3f4f6; }
  .totals { width: 42%; margin-left:auto; margin-top: 16px; }
  .totals .big td { background: {{{estil.color}}}; color: #fff; font-size: 17px; font-weight: bold; padding: 10px 6px; }
  .deposit { margin-top: 16px; border: 1px dashed {{{estil.color2}}}; border-radius: 8px; padding: 10px 12px; }
  .foot { color:#9ca3af; text-align:left; }
</style></head><body><div class="page">
  <div class="band"><div>{{#if empresa.logo}}<img src="{{empresa.logo}}" alt="logo">{{else}}<b style="font-size:20px">{{empresa.nom}}</b>{{/if}}{{#if opt.eslogan}}<div class="tagline">{{opt.eslogan}}</div>{{/if}}</div><h1>{{doc.tipus}}</h1></div>
  <div class="grid">
    <div><h4>De</h4>${COMPANY_LINES}</div>
    <div><h4>Per a</h4>${CLIENT_LINES}</div>
    <div><h4>Document</h4>Núm. <b>{{doc.numero}}</b><br>Data: {{doc.data}}{{#if doc.venciment}}<br>{{doc.etiqueta_venciment}}: {{doc.venciment}}{{/if}}{{#if opt.caixa_servei}}{{#if activitat.data}}<br>Servei: {{activitat.data}}<br>{{activitat.lloc}}{{/if}}{{/if}}</div>
  </div>
  {{#if doc.titol}}<h3 style="color:{{{estil.color}}};margin:0 0 10px">{{doc.titol}}</h3>{{/if}}
  ${INTRO}${LINES}${TOTALS}${AFTER}
</div></body></html>`,

  minimalista: `<!doctype html><html><head><meta charset="utf-8"><title>{{doc.tipus}} {{doc.numero}}</title><style>${STYLE_BASE}
  h1 { font-weight: 400; font-size: 22px; margin: 0 0 30px; color: {{{estil.color}}}; }
  .row { display:flex; justify-content:space-between; margin-bottom: 30px; }
  img { max-height: {{{estil.logo_h}}}px; }
  .lines th { text-align:left; font-weight: 400; color:#9ca3af; border-bottom: 1px solid {{{estil.color}}}; }
  .lines td { border-bottom: 1px solid #f3f4f6; }
  .totals { width: 36%; margin-left:auto; margin-top: 12px; }
  .totals .big td { font-weight: bold; font-size: 15px; color: {{{estil.color}}}; }
  .deposit { margin-top: 14px; }
  .foot { color:#9ca3af; text-align:left; }
</style></head><body><div class="page">
  <div class="row"><div>{{#if empresa.logo}}<img src="{{empresa.logo}}" alt="logo"><br>{{/if}}<b>{{empresa.nom}}</b>{{#if opt.eslogan}}<div class="tagline">{{opt.eslogan}}</div>{{/if}}<br><span class="muted">{{empresa.nif}} · {{empresa.adreca}}, {{empresa.cp}} {{empresa.poblacio}}</span></div>
  <div class="right"><h1>{{doc.tipus}} {{doc.numero}}</h1>{{doc.data}}{{#if doc.venciment}}<br><span class="muted">{{doc.etiqueta_venciment}} {{doc.venciment}}</span>{{/if}}</div></div>
  <div style="margin-bottom:24px"><span class="muted">Client</span><br>${CLIENT_LINES}</div>
  {{#if doc.titol}}<h3 style="color:{{{estil.color}}};margin:0 0 10px">{{doc.titol}}</h3>{{/if}}
  ${INTRO}${LINES}${TOTALS}${AFTER}
</div></body></html>`,
};

// Contracte: capçalera de l'empresa + cos editable + signatures
const CONTRACT_DOC = `<!doctype html><html><head><meta charset="utf-8"><title>{{contracte.titol}} {{contracte.numero}}</title><style>${STYLE_BASE}
  .head { display:flex; justify-content:space-between; align-items:center; border-bottom: 3px solid {{{estil.color}}}; padding-bottom: 12px; margin-bottom: 22px; }
  .head img { max-height: {{{estil.logo_h}}}px; max-width: 240px; }
  .head h1 { margin: 0; color: {{{estil.color}}}; font-size: 20px; text-transform: uppercase; letter-spacing: 1px; text-align: right; }
  .cos { font-size: 13.5px; line-height: 1.6; }
  .cos h2 { color: {{{estil.color}}}; font-size: 15px; margin: 22px 0 6px; }
  .cos h3 { font-size: 14px; margin: 16px 0 4px; border-left: 4px solid {{{estil.color2}}}; padding-left: 8px; }
  .cos table { margin: 10px 0; } .cos th { background: {{{estil.color}}}; color: #fff; text-align: left; padding: 6px; } .cos td { border-bottom: 1px solid #e5e7eb; padding: 6px; }
  .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 40px; page-break-inside: avoid; }
  .signs .box { border-top: 2px solid {{{estil.color2}}}; padding-top: 8px; min-height: 120px; }
  .signs img { max-height: 90px; max-width: 100%; display: block; margin: 6px 0; }
  .stamp { font-size: 10.5px; color: #6b7280; }
</style></head><body><div class="page">
  <div class="head"><div>{{#if empresa.logo}}<img src="{{empresa.logo}}" alt="logo">{{else}}<b style="font-size:20px;color:{{{estil.color}}}">{{empresa.nom}}</b>{{/if}}{{#if opt.eslogan}}<div class="tagline">{{opt.eslogan}}</div>{{/if}}</div>
    <div><h1>{{contracte.titol}}</h1><div class="muted right">Núm. {{contracte.numero}} · {{contracte.data}}</div></div></div>
  <div class="cos">{{{contracte.cos}}}</div>
  <div class="signs">
    <div class="box"><b>Per {{empresa.nom}}</b><br><span class="muted">NIF {{empresa.nif}}</span></div>
    <div class="box"><b>El client: {{client.nom}}</b><br><span class="muted">NIF/CIF {{client.nif}}</span>
      {{#if contracte.signat}}<img src="{{contracte.signatura}}" alt="signatura"><div class="stamp">Signat electrònicament per {{contracte.signant}}{{#if contracte.signant_nif}} (NIF {{contracte.signant_nif}}){{/if}} el {{contracte.data_signatura}} · IP {{contracte.ip}}</div>{{else}}<div class="stamp" style="margin-top:40px">Pendent de signatura</div>{{/if}}</div>
  </div>
  <div class="foot">{{empresa.peu}}</div>
</div></body></html>`;

const DEFAULT_CONTRACT = `<p>A {{empresa.poblacio}}, el {{avui}}.</p>
<h2>REUNITS</h2>
<p>D'una part, <b>{{empresa.nom}}</b>, amb NIF {{empresa.nif}} i domicili a {{empresa.adreca}}, {{empresa.cp}} {{empresa.poblacio}} (en endavant, <b>l'empresa</b>).</p>
<p>De l'altra, <b>{{client.nom}}</b>, amb NIF/CIF {{client.nif}} i domicili a {{client.adreca}}, {{client.cp}} {{client.poblacio}} (en endavant, <b>el client</b>).</p>
<p>Ambdues parts es reconeixen la capacitat legal necessària per formalitzar aquest contracte de prestació de serveis i</p>
<h2>ACORDEN</h2>
<h3>1. Objecte</h3>
<p>L'empresa prestarà al client el servei següent: <b>{{activitat.titol}}</b>{{#if pressupost.numero}}, d'acord amb el pressupost núm. {{pressupost.numero}}{{/if}}.</p>
{{{pressupost.taula}}}
<h3>2. Data, horari i lloc</h3>
<p>{{#if activitat.data}}El servei es durà a terme el <b>{{activitat.data}}</b>{{#if activitat.hora}}, en horari de {{activitat.hora}}{{/if}}, a <b>{{activitat.lloc}}</b>.{{else}}[Indiqueu aquí la data, l'horari i el lloc del servei.]{{/if}}</p>
<h3>3. Preu i forma de pagament</h3>
<p>{{#if pressupost.total}}El preu total del servei és de <b>{{pressupost.total}}</b> (IVA inclòs).{{else}}[Indiqueu aquí el preu total del servei.]{{/if}}{{#if pressupost.te_senyal}} Per reservar la data, el client abonarà una paga i senyal de <b>{{pressupost.senyal}}</b> en el moment de signar aquest contracte; la resta s'abonarà abans de la data del servei.{{/if}}</p>
<p>Forma de pagament: {{empresa.pagament}}{{#if empresa.iban}} — IBAN {{empresa.iban}}{{/if}}.</p>
<h3>4. Cancel·lacions i canvis</h3>
<p>Si el client cancel·la el servei amb menys de 15 dies d'antelació, l'empresa podrà retenir la paga i senyal en concepte de despeses de reserva. Els canvis de data o d'horari s'hauran d'acordar per escrit i estaran subjectes a disponibilitat. Si el servei no es pot fer per causes de força major (meteorologia adversa, ordres de l'autoritat, etc.), les parts acordaran una nova data o el retorn de les quantitats abonades.</p>
<h3>5. Obligacions de les parts</h3>
<p>L'empresa aportarà el personal qualificat i el material necessari per prestar el servei, i disposa d'una assegurança de responsabilitat civil. El client facilitarà l'accés a l'espai i les condicions acordades, i informarà de qualsevol circumstància rellevant (al·lèrgies, necessitats especials, nombre i edat dels participants, etc.).</p>
<h3>6. Protecció de dades</h3>
<p>Les dades personals es tractaran d'acord amb el Reglament (UE) 2016/679 (RGPD) i la Llei orgànica 3/2018, amb l'única finalitat de gestionar aquest contracte. El client pot exercir els drets d'accés, rectificació, supressió i oposició adreçant-se a {{empresa.email}}.</p>
<h3>7. Legislació aplicable</h3>
<p>Aquest contracte es regeix per la legislació vigent. Per a qualsevol controvèrsia, les parts se sotmeten als jutjats i tribunals competents d'acord amb la normativa aplicable.</p>
<p>I, en prova de conformitat, les parts signen aquest contracte en la data i el lloc indicats.</p>`;

module.exports = { PRESETS, CONTRACT_DOC, DEFAULT_CONTRACT };
