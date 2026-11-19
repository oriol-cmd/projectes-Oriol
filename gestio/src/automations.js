// Motor d'automatismes: cada minut revisa les regles actives i envia els recordatoris que toquen
const { all, get, run, insert, update, addTimeline } = require('./db');
const S = require('./services');
const { TRIGGERS } = require('./defaults');

const HOUR = 3600 * 1000;
function unitMs(unit) { return unit === 'hores' ? HOUR : 24 * HOUR; }
function activityStart(a) { return new Date(`${a.date}T${a.start_time || '09:00'}:00`); }
function endOfDay(d) { return new Date(`${d}T23:59:00`); }

// Retorna [{ entity_type, entity_id, ref: Date, mode: 'after'|'before', send: async (auto) => result }]
function candidates(trigger) {
  const out = [];
  const clientOf = id => (id ? get('SELECT * FROM clients WHERE id = ?', id) : null);
  const mailClient = (kind, doc, related_type) => async auto => {
    const client = clientOf(doc.client_id);
    const ctx = S.messageCtx({ client, [kind]: doc, activity: doc.activity_id ? get('SELECT * FROM activities WHERE id = ?', doc.activity_id) : null });
    const r = await S.sendEmail({ to: client && client.email, subject: S.renderMessage(auto.subject, ctx), text: S.renderMessage(auto.body, ctx), related_type, related_id: doc.id, automation_id: auto.id });
    addTimeline(related_type, doc.id, 'automatisme', `«${auto.name}» enviat a ${client?.email || '(sense correu)'} — ${r.status}`);
    return r;
  };

  switch (trigger) {
    case 'quote_not_opened':
      for (const q of all(`SELECT * FROM quotes WHERE status = 'enviat' AND first_opened_at IS NULL AND sent_at IS NOT NULL`))
        out.push({ entity_type: 'quote', entity_id: q.id, ref: S.parseTs(q.sent_at), mode: 'after', send: mailClient('quote', q, 'quote') });
      break;
    case 'quote_no_response':
      for (const q of all(`SELECT * FROM quotes WHERE status = 'vist' AND first_opened_at IS NOT NULL`))
        out.push({ entity_type: 'quote', entity_id: q.id, ref: S.parseTs(q.first_opened_at), mode: 'after', send: mailClient('quote', q, 'quote') });
      break;
    case 'quote_expiring':
      for (const q of all(`SELECT * FROM quotes WHERE status IN ('enviat','vist') AND valid_until IS NOT NULL AND valid_until <> ''`))
        out.push({ entity_type: 'quote', entity_id: q.id, ref: endOfDay(q.valid_until), mode: 'before', send: mailClient('quote', q, 'quote') });
      break;
    case 'contract_not_signed':
      for (const k of all(`SELECT * FROM contracts WHERE status IN ('enviat','vist') AND sent_at IS NOT NULL`)) {
        out.push({ entity_type: 'contract', entity_id: k.id, ref: S.parseTs(k.sent_at), mode: 'after', send: async auto => {
          const { ctx, client } = S.contractMsgCtx(k);
          const r = await S.sendEmail({ to: client && client.email, subject: S.renderMessage(auto.subject, ctx), text: S.renderMessage(auto.body, ctx), related_type: 'contract', related_id: k.id, automation_id: auto.id });
          addTimeline('contract', k.id, 'automatisme', `«${auto.name}» enviat a ${client?.email || '(sense correu)'} — ${r.status}`);
          return r;
        } });
      }
      break;
    case 'quote_accepted':
      for (const q of all(`SELECT * FROM quotes WHERE status = 'acceptat' AND responded_at IS NOT NULL`))
        out.push({ entity_type: 'quote', entity_id: q.id, ref: S.parseTs(q.responded_at), mode: 'after', send: mailClient('quote', q, 'quote') });
      break;
    case 'invoice_due':
    case 'invoice_overdue':
      for (const inv of all(`SELECT * FROM invoices WHERE status IN ('emesa','senyal_pagat') AND paid_at IS NULL AND due_date IS NOT NULL AND due_date <> ''`))
        out.push({ entity_type: 'invoice', entity_id: inv.id, ref: trigger === 'invoice_due' ? new Date(`${inv.due_date}T09:00:00`) : endOfDay(inv.due_date), mode: trigger === 'invoice_due' ? 'before' : 'after', send: mailClient('invoice', inv, 'invoice') });
      break;
    case 'deposit_pending':
      for (const inv of all(`SELECT * FROM invoices WHERE status = 'emesa' AND deposit_amount > 0 AND deposit_paid_at IS NULL AND paid_at IS NULL`))
        out.push({ entity_type: 'invoice', entity_id: inv.id, ref: inv.sent_at ? S.parseTs(inv.sent_at) : new Date(`${inv.date}T09:00:00`), mode: 'after', send: mailClient('invoice', inv, 'invoice') });
      break;
    case 'activity_client_reminder':
      for (const a of all(`SELECT * FROM activities WHERE status NOT IN ('cancel·lada','feta') AND client_id IS NOT NULL AND date >= ?`, S.todayISO())) {
        out.push({ entity_type: 'activity', entity_id: a.id, ref: activityStart(a), mode: 'before', send: async auto => {
          const client = clientOf(a.client_id);
          const ctx = S.messageCtx({ client, activity: a });
          const r = await S.sendEmail({ to: client && client.email, subject: S.renderMessage(auto.subject, ctx), text: S.renderMessage(auto.body, ctx), related_type: 'activity', related_id: a.id, automation_id: auto.id });
          addTimeline('activity', a.id, 'automatisme', `«${auto.name}» al client — ${r.status}`);
          return r;
        } });
      }
      break;
    case 'assignment_new':
    case 'assignment_not_received':
    case 'assignment_not_confirmed':
    case 'activity_worker_reminder': {
      const status = { assignment_new: `('pendent')`, assignment_not_received: `('enviat')`, assignment_not_confirmed: `('rebut')`, activity_worker_reminder: `('confirmat')` }[trigger];
      const rows = all(`SELECT s.*, a.date AS a_date, a.start_time AS a_start FROM assignments s JOIN activities a ON a.id = s.activity_id
        WHERE s.status IN ${status} AND a.status NOT IN ('cancel·lada','feta') AND a.date >= ?`, S.todayISO());
      for (const s of rows) {
        let ref;
        if (trigger === 'assignment_new') ref = S.parseTs(s.created_at);
        else if (trigger === 'activity_worker_reminder') ref = activityStart({ date: s.a_date, start_time: s.a_start });
        else ref = S.parseTs(s.sent_at || s.created_at);
        out.push({ entity_type: 'assignment', entity_id: s.id, ref, mode: trigger === 'activity_worker_reminder' ? 'before' : 'after', send: async auto => {
          if (trigger === 'assignment_new') return S.sendAssignment(s.id, { subject: auto.subject || undefined, body: auto.body || undefined, automation_id: auto.id });
          const b = S.assignmentBundle(s.id);
          const r = await S.sendEmail({ to: b.worker.email, subject: S.renderMessage(auto.subject, b.ctx), text: S.renderMessage(auto.body, b.ctx), related_type: 'assignment', related_id: s.id, automation_id: auto.id });
          addTimeline('activity', s.activity_id, 'automatisme', `«${auto.name}» a ${b.worker.first_name} — ${r.status}`);
          return r;
        } });
      }
      break;
    }
  }
  return out;
}

