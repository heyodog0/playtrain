// transpile.mjs — JS game (subset) -> C++ game twin, for the native compiler.
//
//   node compile/transpile.mjs <game.js> > games/<game>.cpp
//
// Emits the same shape as the hand-port games/bigfish.cpp (the codegen contract):
// object-literal shapes -> structs, arrays -> std::vector, mulberry32 -> functor,
// numbers -> double (JS has no int type), gameState string -> const char*. The
// differential gate (gate.sh) is the correctness arbiter.
import { readFileSync } from 'fs';
import { parse } from 'acorn';
import { basename } from 'path';

const file = process.argv[2];
if (!file) { console.error('usage: transpile.mjs <game.js>'); process.exit(1); }
const src = readFileSync(file, 'utf8');
const ast = parse(src, { ecmaVersion: 2022 });
const gameName = basename(file).replace(/\.js$/, '');

// ---------------------------------------------------------------------------
// mapping tables
// ---------------------------------------------------------------------------
const MATH_FN = {
  floor: 'js::floor', abs: 'js::abs', ceil: 'js::ceil', sqrt: 'js::sqrt',
  pow: 'js::pow', min: 'js::min', max: 'js::max', sin: 'js::sin', cos: 'js::cos',
  atan2: 'js::atan2', hypot: 'js::hypot', round: 'js::jround',
};
const P5_FUNCS = new Set([
  'createCanvas', 'background', 'fill', 'stroke', 'noStroke', 'noFill', 'strokeWeight',
  'rect', 'ellipse', 'circle', 'triangle', 'quad', 'line', 'rectMode', 'ellipseMode',
  'push', 'pop', 'translate', 'rotate', 'scale', 'beginShape', 'vertex', 'endShape',
  'textSize', 'textAlign', 'textFont', 'text', 'keyIsDown', 'color', 'noSmooth', 'tint',
]);
const JS_HELPERS = new Set(['dist', 'constrain', 'lerp', 'map']);
const P5_GETTERS = new Set(['width', 'height', 'frameCount']);
const P5_CONSTS = new Set([
  'PI', 'TWO_PI', 'HALF_PI', 'LEFT', 'CENTER', 'CORNER', 'CLOSE',
  'LEFT_ARROW', 'RIGHT_ARROW', 'UP_ARROW', 'DOWN_ARROW', 'ENTER',
]);
const CONTRACT_FNS = new Set(['setup', 'resetGame', 'draw', 'getGameState']);
const NOOP_FNS = new Set(['noSmooth', 'tint', 'loop', 'noLoop', 'textFont', 'noCursor', 'cursor', 'frameRate', 'smooth']);
// calls whose args never affect the observation -> emit as a no-op, DROPPING args
// (sidesteps string-concatenation etc. that only feeds on-screen text).
const DROP_ARG_FNS = new Set(['text', 'fill_text', 'print', 'console.log']);
const MATH_CONST = {
  PI: 'p5::PI', E: '2.718281828459045', SQRT2: '1.4142135623730951',
  SQRT1_2: '0.7071067811865476', LN2: '0.6931471805599453', LN10: '2.302585092994046',
  LOG2E: '1.4426950408889634', LOG10E: '0.4342944819032518',
};

// ---------------------------------------------------------------------------
// type descriptors + environment
// ---------------------------------------------------------------------------
const T = {
  double: { k: 'double' }, bool: { k: 'bool' }, cstr: { k: 'cstr' },
  auto: { k: 'auto' }, rng: { k: 'rng' },
  struct: (name) => ({ k: 'struct', name }),
  vec: (elem) => ({ k: 'vec', elem }),
};
function ctype(t) {
  switch (t.k) {
    case 'double': return 'double';
    case 'bool': return 'bool';
    case 'cstr': return 'const char*';
    case 'rng': return 'js::Mulberry32';
    case 'struct': return t.name;
    case 'vec': return `std::vector<${ctype(t.elem)}>`;
    default: return 'auto';
  }
}
const env = new Map();   // name -> type descriptor (globals + params + locals, flat)
const nullInit = new Set(); // globals initialized to null (get a __set companion)

