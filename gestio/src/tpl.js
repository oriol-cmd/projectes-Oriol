// Motor de plantilles petit: {{var}}, {{{html}}}, {{#if x}}..{{else}}..{{/if}}, {{#each llista}}..{{/each}}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function lookup(ctx, p) {
  p = p.trim();
  if (p === 'this' || p === '.') return ctx.this;
  let cur = ctx;
  for (const part of p.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  if (cur === undefined && ctx.__parent) return lookup(ctx.__parent, p);
  return cur;
}

function truthy(v) { return Array.isArray(v) ? v.length > 0 : !!v && v !== '0'; }

// Troba el bloc de tancament equilibrat
function findClose(str, start, tag) {
  const re = new RegExp(`{{(#${tag}\\s[^}]*|/${tag})}}`, 'g');
  re.lastIndex = start;
  let depth = 1, m;
  while ((m = re.exec(str))) {
    if (m[1].startsWith('#')) depth++; else depth--;
    if (depth === 0) return { index: m.index, end: re.lastIndex };
  }
  return null;
}

function render(str, ctx, opts = {}) {
  const escape = opts.escape !== false;
  let out = '';
  let i = 0;
  const open = /{{(#(if|each|unless)\s+([^}]+)|{([^}]+)}|([^}#/][^}]*))}}/g;
  while (i < str.length) {
    open.lastIndex = i;
    const m = open.exec(str);
    if (!m) { out += str.slice(i); break; }
    out += str.slice(i, m.index);
    if (m[2]) {
      const tag = m[2], expr = m[3];
      const close = findClose(str, open.lastIndex, tag);
      if (!close) { out += m[0]; i = open.lastIndex; continue; }
      const inner = str.slice(open.lastIndex, close.index);
      const val = lookup(ctx, expr);
      if (tag === 'each') {
        if (Array.isArray(val)) {
          val.forEach((item, idx) => {
            const child = Object.assign({}, typeof item === 'object' ? item : {}, { this: item, '@index': idx + 1, __parent: ctx });
            out += render(inner, child, opts);
          });
        }
      } else {
        // {{else}} al mateix nivell
        let thenPart = inner, elsePart = '';
        const elseIdx = topLevelElse(inner);
        if (elseIdx >= 0) { thenPart = inner.slice(0, elseIdx); elsePart = inner.slice(elseIdx + 8); }
        const cond = tag === 'if' ? truthy(val) : !truthy(val);
        out += render(cond ? thenPart : elsePart, ctx, opts);
      }
      i = close.end;
    } else if (m[4]) {
      const v = lookup(ctx, m[4]);
      out += v ?? '';
      i = open.lastIndex;
    } else {
      const name = m[5].trim();
      if (name === 'else') { i = open.lastIndex; continue; }
      const v = lookup(ctx, name);
      out += escape ? esc(v) : (v ?? '');
      i = open.lastIndex;
    }
  }
  return out;
}

function topLevelElse(s) {
  let depth = 0;
  const re = /{{(#(?:if|each|unless)\s[^}]*|\/(?:if|each|unless)|else)}}/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] === 'else') { if (depth === 0) return m.index; }
    else if (m[1].startsWith('#')) depth++;
    else depth--;
  }
  return -1;
}

module.exports = { render, esc };