let running = false;
async function tick() {
  if (running) return { skipped: true };
  running = true;
  let sent = 0;
  try {
    const now = Date.now();
    // pressupostos caducats
    for (const q of all(`SELECT id FROM quotes WHERE status IN ('enviat','vist') AND valid_until IS NOT NULL AND valid_until <> '' AND valid_until < ?`, S.todayISO())) {
      update('quotes', q.id, { status: 'caducat' });
      addTimeline('quote', q.id, 'caducat', 'Ha passat la data de validesa sense resposta');
    }
    for (const auto of all('SELECT * FROM automations WHERE active = 1')) {
      if (!TRIGGERS[auto.trigger]) continue;
      const delay = (Number(auto.delay_value) || 0) * unitMs(auto.delay_unit);
      const repeat = (Number(auto.repeat_every) || 0) * unitMs(auto.delay_unit);
      const maxRuns = Math.max(1, Number(auto.max_runs) || 1);
      for (const c of candidates(auto.trigger)) {
        if (!c.ref || isNaN(c.ref)) continue;
        const r = get('SELECT * FROM automation_runs WHERE automation_id = ? AND entity_type = ? AND entity_id = ?', auto.id, c.entity_type, c.entity_id);
        const count = r ? r.run_count : 0;
        if (count >= maxRuns) continue;
        let due;
        if (c.mode === 'after') {
          due = c.ref.getTime() + delay + count * repeat;
          if (count > 0 && !repeat) continue;
        } else {
          if (now >= c.ref.getTime()) continue; // ja ha passat
          due = c.ref.getTime() - delay + count * repeat;
          if (count > 0 && !repeat) continue;
        }
        if (now < due) continue;
        // no re-enviar massa seguit
        if (r && r.last_run_at && now - S.parseTs(r.last_run_at).getTime() < Math.max(repeat, 10 * 60 * 1000) && count > 0) continue;
        try { await c.send(auto); sent++; } catch (e) { console.error('Automatisme', auto.name, e.message); }
        if (r) update('automation_runs', r.id, { run_count: count + 1, last_run_at: S.nowISO() });
        else insert('automation_runs', { automation_id: auto.id, entity_type: c.entity_type, entity_id: c.entity_id, run_count: 1, last_run_at: S.nowISO() });
      }
    }
  } finally { running = false; }
  return { sent };
}

function start() {
  setTimeout(() => tick().catch(e => console.error(e)), 5000);
  setInterval(() => tick().catch(e => console.error(e)), 60 * 1000);
}

module.exports = { tick, start };