// ---------------------------------------------------------------------------
// struct-shape inference
// ---------------------------------------------------------------------------
const structs = new Map();   // signature -> { name, fields: [key,...] }
function sig(obj) { return obj.properties.map(p => p.key.name || p.key.value).sort().join(','); }
function singular(name) {
  if (!name) return null;
  let n = name[0].toUpperCase() + name.slice(1);
  if (n.endsWith('ies')) return n.slice(0, -3) + 'y';
  if (n.endsWith('es')) return n.slice(0, -2);
  if (n.endsWith('s')) return n.slice(0, -1);
  return n;
}
// walk with parent pointers to derive a naming hint per object literal
function walk(node, parent, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, node, visit));
    else if (v && typeof v.type === 'string') walk(v, node, visit);
  }
}
function objHint(node, parent) {
  if (!parent) return null;
  if (parent.type === 'AssignmentExpression' && parent.right === node && parent.left.type === 'Identifier')
    return parent.left.name;
  if (parent.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'Identifier')
    return parent.id.name;
  if (parent.type === 'CallExpression' && parent.callee.type === 'MemberExpression'
      && parent.callee.property.name === 'push' && parent.callee.object.type === 'Identifier')
    return singular(parent.callee.object.name);
  return null;
}
const hintVotes = new Map();  // signature -> Map(hint->count)
function registerStruct(node, hint) {
  const s = sig(node);
  if (!s) return;
  if (!structs.has(s)) structs.set(s, { name: null, fields: node.properties.map(p => p.key.name || p.key.value) });
  if (hint) {
    if (!hintVotes.has(s)) hintVotes.set(s, new Map());
    const m = hintVotes.get(s);
    m.set(hint, (m.get(hint) || 0) + 1);
  }
}
// object literals that are the getGameState return value -> not real structs
const skipObjs = new Set();
for (const fn of ast.body) {
  if (fn.type === 'FunctionDeclaration' && fn.id.name === 'getGameState') {
    walk(fn.body, null, (n) => { if (n.type === 'ReturnStatement' && n.argument && n.argument.type === 'ObjectExpression') skipObjs.add(n.argument); });
  }
}
// pre-pass: collect object shapes
walk(ast, null, (node, parent) => {
  if (node.type === 'ObjectExpression' && !skipObjs.has(node)) {
    registerStruct(node, singular(objHint(node, parent)) || objHint(node, parent));
  }
});
// finalize struct names
let anon = 0;
const usedNames = new Set();
for (const [s, info] of structs) {
  let name = null;
  const votes = hintVotes.get(s);
  if (votes) { name = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]; }
  if (name) name = name[0].toUpperCase() + name.slice(1);
  if (!name || usedNames.has(name)) name = `Shape${++anon}`;
  usedNames.add(name);
  info.name = name;
}
function structForSig(s) { return structs.get(s); }
function structForObj(node) { return structForSig(sig(node)); }

