// Valors per defecte de la configuració
const { PRESETS, CONTRACT_DOC, DEFAULT_CONTRACT } = require('./presets');

const DEFAULT_SETTINGS = {
  company: {
    name: 'La meva empresa', nif: '', address: '', city: '', postal_code: '', email: '', phone: '',
    website: '', iban: '', payment_info: 'Transferència bancària', footer: '', logo: '',
  },
  appearance: {
    app_name: 'Gestió', primary_color: '#2563eb', font: "'Helvetica Neue', Arial, sans-serif",
    modules: { tauler: true, activitats: true, clients: true, treballadors: true, productes: true, pressupostos: true, factures: true, contractes: true, automatismes: true, correus: true },
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
  numbering: { invoice_prefix: 'F{ANY}-', invoice_next: 1, quote_prefix: 'P{ANY}-', quote_next: 1, contract_prefix: 'C{ANY}-', contract_next: 1, digits: 4, reset_yearly: true, year: new Date().getFullYear() },
  invoicing: {
    default_vat: 21, due_days: 30, quote_validity_days: 30,
    default_deposit_type: 'percent', default_deposit_value: 30,
    quote_conditions: 'Pressupost sense compromís. Vàlid fins a la data indicada.',
    invoice_notes: '',
    currency: '€',
  },
  templates: {
    invoice_preset: 'classica', quote_preset: 'classica', invoice_html: '', quote_html: '',
    // disseny (colors de l'empresa)
    color: '', color2: '', logo_height: 70, tagline: '',
    show_service: true, show_vat_column: true, quote_signature: false,
  },
  contract: { title: 'Contracte de prestació de serveis', body: DEFAULT_CONTRACT },
  email: {
    smtp_host: '', smtp_port: 587, smtp_secure: false, smtp_user: '', smtp_pass: '',
    from_name: '', from_email: '', reply_to: '', base_url: '', signature: '',
  },
  messages: {
    contract_subject: 'Contracte {{contracte.numero}} - {{empresa.nom}}',
    contract_body:
`Hola {{client.nom}},

T'enviem el contracte {{contracte.numero}} ({{contracte.titol}}).

El pots llegir i signar en línia des d'aquest enllaç:
{{contracte.enllac}}

Qualsevol dubte, digue'ns.

{{empresa.nom}}`,
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
  contract_not_signed: { label: 'Contracte enviat i encara no signat', target: 'client', ref: 'després d\'enviar-lo' },
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
  { name: 'Recordatori: contracte pendent de signar', trigger: 'contract_not_signed', delay_value: 3, delay_unit: 'dies', repeat_every: 4, max_runs: 2, active: 1,
    subject: 'Falta signar el contracte {{contracte.numero}}',
    body: `Hola {{client.nom}},\n\nEt recordem que el contracte {{contracte.numero}} està pendent de signatura. El pots signar en línia aquí:\n{{contracte.enllac}}\n\n{{empresa.nom}}` },
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

module.exports = { PRESETS, CONTRACT_DOC, DEFAULT_CONTRACT, DEFAULT_SETTINGS, TRIGGERS, DEFAULT_AUTOMATIONS };
