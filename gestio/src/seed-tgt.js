// Configuració inicial per a Top Green Towers (www.topgreentowers.cat)
// S'aplica un sol cop. No sobreescriu res que ja s'hagi canviat a mà.
const { get, run, insert } = require('./db');

// La web no indica preus: es creen a 0 € perquè s'hi posi el preu real.
// «Treballadors necessaris» és una estimació a partir de la web (p. ex. Greentowers9 = 7 castellers + 2 músics).
const PRODUCTS = [
  // Tallers per a empreses
  { name: 'Taller Assaig', color: '#00ac99', workers_needed: 2, description: 'Taller per a empreses (1 h – 1 h 30 min). Introducció breu als conceptes bàsics dels castells i jocs per entendre\'n els valors: treball en equip, compromís, comunicació.' },
  { name: 'Taller Greentowers', color: '#00ac99', workers_needed: 4, description: 'Taller immersiu per a empreses (1 h 30 min – 2 h). El grup es converteix en una colla: jocs de cada part del castell amb músics i castellers experts, i construcció final amb tot el grup.' },
  { name: 'Taller Audax Generation (a mida)', color: '#00ac99', workers_needed: 3, description: 'Taller a mida en col·laboració amb AudaxGeneration: pràctica castellera combinada amb xerrades i dinàmiques de formació de lideratge i equips.' },
  // Centres educatius
  { name: 'Taller escolar «Vine Veu Viu»', color: '#2ea3f2', workers_needed: 2, description: 'Taller de castells per a centres educatius (1 h – 1 h 30 min, +50 min si es visita Cal Figarot). Jocs sobre esforç, solidaritat, cooperació i cohesió del grup.' },
  { name: 'Festa Major (escoles)', color: '#2ea3f2', workers_needed: 2, description: 'Jornada escolar (1 h – 1 h 30 min, +50 min amb visita a Cal Figarot) per conèixer la Festa Major: gegants i nans, conte, taller de castells, ball de gitanes…' },
  { name: 'Esports Tradicionals (escoles)', color: '#2ea3f2', workers_needed: 2, description: 'Jornada (1 h – 1 h 30 min, +50 min amb visita) per conèixer esports tradicionals catalans i cohesionar el grup amb treball en equip.' },
  // Demostracions en petit format
  { name: 'Demostració Greentowers9', color: '#e11d48', workers_needed: 9, description: 'Demostració castellera (15 – 30 min): 7 castellers i 2 músics, 2 pilars de 3 simultanis. Per a petites recepcions i presentacions.' },
  { name: 'Demostració Greentowers16', color: '#e11d48', workers_needed: 16, description: 'Demostració didàctica (20 – 30 min): 14 castellers i 2 músics. Introducció a l\'origen i l\'actualitat dels castells i representació de les 3 parts d\'un castell.' },
  { name: 'Demostració Greentowers30', color: '#e11d48', workers_needed: 30, description: 'Demostració en petit format (12 – 15 min): 27 castellers i 3 músics, 4 construccions de fins a 6 pisos.' },
  { name: 'Demostració Greentowers60', color: '#e11d48', workers_needed: 60, description: 'Demostració en petit format (15 – 20 min): 57 castellers i 3 músics, 4 construccions de fins a 7 pisos.' },
  // Conferències
  { name: 'Conferència castellera', color: '#7c3aed', workers_needed: 1, description: 'Xerrada (30 min – 1 h) sobre els castells i els seus valors, amb una pinya amb el públic. Dirigida per castellers amb càrrecs de màxima responsabilitat als Castellers de Vilafranca.' },
  // Visites
  { name: 'Visita guiada a Cal Figarot', color: '#f59e0b', workers_needed: 1, unit: 'grup', description: 'Visita (45 min – 1 h) a la seu dels Castellers de Vilafranca amb audiovisual. Mínim 16 persones; la condueix 1 casteller.' },
  { name: 'Visita guiada a la Vilafranca castellera', color: '#f59e0b', workers_needed: 1, unit: 'grup', description: 'Ruta (45 min – 1 h) pels espais castellers de Vilafranca, amb sorpresa final a Cal Figarot. Mínim 16 persones; la condueix 1 casteller.' },
  { name: 'Visita guiada a Can Cassanyes + dinar', color: '#f59e0b', workers_needed: 1, unit: 'grup', description: 'Visita (1 h 30 min – 2 h + dinar) a la masia de l\'Oriol Rossell i el celler modernista: copa de benvinguda, experiència castellera i dinar tradicional. Mínim 16 persones.' },
  // +Experiències
  { name: 'Llagut', color: '#16a34a', workers_needed: 2, description: 'Experiència de rem en llagut català a la Costa Brava (1 h 30 min – 2 h): origen i parts del llagut i tècnica bàsica de rem.' },
  { name: 'Combinada Catalana', color: '#16a34a', workers_needed: 2, description: 'Competició per equips (1 h 30 min – 2 h) amb quatre esports tradicionals: rem ergòmetre, estira i afluixa, trinquet i bitlles catalanes.' },
  { name: 'Enorientació', color: '#16a34a', workers_needed: 2, description: 'Cursa d\'orientació entre les vinyes del Penedès (1 h 30 min – 2 h) per treballar en equip i conèixer el món del vi.' },
  { name: 'Catalan Heights & Bites', color: '#16a34a', workers_needed: 1, description: 'Degustació guiada de vins i formatges en anglès (1 h – 1 h 30 min) emparellada amb les etapes d\'un castell, i visita a Cal Figarot.' },
];

const COMPANY = {
  name: 'Top Green Towers', address: 'Cal Figarot. Carrer del General Prim, 11', city: 'Vilafranca del Penedès', postal_code: '08720',
  phone: '679 162 465', email: 'info@topgreentowers.cat', website: 'https://www.topgreentowers.cat',
};

function seedTopGreenTowers(S) {
  if (get(`SELECT value FROM settings WHERE key = 'seed_tgt'`)) return;
  // productes que encara no hi siguin
  for (const p of PRODUCTS) {
    if (get('SELECT id FROM products WHERE LOWER(name) = LOWER(?)', p.name)) continue;
    insert('products', { name: p.name, description: p.description, price: 0, vat: 21, unit: p.unit || 'grup', workers_needed: p.workers_needed, color: p.color, active: 1 });
  }
  // dades de l'empresa: només els camps buits o per defecte
  const s = S.getSettings();
  const company = {};
  for (const [k, v] of Object.entries(COMPANY)) if (!s.company[k] || (k === 'name' && s.company.name === 'La meva empresa')) company[k] = v;
  const patch = { company };
  const ap = {};
  if (s.appearance.app_name === 'Gestió') ap.app_name = 'Top Green Towers';
  if (s.appearance.primary_color === '#2563eb') ap.primary_color = '#00ac99';
  if (Object.keys(ap).length) patch.appearance = ap;
  if (!s.templates.color2) patch.templates = { color2: '#313131', tagline: 'Experiències castelleres per a empreses i centres educatius' };
  S.saveSettings(patch);
  run(`INSERT INTO settings (key, value) VALUES ('seed_tgt', '"fet"')`);
}

module.exports = { seedTopGreenTowers, PRODUCTS };