// ---------------------------------------------------------------------------
// global type inference
// ---------------------------------------------------------------------------
const topDecls = [];  // {name, node, kind}
for (const stmt of ast.body) {
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) topDecls.push({ name: d.id.name, init: d.init, kind: stmt.kind });
  }
}
// collect all assignments per identifier (for global inference)
const assignsTo = new Map();
walk(ast, null, (node) => {
  if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier' && node.operator === '=') {
    if (!assignsTo.has(node.left.name)) assignsTo.set(node.left.name, []);
    assignsTo.get(node.left.name).push(node.right);
  }
});
// find push element types: name -> struct sig
const pushElem = new Map();
walk(ast, null, (node) => {
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && node.callee.property.name === 'push' && node.callee.object.type === 'Identifier') {
    const arg = node.arguments[0];
    if (arg && arg.type === 'ObjectExpression') pushElem.set(node.callee.object.name, structForObj(arg));
  }
});
function inferGlobalType(name, init) {
  const rhss = [init, ...(assignsTo.get(name) || [])].filter(Boolean);
  for (const r of rhss) {
    if (r.type === 'ObjectExpression') { const s = structForObj(r); if (s) return T.struct(s.name); continue; }
    if (r.type === 'CallExpression' && r.callee.type === 'Identifier' && r.callee.name === 'mulberry32') return T.rng;
    if (r.type === 'ArrayExpression') {
      const el = pushElem.get(name);
      return T.vec(el ? T.struct(el.name) : T.double);
    }
    if (r.type === 'Literal' && typeof r.value === 'string') return T.cstr;
    if (r.type === 'Literal' && typeof r.value === 'boolean') return T.bool;
  }
  return T.double;
}
for (const d of topDecls) {
  if (d.init && d.init.type === 'Literal' && d.init.value === null) nullInit.add(d.name);
  env.set(d.name, inferGlobalType(d.name, d.init));
}

// ---------------------------------------------------------------------------
// function return-type table (so callers can type `let x = helper()` and the
// helper's own signature is correct)
// ---------------------------------------------------------------------------
const funcRet = new Map();  // name -> type descriptor
for (const fn of ast.body) {
  if (fn.type !== 'FunctionDeclaration') continue;
  const name = fn.id.name;
  if (name === 'getGameState') { funcRet.set(name, { k: 'state' }); continue; }
  if (CONTRACT_FNS.has(name)) { funcRet.set(name, { k: 'void' }); continue; }
  let rt = { k: 'void' };
  walk(fn.body, null, (n) => {
    if (n.type === 'ReturnStatement' && n.argument && rt.k === 'void') {
      const t = declType(n.argument);
      rt = (t.k === 'auto' || t.k === 'ref') ? T.double : t;
    }
  });
  funcRet.set(name, rt);
}
function retCtype(t) { return t.k === 'void' ? 'void' : t.k === 'state' ? 'State' : ctype(t); }

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------
function isTruthyType(t) { return t && (t.k === 'rng' || t.k === 'struct'); }

function emitExpr(node) {
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') return JSON.stringify(node.value);
      if (typeof node.value === 'boolean') return node.value ? 'true' : 'false';
      if (node.value === null) return 'nullptr';
      return String(node.raw ?? node.value);
    case 'Identifier': {
      if (P5_GETTERS.has(node.name)) return `p5::${node.name}()`;
      if (P5_CONSTS.has(node.name)) return `p5::${node.name}`;
      if (nullInit.has(node.name)) return node.name;  // handled at test sites
      return node.name;
    }
    case 'ThisExpression': return 'this';
    case 'BinaryExpression': return emitBinary(node);
    case 'LogicalExpression': {
      const op = node.operator === '&&' ? '&&' : '||';
      return `(${emitTest(node.left)} ${op} ${emitTest(node.right)})`;
    }
    case 'UnaryExpression': {
      if (node.operator === '!') return `(!${emitTest(node.argument)})`;
      if (node.operator === 'typeof') return `"number"`; // subset: numeric-only typeof
      return `(${node.operator}${emitExpr(node.argument)})`;
    }
    case 'UpdateExpression': {
      const a = emitExpr(node.argument);
      return node.prefix ? `${node.operator}${a}` : `${a}${node.operator}`;
    }
    case 'AssignmentExpression': {
      const left = emitExpr(node.left);
      // string-typed lvalue assigned a literal: pointer assignment is fine
      return `${left} ${node.operator} ${emitExpr(node.right)}`;
    }
    case 'ConditionalExpression':
      return `(${emitTest(node.test)} ? ${emitExpr(node.consequent)} : ${emitExpr(node.alternate)})`;
    case 'MemberExpression': return emitMember(node);
    case 'CallExpression': return emitCall(node);
    case 'ObjectExpression': return emitObject(node);
    case 'ArrayExpression':
      if (node.elements.length === 0) return '{}';
      return `{${node.elements.map(emitExpr).join(', ')}}`;
    case 'SequenceExpression': return `(${node.expressions.map(emitExpr).join(', ')})`;
    default:
      throw new Error(`UNSUPPORTED: expression ${node.type}`);
  }
}

