const LOCATION_RE = /^location\s+(.+?)\s*\{/;
const SIMPLE_DIRECTIVE_RE = /^([a-zA-Z_][\w]*)\s+(.+?);$/s;

const stripComment = (line) => {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '#') break;
    out += ch;
  }
  return out;
};

const braceDelta = (line) => {
  let delta = 0;
  for (const ch of stripComment(line)) {
    if (ch === '{') delta += 1;
    else if (ch === '}') delta -= 1;
  }
  return delta;
};

const trimQuotes = (value) => String(value || '').trim().replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');

// 把 location 的 body 拆成「简单指令」和「无法结构化解析的行」
const parseBody = (body) => {
  const directives = [];
  const unknown = [];

  for (const rawLine of String(body || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    const match = line.match(SIMPLE_DIRECTIVE_RE);
    if (match) directives.push({ name: match[1], value: match[2].trim() });
    else unknown.push(line);
  }

  return { directives, unknown };
};

const slugify = (pattern) => {
  const raw = String(pattern || '')
    .replace(/^=\s*/, '')
    .replace(/^[~*^]+\s*/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return raw || 'root';
};

const DIRECTIVE_HINT = /^(proxy_pass|proxy_set_header|access_log|error_log|location|listen|server_name|include|root|alias|index|return|rewrite|try_files|add_header|client_max_body_size)\b/;

const isNoteLine = (text) => {
  if (!text) return false;
  if (/[;{}]/.test(text)) return false;
  if (DIRECTIVE_HINT.test(text)) return false;
  return true;
};

const parseNginxConfig = (text = '') => {
  const lines = String(text).split(/\r?\n/);
  const locations = [];
  const usedIds = new Set();
  let depth = 0;
  let current = null;

  const collectNote = (lineIndex) => {
    const notes = [];
    for (let i = lineIndex - 1; i >= 0; i -= 1) {
      const raw = lines[i].trim();
      if (!raw) {
        if (notes.length) break;
        continue;
      }
      if (!raw.startsWith('#')) break;
      const note = raw.replace(/^#+\s?/, '').trim();
      if (!isNoteLine(note)) break;
      notes.unshift(note);
    }
    return notes.join(' ').trim();
  };

  const finish = (block) => {
    const joined = block.lines.join('\n');
    const open = joined.indexOf('{');
    const close = joined.lastIndexOf('}');
    const body = open >= 0 && close > open ? joined.slice(open + 1, close) : '';
    const { directives, unknown } = parseBody(body);

    let id = slugify(block.pattern);
    if (usedIds.has(id)) {
      let index = 2;
      while (usedIds.has(id + '-' + index)) index += 1;
      id = id + '-' + index;
    }
    usedIds.add(id);

    locations.push({
      id,
      pattern: block.pattern,
      note: block.note,
      body: body.trim(),
      directives,
      unknown,
      startLine: block.startLine,
      endLine: block.startLine + block.lines.length - 1,
      raw: joined.trim(),
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const code = stripComment(raw).trim();

    if (current) {
      current.lines.push(raw);
      depth += braceDelta(raw);
      if (depth <= current.baseDepth) {
        finish(current);
        current = null;
      }
      continue;
    }

    const match = code.match(LOCATION_RE);
    if (match) {
      current = {
        pattern: match[1].trim(),
        note: collectNote(i),
        startLine: i + 1,
        baseDepth: depth,
        lines: [raw],
      };
      depth += braceDelta(raw);
      if (depth <= current.baseDepth) {
        finish(current);
        current = null;
      }
      continue;
    }

    depth += braceDelta(raw);
  }

  return { locations, lineCount: lines.length };
};

module.exports = { parseNginxConfig, parseBody, slugify, stripComment, trimQuotes };
