// Valors per defecte de la configuració i plantilles de documents

const STYLE_BASE = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: {{{estil.font}}}; color: #1f2937; font-size: 13px; }
  .page { width: 210mm; min-height: 297mm; padding: 16mm 15mm; margin: 0 auto; background: #fff; position: relative; }
  table { width: 100%; border-collapse: collapse; }
  .right { text-align: right; } .muted { color: #6b7280; }
  .lines th, .lines td { padding: 8px 6px; }
  .totals td { padding: 4px 6px; }
  .notes { margin-top: 24px; white-space: pre-wrap; }
  @media print { .page { margin: 0; } @page { size: A4; margin: 0; } }
`;

const PRESETS = {
  classica: `<!doctype html><html><head><meta charset="utf-8"><title>{{doc.tipus}} {{doc.numero}}</title><style>${STYLE_BASE}
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid {{{estil.color}}}; padding-bottom: 14px; }
  .head img { max-height: 70px; max-width: 220px; }
  h1 { color: {{{estil.color}}}; margin: 0; font-size: 28px; letter-spacing: 2px; }
  .boxes { display:flex; gap: 20px; margin: 22px 0; }
  .box { flex:1; border:1px solid #e5e7eb; border-radius:6px; padding:12px; }
  .box h4 { margin:0 0 6px; font-size: 11px; text-transform: uppercase; color: {{{estil.color}}}; }
  .lines thead th { background: {{{estil.color}}}; color:#fff; text-align:left; }
  .lines tbody td { border-bottom: 1px solid #e5e7eb; }
  .totals { width: 45%; margin-left: auto; margin-top: 14px; }
  .totals .big td { font-size: 16px; font-weight: bold; border-top: 2px solid {{{estil.color}}}; }
  .deposit { margin-top: 14px; padding: 10px 12px; background: #f3f4f6; border-left: 4px solid {{{estil.color}}}; }
  .foot { position:absolute; bottom: 12mm; left:15mm; right:15mm; font-size: 10px; text-align:center; color:#6b7280; border-top: 1px solid #e5e7eb; padding-top: 6px; }
</style></head><body><div class="page">
  <div class="head">
    <div>{{#if empresa.logo}}<img src="{{empresa.logo}}" alt="logo">{{else}}<h2 style="margin:0">{{empresa.nom}}</h2>{{/if}}
      <div class="muted" style="margin-top:6px">{{empresa.nom}}{{#if empresa.nif}} · NIF {{empresa.nif}}{{/if}}{{#if empresa.adreca}}<br>{{empresa.adreca}}{{/if}}{{#if empresa.poblacio}}<br>{{empresa.cp}} {{empresa.poblacio}}{{/if}}{{#if empresa.telefon}}<br>{{empresa.telefon}}{{/if}}{{#if empresa.email}}<br>{{empresa.email}}{{/if}}</div></div>
    <div class="right"><h1>{{doc.tipus}}</h1><div><b>Núm.:</b> {{doc.numero}}</div><div><b>Data:</b> {{doc.data}}</div>
      {{#if doc.venciment}}<div><b>{{doc.etiqueta_venciment}}:</b> {{doc.venciment}}</div>{{/if}}</div>
  </div>
  <div class="boxes">
    <div class="box"><h4>Client</h4><b>{{client.nom}}</b>{{#if client.nif}}<br>NIF/CIF: {{client.nif}}{{/if}}{{#if client.adreca}}<br>{{client.adreca}}{{/if}}{{#if client.poblacio}}<br>{{client.cp}} {{client.poblacio}}{{/if}}{{#if client.email}}<br>{{client.email}}{{/if}}</div>
    {{#if activitat.data}}<div class="box"><h4>Servei</h4>{{activitat.titol}}<br>Data: {{activitat.data}}<br>Lloc: {{activitat.lloc}}</div>{{/if}}
  </div>
  <table class="lines"><thead><tr><th>Concepte</th><th class="right">Quant.</th><th class="right">Preu</th><th class="right">IVA</th><th class="right">Import</th></tr></thead>
  <tbody>{{#each linies}}<tr><td>{{descripcio}}</td><td class="right">{{quantitat}}</td><td class="right">{{preu}}</td><td class="right">{{iva}}%</td><td class="right">{{import}}</td></tr>{{/each}}</tbody></table>
  <table class="totals">
    <tr><td>Base imposable</td><td class="right">{{doc.base}}</td></tr>
    {{#each doc.ivas}}<tr><td>IVA {{tipus}}%</td><td class="right">{{quota}}</td></tr>{{/each}}
    <tr class="big"><td>TOTAL</td><td class="right">{{doc.total}}</td></tr>
  </table>
  {{#if doc.te_senyal}}<div class="deposit"><b>Paga i senyal:</b> {{doc.senyal}} {{doc.senyal_estat}} · <b>Pendent:</b> {{doc.pendent}}</div>{{/if}}
  {{#if doc.notes}}<div class="notes">{{doc.notes}}</div>{{/if}}
  {{#if doc.condicions}}<div class="notes muted">{{doc.condicions}}</div>{{/if}}
  {{#if empresa.pagament}}<div class="notes"><b>Forma de pagament:</b> {{empresa.pagament}}</div>{{/if}}
  <div class="foot">{{empresa.peu}}</div>
</div></body></html>`,

  moderna: `<!doctype html><html><head><meta charset="utf-8"><title>{{doc.tipus}} {{doc.numero}}</title><style>${STYLE_BASE}
  .band { background: {{{estil.color}}}; color:#fff; margin: -16mm -15mm 0; padding: 14mm 15mm 10mm; display:flex; justify-content:space-between; align-items:center; }
  .band img { max-height: 60px; max-width:200px; background:#fff; padding:6px; border-radius:6px; }
  .band h1 { margin:0; font-size: 34px; font-weight: 300; letter-spacing: 3px; }
  .grid { display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin: 22px 0; }
  .grid h4 { margin:0 0 4px; font-size: 10px; text-transform: uppercase; color:#9ca3af; letter-spacing:1px; }
  .lines thead th { border-bottom: 2px solid #111827; text-align:left; font-size: 11px; text-transform: uppercase; }
  .lines tbody td { border-bottom: 1px solid #f3f4f6; }
  .totals { width: 40%; margin-left:auto; margin-top: 16px; }
  .totals .big td { background: {{{estil.color}}}; color: #fff; font-size: 17px; font-weight: bold; padding: 10px 6px; }
  .deposit { margin-top: 16px; border: 1px dashed {{{estil.color}}}; border-radius: 8px; padding: 10px 12px; }
  .foot { position:absolute; bottom: 12mm; left:15mm; right:15mm; font-size: 10px; color:#9ca3af; }
</style></head><body><div class="page">
  <div class="band"><div>{{#if empresa.logo}}<img src="{{empresa.logo}}" alt="logo">{{else}}<b style="font-size:20px">{{empresa.nom}}</b>{{/if}}</div><h1>{{doc.tipus}}</h1></div>
  <div class="grid">
    <div><h4>De</h4><b>{{empresa.nom}}</b><br>{{empresa.nif}}<br>{{empresa.adreca}}<br>{{empresa.cp}} {{empresa.poblacio}}<br>{{empresa.email}}</div>
    <div><h4>Per a</h4><b>{{client.nom}}</b><br>{{client.nif}}<br>{{client.adreca}}<br>{{client.cp}} {{client.poblacio}}<br>{{client.email}}</div>
    <div><h4>Document</h4>Núm. <b>{{doc.numero}}</b><br>Data: {{doc.data}}{{#if doc.venciment}}<br>{{doc.etiqueta_venciment}}: {{doc.venciment}}{{/if}}{{#if activitat.data}}<br>Servei: {{activitat.data}}<br>{{activitat.lloc}}{{/if}}</div>
  </div>
  <table class="lines"><thead><tr><th>Descripció</th><th class="right">Quant.</th><th class="right">Preu</th><th class="right">IVA</th><th class="right">Total</th></tr></thead>
  <tbody>{{#each linies}}<tr><td>{{descripcio}}</td><td class="right">{{quantitat}}</td><td class="right">{{preu}}</td><td class="right">{{iva}}%</td><td class="right">{{import}}</td></tr>{{/each}}</tbody></table>
  <table class="totals"><tr><td>Subtotal</td><td class="right">{{doc.base}}</td></tr>
    {{#each doc.ivas}}<tr><td>IVA {{tipus}}%</td><td class="right">{{quota}}</td></tr>{{/each}}
    <tr class="big"><td>Total</td><td class="right">{{doc.total}}</td></tr></table>
  {{#if doc.te_senyal}}<div class="deposit">Paga i senyal: <b>{{doc.senyal}}</b> {{doc.senyal_estat}}<br>Import pendent: <b>{{doc.pendent}}</b></div>{{/if}}
  {{#if doc.notes}}<div class="notes">{{doc.notes}}</div>{{/if}}
  {{#if doc.condicions}}<div class="notes muted">{{doc.condicions}}</div>{{/if}}
  {{#if empresa.pagament}}<div class="notes"><b>Pagament:</b> {{empresa.pagament}}</div>{{/if}}
  <div class="foot">{{empresa.peu}}</div>
</div></body></html>`,

  minimalista: `<!doctype html><html><head><meta charset="utf-8"><title>{{doc.tipus}} {{doc.numero}}</title><style>${STYLE_BASE}
  h1 { font-weight: 400; font-size: 22px; margin: 0 0 30px; }
  .row { display:flex; justify-content:space-between; margin-bottom: 30px; }
  img { max-height: 50px; }
  .lines th { text-align:left; font-weight: 400; color:#9ca3af; border-bottom: 1px solid #d1d5db; }
  .lines td { border-bottom: 1px solid #f3f4f6; }
  .totals { width: 35%; margin-left:auto; margin-top: 12px; }
  .totals .big td { font-weight: bold; font-size: 15px; color: {{{estil.color}}}; }
  .foot { position:absolute; bottom: 12mm; left:15mm; right:15mm; font-size: 10px; color:#9ca3af; }
</style></head><body><div class="page">
  <div class="row"><div>{{#if empresa.logo}}<img src="{{empresa.logo}}" alt="logo"><br>{{/if}}<b>{{empresa.nom}}</b><br><span class="muted">{{empresa.nif}} · {{empresa.adreca}}, {{empresa.cp}} {{empresa.poblacio}}</span></div>
  <div class="right"><h1>{{doc.tipus}} {{doc.numero}}</h1>{{doc.data}}{{#if doc.venciment}}<br><span class="muted">{{doc.etiqueta_venciment}} {{doc.venciment}}</span>{{/if}}</div></div>
  <div style="margin-bottom:30px"><span class="muted">Client</span><br><b>{{client.nom}}</b> · {{client.nif}}<br>{{client.adreca}} {{client.cp}} {{client.poblacio}}</div>
  <table class="lines"><thead><tr><th>Concepte</th><th class="right">Quant.</th><th class="right">Preu</th><th class="right">IVA</th><th class="right">Import</th></tr></thead>
  <tbody>{{#each linies}}<tr><td>{{descripcio}}</td><td class="right">{{quantitat}}</td><td class="right">{{preu}}</td><td class="right">{{iva}}%</td><td class="right">{{import}}</td></tr>{{/each}}</tbody></table>
  <table class="totals"><tr><td>Base</td><td class="right">{{doc.base}}</td></tr>{{#each doc.ivas}}<tr><td>IVA {{tipus}}%</td><td class="right">{{quota}}</td></tr>{{/each}}<tr class="big"><td>Total</td><td class="right">{{doc.total}}</td></tr></table>
  {{#if doc.te_senyal}}<p>Paga i senyal: {{doc.senyal}} {{doc.senyal_estat}} — pendent {{doc.pendent}}</p>{{/if}}
  {{#if doc.notes}}<div class="notes">{{doc.notes}}</div>{{/if}}
  {{#if doc.condicions}}<div class="notes muted">{{doc.condicions}}</div>{{/if}}
  {{#if empresa.pagament}}<div class="notes">{{empresa.pagament}}</div>{{/if}}
  <div class="foot">{{empresa.peu}}</div>
</div></body></html>`,
};

const DEFAULT_SETTINGS = {
  company: {
    name: 'La meva empresa', nif: '', address: '', city: '', postal_code: '', email: '', phone: '',
    website: '', iban: '', payment_info: 'Transferència bancària', footer: '', logo: '',
  },
  appearance: {
    app_name: 'Gestió', primary_color: '#2563eb', font: "'Helvetica Neue', Arial, sans-serif",
    modules: { tauler: true, activitats: true, clients: true, treballadors: true, productes: true, pressupostos: true, factures: true, automatismes: true, correus: true },
    labels: {}, // noms personalitzats dels apartats
  },
  custom_fields: { worker: [], client: [], activity: [] },
  activity_statuses: [
    { key: 'pendent', label: 'Pendent', color: '#f59e0b' },
    { key: 'confirmada', label: 'Confirmada', color: '#10b981' },
    { key: 'feta', label: 'Feta', color: '#6b7280' },
    { key: 'cancel·lada', label: 'Cancel·lada', color: '#ef4444' },
  ],
  worker_roles: ['Monitor/a', 'Coordinador/a', 'Tècnic/a'],
  document_categories: ['DNI', 'Contracte', 'Titulació', 'Certificat de delictes sexuals', 'Altres'],
  numbering: { invoice_prefix: 'F{ANY}-', invoice_next: 1, quote_prefix: 'P{ANY}-', quote_next: 1, digits: 4, reset_yearly: true, year: new Date().getFullYear() },
  invoicing: {
    default_vat: 21, due_days: 30, quote_validity_days: 30,
    default_deposit_type: 'percent', default_deposit_value: 30,
    quote_conditions: 'Pressupost sense compromís. Vàlid fins a la data indicada.',
    invoice_notes: '',
    currency: '€',
  },
  templates: { invoice_preset: 'classica', quote_preset: 'classica', invoice_html: '', quote_html: '' },
  email: {
    smtp_host: '', smtp_port: 587, smtp_secure: false, smtp_user: '', smtp_pass: '',
    from_name: '', from_email: '', reply_to: '', base_url: '', signature: '',
  },
  messages: {
    assignment_subject: 'Nova feina: {{activitat.titol}} el {{activitat.data}}',
    assignment_body:
`Hola {{treballador.nom}},

T'hem assignat a una feina:

• Activitat: {{activitat.titol}}
• Data: {{activitat.data}} {{activitat.hora}}
• Lloc: {{activitat.lloc}}
• Producte / tasca: {{assignacio.producte}}
{{#if activitat.notes_treballadors}}• Notes: {{activitat.notes_treballadors}}
{{/if}}
Confirma si hi pots anar aquí: {{enllac_confirmacio}}
{{#if activitat.whatsapp}}
Grup de WhatsApp de la feina: {{activitat.whatsapp}}
{{/if}}
Gràcies!
{{empresa.nom}}`,
    whatsapp_text:
`Hola {{treballador.nom}}! 👋 Tens una feina:
📅 {{activitat.data}} {{activitat.hora}}
📍 {{activitat.lloc}}
🧩 {{assignacio.producte}}
Confirma-ho aquí: {{enllac_confirmacio}}
{{#if activitat.whatsapp}}👥 Entra al grup: {{activitat.whatsapp}}{{/if}}`,
    quote_subject: 'Pressupost {{pressupost.numero}} - {{empresa.nom}}',
    quote_body:
`Hola {{client.nom}},

T'enviem el pressupost {{pressupost.numero}} per import de {{pressupost.total}}, sense cap compromís.

Pots veure'l i acceptar-lo des d'aquest enllaç:
{{pressupost.enllac}}

És vàlid fins al {{pressupost.validesa}}.

Salutacions,
{{empresa.nom}}`,
    invoice_subject: 'Factura {{factura.numero}} - {{empresa.nom}}',
    invoice_body:
`Hola {{client.nom}},

T'adjuntem la factura {{factura.numero}} per import de {{factura.total}}.
{{#if factura.te_senyal}}
Paga i senyal: {{factura.senyal}} ({{factura.senyal_estat}}). Import pendent: {{factura.pendent}}.
{{/if}}
Pots consultar-la aquí: {{factura.enllac}}
Venciment: {{factura.venciment}}

{{empresa.pagament}}

Gràcies,
{{empresa.nom}}`,
  },
};

const TRIGGERS = {
  quote_not_opened: { label: 'Pressupost enviat i encara no obert', target: 'client', ref: 'després d\'enviar-lo' },
  quote_no_response: { label: 'Pressupost vist però sense resposta', target: 'client', ref: 'després de veure\'l' },
  quote_expiring: { label: 'Pressupost a punt de caducar sense resposta', target: 'client', ref: 'abans de caducar' },
  quote_accepted: { label: 'Pressupost acceptat (agraïment)', target: 'client', ref: 'després d\'acceptar-lo' },
  invoice_due: { label: 'Factura pendent abans del venciment', target: 'client', ref: 'abans del venciment' },
  invoice_overdue: { label: 'Factura vençuda i no pagada', target: 'client', ref: 'després del venciment' },
  deposit_pending: { label: 'Paga i senyal pendent', target: 'client', ref: 'després d\'enviar la factura' },
  activity_client_reminder: { label: 'Recordatori de l\'activitat al client', target: 'client', ref: 'abans de l\'activitat' },
  assignment_new: { label: 'Convocatòria nova al treballador (detalls + WhatsApp)', target: 'worker', ref: 'després d\'assignar-lo' },
  assignment_not_received: { label: 'Treballador no ha obert la convocatòria', target: 'worker', ref: 'després d\'enviar-la' },
  assignment_not_confirmed: { label: 'Treballador no ha confirmat el dia', target: 'worker', ref: 'després d\'enviar-la' },
  activity_worker_reminder: { label: 'Recordatori de la feina al treballador confirmat', target: 'worker', ref: 'abans de l\'activitat' },
};

const DEFAULT_AUTOMATIONS = [
  { name: 'Convocatòria als treballadors', trigger: 'assignment_new', delay_value: 0, delay_unit: 'hores', repeat_every: 0, max_runs: 1, active: 1,
    subject: '', body: '' }, // buit = fa servir el missatge de convocatòria de Configuració
  { name: 'Recordatori: no han obert el pressupost', trigger: 'quote_not_opened', delay_value: 3, delay_unit: 'dies', repeat_every: 4, max_runs: 2, active: 1,
    subject: 'Has pogut veure el pressupost {{pressupost.numero}}?',
    body: `Hola {{client.nom}},\n\nFa uns dies et vam enviar el pressupost {{pressupost.numero}} i no sabem si t'ha arribat. El pots veure aquí:\n{{pressupost.enllac}}\n\nQualsevol dubte, digue'ns.\n\n{{empresa.nom}}` },
  { name: 'Seguiment: pressupost vist sense resposta', trigger: 'quote_no_response', delay_value: 4, delay_unit: 'dies', repeat_every: 0, max_runs: 1, active: 1,
    subject: 'Què et sembla el pressupost {{pressupost.numero}}?',
    body: `Hola {{client.nom}},\n\nHem vist que has pogut consultar el pressupost. Vols que en parlem o que hi fem algun canvi?\nPots acceptar-lo directament aquí: {{pressupost.enllac}}\n\n{{empresa.nom}}` },
  { name: 'Recordatori de pagament del senyal', trigger: 'deposit_pending', delay_value: 3, delay_unit: 'dies', repeat_every: 3, max_runs: 3, active: 1,
    subject: 'Recordatori: paga i senyal de la factura {{factura.numero}}',
    body: `Hola {{client.nom}},\n\nUs recordem que per reservar la data cal abonar la paga i senyal de {{factura.senyal}}.\n\n{{empresa.pagament}}\n\nFactura: {{factura.enllac}}\n\n{{empresa.nom}}` },
  { name: 'Factura a punt de vèncer', trigger: 'invoice_due', delay_value: 3, delay_unit: 'dies', repeat_every: 0, max_runs: 1, active: 1,
    subject: 'La factura {{factura.numero}} venç el {{factura.venciment}}',
    body: `Hola {{client.nom}},\n\nUs recordem que la factura {{factura.numero}} ({{factura.pendent}} pendents) venç el {{factura.venciment}}.\n\n{{empresa.pagament}}\n\n{{empresa.nom}}` },
  { name: 'Factura vençuda', trigger: 'invoice_overdue', delay_value: 1, delay_unit: 'dies', repeat_every: 7, max_runs: 3, active: 1,
    subject: 'Factura {{factura.numero}} pendent de pagament',
    body: `Hola {{client.nom}},\n\nNo ens consta el pagament de la factura {{factura.numero}}, vençuda el {{factura.venciment}}. Import pendent: {{factura.pendent}}.\n\n{{empresa.pagament}}\n\nSi ja l'heu pagada, no en feu cas.\n\n{{empresa.nom}}` },
  { name: 'Treballador: no ha obert la convocatòria', trigger: 'assignment_not_received', delay_value: 12, delay_unit: 'hores', repeat_every: 12, max_runs: 2, active: 1,
    subject: 'Recordatori: tens una feina el {{activitat.data}}',
    body: `Hola {{treballador.nom}},\n\nEt vam enviar una feina per al {{activitat.data}} a {{activitat.lloc}} i encara no l'has obert.\nConfirma-la aquí: {{enllac_confirmacio}}\n\n{{empresa.nom}}` },
  { name: 'Treballador: falta confirmar el dia', trigger: 'assignment_not_confirmed', delay_value: 24, delay_unit: 'hores', repeat_every: 24, max_runs: 2, active: 1,
    subject: 'Falta que confirmis la feina del {{activitat.data}}',
    body: `Hola {{treballador.nom}},\n\nNecessitem que confirmis si podràs venir el {{activitat.data}} ({{activitat.lloc}}):\n{{enllac_confirmacio}}\n\n{{empresa.nom}}` },
  { name: 'Treballador: recordatori el dia abans', trigger: 'activity_worker_reminder', delay_value: 1, delay_unit: 'dies', repeat_every: 0, max_runs: 1, active: 1,
    subject: 'Demà tens feina: {{activitat.titol}}',
    body: `Hola {{treballador.nom}},\n\nRecorda que demà {{activitat.data}} {{activitat.hora}} tens feina a {{activitat.lloc}}.\n{{#if activitat.whatsapp}}Grup de WhatsApp: {{activitat.whatsapp}}\n{{/if}}\n{{empresa.nom}}` },
];

module.exports = { PRESETS, DEFAULT_SETTINGS, TRIGGERS, DEFAULT_AUTOMATIONS };