// emit a node used in a boolean test position (handles object-truthiness)
function emitTest(node) {
  if (node.type === 'Identifier' && nullInit.has(node.name)) return `${node.name}__set`;
  return emitExpr(node);
}

function typeOfExpr(node) {
  if (node.type === 'Identifier') return env.get(node.name) || T.auto;
  if (node.type === 'Literal') {
    if (typeof node.value === 'string') return T.cstr;
    if (typeof node.value === 'boolean') return T.bool;
    return T.double;
  }
  if (node.type === 'MemberExpression' && node.computed) {
    const ot = typeOfExpr(node.object);
    if (ot && ot.k === 'vec') return ot.elem;
  }
  if (node.type === 'MemberExpression' && !node.computed) {
    // struct field access -> assume double (all numeric fields)
    return T.double;
  }
  return T.auto;
}

function emitBinary(node) {
  const opMap = { '===': '==', '!==': '!=', '==': '==', '!=': '!=' };
  const lt = typeOfExpr(node.left), rt = typeOfExpr(node.right);
  const isStr = (n, t) => (n.type === 'Literal' && typeof n.value === 'string') || (t && t.k === 'cstr');
  // string equality -> strcmp
  if ((node.operator === '===' || node.operator === '!==' || node.operator === '==' || node.operator === '!=')
      && (isStr(node.left, lt) || isStr(node.right, rt))) {
    const cmp = `std::strcmp(${emitExpr(node.left)}, ${emitExpr(node.right)})`;
    return `(${cmp} ${node.operator === '!==' || node.operator === '!=' ? '!=' : '=='} 0)`;
  }
  if (node.operator === '%') return `js::mod(${emitExpr(node.left)}, ${emitExpr(node.right)})`;
  if (node.operator === '**') return `js::pow(${emitExpr(node.left)}, ${emitExpr(node.right)})`;
  const op = opMap[node.operator] || node.operator;
  return `(${emitExpr(node.left)} ${op} ${emitExpr(node.right)})`;
}

function emitMember(node) {
  // Math.PI and friends (constant property access, not a call)
  if (!node.computed && node.object.type === 'Identifier' && node.object.name === 'Math'
      && MATH_CONST[node.property.name]) {
    return MATH_CONST[node.property.name];
  }
  const ot = typeOfExpr(node.object);
  // array/string .length
  if (!node.computed && node.property.name === 'length') {
    if (ot && ot.k === 'vec') return `(double)${emitExpr(node.object)}.size()`;
  }
  if (node.computed) {
    // arr[i] -> arr[(long)(i)]  (JS number index -> integer)
    if (ot && ot.k === 'vec') return `${emitExpr(node.object)}[(long)(${emitExpr(node.property)})]`;
    return `${emitExpr(node.object)}[${emitExpr(node.property)}]`;
  }
  return `${emitExpr(node.object)}.${node.property.name}`;
}

function emitObject(node) {
  const st = structForObj(node);
  if (!st) throw new Error('UNSUPPORTED: dynamic/empty object shape {' + sig(node) + '}');
  const byKey = new Map(node.properties.map(p => [p.key.name || p.key.value, p.value]));
  const vals = st.fields.map(f => emitExpr(byKey.get(f)));
  return `${st.name}{${vals.join(', ')}}`;
}

