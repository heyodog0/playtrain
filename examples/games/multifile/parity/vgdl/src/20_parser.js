// ---- VGDL text -> spec. Mirrors py-vgdl's VGDLParser (Colas / infer-vgdl dialect). ----
// A spec is plain data: sprite defs in registration order, level char map,
// interactions (one per actor/actee pair, in source order), terminations.

const VG_DIRNAMES = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };

// py: args[k] = eval(val), falling back to the raw string
function vgEvalArg(v) {
  if (v in VG_DIRNAMES) return VG_DIRNAMES[v].slice();
  if (v === 'True') return true;
  if (v === 'False') return false;
  if (v === 'None') return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+(e-?\d+)?$/.test(v) || /^-?\d+e-?\d+$/.test(v)) return parseFloat(v);
  const m = v.match(/^\(([^)]*)\)$/);
  if (m) return m[1].split(',').map(x => vgEvalArg(x.trim()));
  return v;
}

// "Class k=v k=v" -> {cls, args}; a leading token without '=' is the class
function vgParseArgs(s, cls, args) {
  cls = cls === undefined ? null : cls;
  args = args ? Object.assign({}, args) : {};
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { cls, args };
  if (!parts[0].includes('=')) { cls = parts[0]; parts.shift(); }
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    args[p.slice(0, i)] = vgEvalArg(p.slice(i + 1));
  }
  return { cls, args };
}

// py indent_tree_parser: tabs -> 8 spaces, '#' comments stripped, blank lines skipped
// str.expandtabs(8): a tab advances to the next multiple of 8, it is not 8 spaces
function vgExpandTabs(line) {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) { if (ch === '\t') { out += ' '.repeat(8 - (out.length % 8)); } else out += ch; }
  return out;
}
function vgIndentTree(text) {
  const lines = text.split('\n').map(vgExpandTabs);
  const root = { content: '', indent: -1, children: [], parent: null };
  let last = root;
  for (let raw of lines) {
    raw = raw.split('#')[0];
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const node = { content: raw.trim(), indent, children: [], parent: null };
    let par = last;
    while (par.indent >= indent) par = par.parent;
    node.parent = par; par.children.push(node); last = node;
  }
  return root.children[0];
}

function vgParse(text) {
  const tree = vgIndentTree(text);
  const header = vgParseArgs(tree.content);          // "BasicGame square_size=20": kwargs are ignored by py (warning only)
  const defs = {}, keys = [], charMap = {}, interactions = [], terminations = [];
  const singletons = new Set();
  function walkSprites(nodes, pcls, pargs, ptypes) {
    for (const n of nodes) {
      const gt = n.content.indexOf('>');
      const key = n.content.slice(0, gt).trim();
      const { cls, args } = vgParseArgs(n.content.slice(gt + 1), pcls, pargs);
      const stypes = ptypes.concat([key]);
      if ('singleton' in args) { if (args.singleton === true) singletons.add(key); delete args.singleton; }
      if (n.children.length === 0) {
        if (!(key in defs)) keys.push(key);      // py asserts on duplicates; keep first
        defs[key] = { cls, args, stypes };
      } else {
        walkSprites(n.children, cls, args, stypes);
      }
    }
  }
  for (const sec of tree.children) {
    const head = sec.content.split(/\s+/)[0];
    if (head === 'SpriteSet') walkSprites(sec.children, null, {}, []);
    else if (head === 'LevelMapping') {
      for (const n of sec.children) {
        const gt = n.content.indexOf('>');
        charMap[n.content.slice(0, gt).trim()] = n.content.slice(gt + 1).trim().split(/\s+/).filter(Boolean);
      }
    } else if (head === 'InteractionSet') {
      for (const n of sec.children) {
        if (!n.content.includes('>')) continue;
        const gt = n.content.indexOf('>');
        const objs = n.content.slice(0, gt).trim().split(/\s+/).filter(Boolean);
        const { cls, args } = vgParseArgs(n.content.slice(gt + 1));
        const score = args.scoreChange || 0;
        delete args.scoreChange;
        for (const actee of objs.slice(1)) interactions.push({ actor: objs[0], actee, name: cls, score, args });
      }
    } else if (head === 'TerminationSet') {
      for (const n of sec.children) { const { cls, args } = vgParseArgs(n.content); terminations.push({ type: cls, args }); }
    }
  }
  return { header: header.args, defs, keys, charMap, interactions, terminations, singletons };
}
