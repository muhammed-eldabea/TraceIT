'use strict';
const assert = require('node:assert/strict');
const {applyEdit} = require('../src/configEdit');

const base = () => JSON.stringify({
  sources: [
    {name: 'requirements', include: 'req.md', artifact: '^# (?<id>REQ-[0-9]+)$'},
    {name: 'tests', include: 'tests.md', artifact: '^# (?<id>TEST-[0-9]+)$', reference: 'Verifies: (?<target>REQ-[0-9]+)', group: 'verification'},
    {name: 'code', include: 'src/**/*.js', artifact: '^// (?<id>IMPL-[0-9]+)$'}
  ],
  links: [{from: 'tests', to: 'requirements', type: 'verifies'}, {from: 'code', to: 'requirements', type: 'implements'}],
  groupLinks: [{from: 'verification', to: 'requirements', type: 'verifies'}]
});
const parse = result => JSON.parse(result.text);
const names = config => config.sources.map(source => source.name);

// reorder
assert.deepEqual(names(parse(applyEdit(base(), {op: 'moveSource', name: 'code', direction: 'up'}))), ['requirements', 'code', 'tests']);
assert.deepEqual(names(parse(applyEdit(base(), {op: 'moveSource', name: 'requirements', toIndex: 2}))), ['tests', 'code', 'requirements']);
assert.throws(() => applyEdit(base(), {op: 'moveSource', name: 'requirements', direction: 'up'}), /already at that end/);
assert.throws(() => applyEdit(base(), {op: 'moveSource', name: 'missing', direction: 'up'}), /Unknown source/);

// edit regex and format, including clearing the optional reference regex
const edited = parse(applyEdit(base(), {op: 'updateSource', name: 'tests', changes: {artifact: '^## (?<id>TC-[0-9]+)$', reference: '', format: 'docx'}}));
assert.equal(edited.sources[1].artifact, '^## (?<id>TC-[0-9]+)$');
assert.equal(edited.sources[1].format, 'docx');
assert.equal('reference' in edited.sources[1], false);
assert.throws(() => applyEdit(base(), {op: 'updateSource', name: 'tests', changes: {artifact: '('}}), /tests artifact/);
assert.throws(() => applyEdit(base(), {op: 'updateSource', name: 'tests', changes: {artifact: ''}}), /cannot be empty/);
assert.throws(() => applyEdit(base(), {op: 'updateSource', name: 'tests', changes: {name: 'x'}}), /cannot be edited/);
assert.throws(() => applyEdit(base(), {op: 'updateSource', name: 'tests', changes: {include: 7}}), /must be text/);
assert.throws(() => applyEdit(base(), {op: 'updateSource', name: 'tests', changes: {format: 'bogus'}}), /Unsupported source format/);

// add
const added = parse(applyEdit(base(), {op: 'addSource', source: {name: 'docs', include: '**/*.md', artifact: '^# (?<id>DOC-[0-9]+)$'}}));
assert.deepEqual(names(added), ['requirements', 'tests', 'code', 'docs']);
assert.equal(added.sources[3].format, 'text');
assert.throws(() => applyEdit(base(), {op: 'addSource', source: {name: 'tests', include: 'x', artifact: '(?<id>x)'}}), /already exists/);
assert.throws(() => applyEdit(base(), {op: 'addSource', source: {name: ' ', include: 'x', artifact: '(?<id>x)'}}), /cannot be empty/);

// remove cascades to coverage rules and orphaned group rules, and reports them
const removed = applyEdit(base(), {op: 'removeSource', name: 'tests'});
assert.deepEqual(names(parse(removed)), ['requirements', 'code']);
assert.deepEqual(parse(removed).links, [{from: 'code', to: 'requirements', type: 'implements'}]);
assert.equal('groupLinks' in parse(removed), false);
assert.equal(removed.removedRules.length, 2);
assert.match(removed.removedRules[0], /tests → requirements/);
const only = JSON.stringify({sources: [{name: 'a', include: 'a', artifact: '(?<id>a)'}]});
assert.throws(() => applyEdit(only, {op: 'removeSource', name: 'a'}), /at least one source/);

// rules
const typed = parse(applyEdit(base(), {op: 'updateRule', index: 0, type: 'validates'}));
assert.equal(typed.links[0].type, 'validates');
assert.throws(() => applyEdit(base(), {op: 'updateRule', index: 0, type: ' '}), /cannot be empty/);
assert.throws(() => applyEdit(base(), {op: 'updateRule', index: 9, type: 'x'}), /no longer exists/);
assert.equal(parse(applyEdit(base(), {op: 'removeRule', index: 0})).links.length, 1);
assert.throws(() => applyEdit(base(), {op: 'addRule', from: 'tests', to: 'requirements', type: 'verifies'}), /already exists/);
assert.equal(parse(applyEdit(base(), {op: 'addRule', from: 'requirements', to: 'code', type: 'derives'})).links.length, 3);

// guards
assert.throws(() => applyEdit(base(), {op: 'constructor'}), /Unsupported project edit/);
assert.throws(() => applyEdit('{', {op: 'moveSource', name: 'x'}), /Invalid configuration JSON/);
assert.equal(applyEdit(base(), {op: 'moveSource', name: 'code', direction: 'up'}).text.includes('_artifact'), false);
console.log('Config edit tests passed');