function emitCall(node) {
  const c = node.callee;
  const args = node.arguments.map(emitExpr);
  // Math.*
  if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'Math') {
    const fn = c.property.name;
    if (fn === 'imul') return `(double)js::imul(js::to_int32(${args[0]}), js::to_int32(${args[1]}))`;
    if (fn === 'random') return 'js::random()';
    if (MATH_FN[fn]) return `${MATH_FN[fn]}(${args.join(', ')})`;
    throw new Error('UNSUPPORTED: Math.' + fn);
  }
  // method calls on arrays
  if (c.type === 'MemberExpression' && c.computed === false) {
    const objName = c.object.type === 'Identifier' ? c.object.name : null;
    const ot = typeOfExpr(c.object);
    const m = c.property.name;
    const objStr = emitExpr(c.object);
    if (ot && ot.k === 'vec') {
      if (m === 'push') return `${objStr}.push_back(${args[0]})`;
      if (m === 'splice') {
        const i = `(long)(${args[0]})`;
        if (node.arguments.length >= 2) return `${objStr}.erase(${objStr}.begin()+${i}, ${objStr}.begin()+${i}+(long)(${args[1]}))`;
        return `${objStr}.erase(${objStr}.begin()+${i}, ${objStr}.end())`;
      }
      if (m === 'pop') return `${objStr}.pop_back()`;
    }
    if (objName === 'console') return '(void)0';
  }
  // rng()  (callee is an Identifier of type rng) -> functor call
  if (c.type === 'Identifier') {
    const ct = env.get(c.name);
    if (ct && ct.k === 'rng') return `${c.name}()`;
    if (DROP_ARG_FNS.has(c.name)) return '(void)0';   // e.g. text(): args never affect obs
    if (NOOP_FNS.has(c.name)) return '(void)0';
    if (P5_FUNCS.has(c.name)) return `p5::${c.name}(${args.join(', ')})`;
    if (JS_HELPERS.has(c.name)) return `js::${c.name}(${args.join(', ')})`;
    if (c.name === 'mulberry32') return `js::Mulberry32(${args.join(', ')})`;
    return `${c.name}(${args.join(', ')})`;  // user helper
  }
  return `${emitExpr(c)}(${args.join(', ')})`;
}

// ---------------------------------------------------------------------------
// statements
// ---------------------------------------------------------------------------
// Concrete local type. JS numbers are ALL doubles, so numeric locals must be
// `double` (never `auto`, which deduces `int` from `let x=0` and would give
// integer division / wrong bit patterns). Struct/vector aliases become `auto&`.
function declType(init) {
  if (!init) return T.auto;
  switch (init.type) {
    case 'ObjectExpression': { const s = structForObj(init); return s ? T.struct(s.name) : T.auto; }
    case 'CallExpression':
      if (init.callee.type === 'Identifier' && init.callee.name === 'mulberry32') return T.rng;
      if (init.callee.type === 'Identifier' && funcRet.has(init.callee.name)) {
        const t = funcRet.get(init.callee.name);
        return (t.k === 'void' || t.k === 'state') ? T.double : t;
      }
      return T.double;  // Math.*, p5 helpers, user numeric helpers
    case 'Literal':
      if (typeof init.value === 'string') return T.cstr;
      if (typeof init.value === 'boolean') return T.bool;
      if (init.value === null) return T.auto;
      return T.double;
    case 'ArrayExpression': {
      const elems = init.elements.filter(Boolean);
      const objEl = elems.find(e => e.type === 'ObjectExpression');
      if (objEl) { const s = structForObj(objEl); if (s) return T.vec(T.struct(s.name)); }
      return T.vec(T.double);
    }
    case 'MemberExpression': {
      if (init.computed) {
        const ot = typeOfExpr(init.object);
        if (ot && ot.k === 'vec') return { k: 'ref', elem: ot.elem };  // alias to element
        return T.double;  // arr[i] of numbers, or 2D handled elsewhere
      }
      if (init.property.name === 'length') return T.double;
      return T.double;  // struct field (all numeric)
    }
    case 'Identifier': {
      const t = typeOfExpr(init);
      if (t && (t.k === 'struct' || t.k === 'vec')) return { k: 'ref', elem: t };  // object alias (JS ref semantics)
      if (t && (t.k === 'bool' || t.k === 'cstr')) return t;
      return T.double;
    }
    case 'BinaryExpression': {
      const cmp = ['<', '>', '<=', '>=', '===', '!==', '==', '!=', 'instanceof', 'in'];
      return cmp.includes(init.operator) ? T.bool : T.double;
    }
    case 'LogicalExpression': return T.bool;
    case 'UnaryExpression': return init.operator === '!' ? T.bool : T.double;
    case 'ConditionalExpression': {
      const tc = declType(init.consequent);
      return tc.k === 'auto' ? T.double : tc;
    }
    default: return T.double;
  }
}

