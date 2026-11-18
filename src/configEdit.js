'use strict';
const engine = require('./engine');

// Pure project-configuration edits. Each operation takes the saved configuration text and
// returns the new text plus a human-readable summary, so the dashboard host can validate,
// preview cascades, and write through a single path.

const EDITABLE_FIELDS = ['include', 'artifact', 'reference', 'format', 'group', 'sheet'];
const OPTIONAL_FIELDS = new Set(['reference', 'group', 'sheet']);
const FILE_FORMATS = ['text', 'docx', 'odt', 'xlsx', 'pdf', 'pptx'];

function serialize(config) {
  return JSON.stringify(config, (key, value) => (key === '_artifact' || key === '_reference' ? undefined : value), 2) + '\n';
}

function indexOfSource(config, name) {
  const index = config.sources.findIndex(source => source.name === name);
  if (index < 0) throw new Error(`Unknown source: ${name}`);
  return index;
}

function groupsOf(config) {
  return new Set(config.sources.map(source => source.group || source.name));
}

// Drop coverage rules that no longer have valid endpoints after sources changed.
function pruneRules(config) {
  const names = new Set(config.sources.map(source => source.name));
  const groups = groupsOf(config);
  const removed = [];
  const keepSource = rule => names.has(rule.from) && names.has(rule.to);
  const keepGroup = rule => groups.has(rule.from) && groups.has(rule.to);
  const describe = (scope, rule) => `${scope}: ${rule.from} → ${rule.to} (${rule.type || 'references'})`;
  if (Array.isArray(config.links)) {
    config.links = config.links.filter(rule => keepSource(rule) || (removed.push(describe('source rule', rule)), false));
  }
  if (Array.isArray(config.groupLinks)) {
    config.groupLinks = config.groupLinks.filter(rule => keepGroup(rule) || (removed.push(describe('group rule', rule)), false));
    if (!config.groupLinks.length) delete config.groupLinks;
  }
  return removed;
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} cannot be empty`);
  return value.trim();
}

function cleanPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Source changes must be an object');
  const cleaned = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE_FIELDS.includes(key)) throw new Error(`Field cannot be edited here: ${key}`);
    if (value !== null && typeof value !== 'string') throw new Error(`${key} must be text`);
    cleaned[key] = value === null ? '' : value.trim();
  }
  return cleaned;
}

const operations = {
  addSource(config, op) {
    const source = op.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Source definition is missing');
    const name = requireText(source.name, 'Source name');
    if (config.sources.some(existing => existing.name === name)) throw new Error(`A source named ${name} already exists`);
    const {name: ignoredName, ...fields} = source;
    const created = {name};
    for (const [key, value] of Object.entries(cleanPatch(fields))) {
      if (value !== '') created[key] = value;
    }
    if (!created.format) created.format = 'text';
    config.sources.push(created);
    return `Added source ${name}`;
  },
  updateSource(config, op) {
    const source = config.sources[indexOfSource(config, op.name)];
    const patch = cleanPatch(op.changes);
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' && OPTIONAL_FIELDS.has(key)) delete source[key];
      else if (value === '' && FILE_FORMATS.includes(patch.format || source.format || 'text')) throw new Error(`${key} cannot be empty for this source`);
      else source[key] = value;
    }
    return `Updated source ${op.name}`;
  },
  removeSource(config, op) {
    const index = indexOfSource(config, op.name);
    if (config.sources.length === 1) throw new Error('A project needs at least one source');
    config.sources.splice(index, 1);
    return `Removed source ${op.name}`;
  },
  moveSource(config, op) {
    const from = indexOfSource(config, op.name);
    const to = Number.isInteger(op.toIndex) ? op.toIndex : from + (op.direction === 'up' ? -1 : op.direction === 'down' ? 1 : 0);
    if (to < 0 || to >= config.sources.length) throw new Error('Source is already at that end of the list');
    const [moved] = config.sources.splice(from, 1);
    config.sources.splice(to, 0, moved);
    return `Moved source ${op.name}`;
  },
  addRule(config, op) {
    const rule = {from: requireText(op.from, 'Covering source'), to: requireText(op.to, 'Covered source'), type: requireText(op.type, 'Link type')};
    config.links = config.links || [];
    if (config.links.some(existing => existing.from === rule.from && existing.to === rule.to && (existing.type || 'references') === rule.type)) throw new Error('That coverage rule already exists');
    config.links.push(rule);
    return `Added coverage rule ${rule.from} → ${rule.to}`;
  },
  updateRule(config, op) {
    const rule = (config.links || [])[op.index];
    if (!rule) throw new Error('Coverage rule no longer exists');
    const type = requireText(op.type, 'Link type');
    if (config.links.some((existing, index) => index !== op.index && existing.from === rule.from && existing.to === rule.to && (existing.type || 'references') === type)) throw new Error('That coverage rule already exists');
    rule.type = type;
    return `Updated coverage rule ${rule.from} → ${rule.to}`;
  },
  removeRule(config, op) {
    if (!(config.links || [])[op.index]) throw new Error('Coverage rule no longer exists');
    const [rule] = config.links.splice(op.index, 1);
    return `Removed coverage rule ${rule.from} → ${rule.to}`;
  }
};

// Apply one operation to saved configuration text. Returns {text, summary, removedRules}.
function applyEdit(configText, op) {
  if (!op || typeof op.op !== 'string' || !Object.prototype.hasOwnProperty.call(operations, op.op)) throw new Error('Unsupported project edit');
  let config;
  try { config = JSON.parse(configText); } catch (error) { throw new Error(`Invalid configuration JSON: ${error.message}`); }
  const summary = operations[op.op](config, op);
  const removedRules = pruneRules(config);
  engine.validate(config);
  return {text: serialize(config), summary, removedRules};
}

module.exports = {applyEdit, serialize, EDITABLE_FIELDS};