function emitVarDecl(node, indent) {
  const out = [];
  for (const d of node.declarations) {
    const t = declType(d.init);
    let cty;
    if (t.k === 'ref') { cty = 'auto&'; env.set(d.id.name, t.elem); }
    else if (t.k === 'auto') { cty = 'auto'; env.set(d.id.name, T.auto); }
    else { cty = ctype(t); env.set(d.id.name, t); }
    const init = d.init ? ` = ${emitExpr(d.init)}` : '';
    out.push(`${indent}${cty} ${d.id.name}${init};`);
  }
  return out.join('\n');
}

function emitStmt(node, indent) {
  switch (node.type) {
    case 'VariableDeclaration': return emitVarDecl(node, indent);
    case 'ExpressionStatement': return `${indent}${emitExpr(node.expression)};`;
    case 'BlockStatement': return emitBlock(node, indent);
    case 'IfStatement': {
      let s = `${indent}if (${emitTest(node.test)}) ${emitBlockLike(node.consequent, indent)}`;
      if (node.alternate) {
        s += ` else `;
        s += node.alternate.type === 'IfStatement'
          ? emitStmt(node.alternate, '').trimStart()
          : emitBlockLike(node.alternate, indent);
      }
      return s;
    }
    case 'ForStatement': {
      const init = node.init
        ? (node.init.type === 'VariableDeclaration'
            ? emitVarDecl(node.init, '').trim().replace(/;$/, '')
            : emitExpr(node.init))
        : '';
      const test = node.test ? emitTest(node.test) : '';
      const upd = node.update ? emitExpr(node.update) : '';
      return `${indent}for (${init}; ${test}; ${upd}) ${emitBlockLike(node.body, indent)}`;
    }
    case 'ForOfStatement': {
      const d = node.left.declarations[0];
      const ot = typeOfExpr(node.right);
      const elemRef = ot && ot.k === 'vec';
      if (elemRef) env.set(d.id.name, ot.elem);
      const decl = elemRef ? `auto& ${d.id.name}` : `auto ${d.id.name}`;
      return `${indent}for (${decl} : ${emitExpr(node.right)}) ${emitBlockLike(node.body, indent)}`;
    }
    case 'WhileStatement':
      return `${indent}while (${emitTest(node.test)}) ${emitBlockLike(node.body, indent)}`;
    case 'DoWhileStatement':
      return `${indent}do ${emitBlockLike(node.body, indent)} while (${emitTest(node.test)});`;
    case 'ReturnStatement': {
      if (!node.argument) return `${indent}return;`;
      // getGameState state object
      if (node.argument.type === 'ObjectExpression') {
        const byKey = new Map(node.argument.properties.map(p => [p.key.name || p.key.value, p.value]));
        if (byKey.has('score') && byKey.has('lives') && byKey.has('gameState')) {
          return `${indent}return State{(double)(${emitExpr(byKey.get('score'))}), (double)(${emitExpr(byKey.get('lives'))}), ${emitExpr(byKey.get('gameState'))}};`;
        }
      }
      return `${indent}return ${emitExpr(node.argument)};`;
    }
    case 'BreakStatement': return `${indent}break;`;
    case 'ContinueStatement': return `${indent}continue;`;
    case 'SwitchStatement': {
      let s = `${indent}switch (${emitExpr(node.discriminant)}) {\n`;
      for (const cse of node.cases) {
        s += cse.test ? `${indent}  case ${emitExpr(cse.test)}:\n` : `${indent}  default:\n`;
        for (const st of cse.consequent) s += emitStmt(st, indent + '    ') + '\n';
      }
      return s + `${indent}}`;
    }
    case 'EmptyStatement': return '';
    default:
      throw new Error(`UNSUPPORTED: statement ${node.type}`);
  }
}
function emitBlock(node, indent) {
  const inner = node.body.map(s => emitStmt(s, indent + '  ')).filter(x => x !== '').join('\n');
  return `{\n${inner}\n${indent}}`;
}
function emitBlockLike(node, indent) {
  if (node.type === 'BlockStatement') return emitBlock(node, indent);
  return `{\n${emitStmt(node, indent + '  ')}\n${indent}}`;
}

// ---------------------------------------------------------------------------
// functions
// ---------------------------------------------------------------------------
function paramType(fnName, pName) {
  if (fnName === 'resetGame') return 'uint32_t';
  return 'double';
}
function fnSignature(fn) {
  const name = fn.id.name;
  const params = fn.params.map(p => `${paramType(name, p.name)} ${p.name}`).join(', ');
  const ret = retCtype(funcRet.get(name) || { k: 'void' });
  const isStatic = !CONTRACT_FNS.has(name);
  return { name, params, ret, isStatic };
}

const funcs = ast.body.filter(s => s.type === 'FunctionDeclaration' && s.id.name !== 'mulberry32');

// ---------------------------------------------------------------------------
// assemble output
// ---------------------------------------------------------------------------
let out = '';
out += `// ${gameName}.cpp — GENERATED by native/compile/transpile.mjs from\n`;
out += `// examples/games/js/${gameName}.js. Do not edit by hand.\n`;
out += `#include <vector>\n#include <cstring>\n#include <cstdint>\n`;
out += `#include "../runtime/p5.hpp"\n#include "../runtime/game.hpp"\n#include "../runtime/jsmath.h"\n\n`;
out += `namespace game {\n\n`;

// structs
for (const [, info] of structs) {
  out += `struct ${info.name} { double ${info.fields.join(', ')}; };\n`;
}
out += `\n`;

// globals
for (const d of topDecls) {
  const t = env.get(d.name);
  const isConst = d.kind === 'const';
  let line;
  if (nullInit.has(d.name)) {
    // object/rng var initialized null -> value + a __set companion truthiness flag
    line = `static ${ctype(t)} ${d.name};\nstatic bool ${d.name}__set = false;`;
  } else if (d.init && t.k !== 'vec') {
    line = `static ${isConst ? 'const ' : ''}${ctype(t)} ${d.name} = ${emitExpr(d.init)};`;
  } else {
    line = `static ${ctype(t)} ${d.name};`;  // vectors / no-init default-construct
  }
  out += line + '\n';
}
out += `\n`;

// forward declarations for helper (non-contract) functions
for (const fn of funcs) {
  const s = fnSignature(fn);
  if (s.isStatic) out += `static ${s.ret} ${s.name}(${s.params});\n`;
}
out += `\n`;

// function bodies
for (const fn of funcs) {
  const s = fnSignature(fn);
  // register params in env
  for (const p of fn.params) env.set(p.name, s.name === 'resetGame' ? T.double : T.double);
  let body = emitBlock(fn.body, '');
  // set the __set companion when a null-init global is assigned from a factory/object
  out += `${s.isStatic ? 'static ' : ''}${s.ret} ${s.name}(${s.params}) ${body}\n\n`;
}

out += `}  // namespace game\n`;

// post-process: after assignments to null-init globals, set their __set flag.
// done textually on the emitted assignments `name = ...;`
for (const g of nullInit) {
  const re = new RegExp(`(\\b${g} = [^;]+;)`, 'g');
  out = out.replace(re, `$1 ${g}__set = true;`);
}

process.stdout.write(out);
