'use strict';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// Formats whose extraction is configured by a path and regular expressions.
const PATTERN_FORMATS = [
  {value: 'text', label: 'Text / code'},
  {value: 'docx', label: 'Word (.docx)'},
  {value: 'odt', label: 'OpenDocument (.odt)'},
  {value: 'xlsx', label: 'Excel (.xlsx)'},
  {value: 'pdf', label: 'PDF'},
  {value: 'pptx', label: 'PowerPoint (.pptx)'}
];
const PATTERN_FORMAT_VALUES = PATTERN_FORMATS.map(format => format.value);
const REMOTE_FORMATS = ['codebeamer', 'doors-next'];
const defaultInclude = {text: '**/*.md', docx: '**/*.docx', odt: '**/*.odt', xlsx: '**/*.xlsx', pdf: '**/*.pdf', pptx: '**/*.pptx'};

function formatOptions(selected) {
  return PATTERN_FORMATS.map(format => `<option value="${format.value}"${format.value === selected ? ' selected' : ''}>${escape(format.label)}</option>`).join('');
}

function field(name, value, label, placeholder, extra = '') {
  const text = value === undefined ? '' : value;
  return `<input type="text" spellcheck="false" autocomplete="off" data-field="${name}" data-original="${escape(text)}" value="${escape(text)}" aria-label="${escape(label)}" placeholder="${escape(placeholder)}"${extra}>`;
}

function sourceRow(source, index, count, artifactCounts) {
  const name = escape(source.name);
  const format = source.format || 'text';
  const patternBased = PATTERN_FORMAT_VALUES.includes(format);
  const remote = REMOTE_FORMATS.includes(format);
  const typeCell = patternBased
    ? `<select data-field="format" data-original="${escape(format)}" aria-label="Document type for ${name}">${formatOptions(format)}</select>`
    : `<span class="badge" title="This type is configured with its own fields. Use Edit JSON for advanced changes.">${escape(format)}</span>`;
  const pathCell = remote
    ? `<code class="readonly">${escape(source.queryUrl || source.query || '')}</code>`
    : field('include', source.include, `Files for ${source.name}`, 'Workspace glob, e.g. **/*.md');
  const artifactCell = patternBased ? field('artifact', source.artifact, `Artifact regex for ${source.name}`, '^# (?<id>REQ-[0-9]+): (?<title>.+)$', ' data-requires="(?<id>"') : '<span class="muted">—</span>';
  const referenceCell = patternBased ? field('reference', source.reference, `Reference regex for ${source.name}`, 'Optional: (?<target>REQ-[0-9]+)', ' data-requires="(?<target>"') : '<span class="muted">—</span>';
  return `<tr class="source-row" draggable="true" data-source-row data-name="${name}">`
    + `<td class="order"><span class="drag-handle" aria-hidden="true" title="Drag to reorder">⠿</span><button type="button" class="icon-button" data-move="up" aria-label="Move ${name} up"${index === 0 ? ' disabled' : ''}>▲</button><button type="button" class="icon-button" data-move="down" aria-label="Move ${name} down"${index === count - 1 ? ' disabled' : ''}>▼</button></td>`
    + `<th scope="row" class="source-name">${name}</th>`
    + `<td>${typeCell}</td><td>${pathCell}</td><td>${artifactCell}<div class="field-error" role="alert" data-error-for="artifact"></div></td><td>${referenceCell}<div class="field-error" role="alert" data-error-for="reference"></div></td>`
    + `<td>${field('group', source.group, `Document group for ${source.name}`, 'None')}</td>`
    + `<td class="count">${artifactCounts.get(source.name) || 0}</td>`
    + `<td class="row-actions"><button type="button" class="action small" data-apply disabled>Apply</button><button type="button" class="action small danger" data-remove>Remove</button></td></tr>`;
}

function ruleRows(config) {
  const rules = config.links || [];
  if (!rules.length) return '<tr><td colspan="4" class="muted">No coverage rules yet. Add one below, or drag between document groups in the Overview.</td></tr>';
  return rules.map((rule, index) => `<tr data-rule-row data-index="${index}"><td>${escape(rule.from)} <span aria-hidden="true">→</span><span class="sr-only">covers</span> ${escape(rule.to)}</td><td>${field('type', rule.type || 'references', `Link type for rule ${rule.from} to ${rule.to}`, 'verifies')}</td><td class="row-actions"><button type="button" class="action small" data-apply-rule disabled>Apply</button><button type="button" class="action small danger" data-remove-rule>Remove</button></td></tr>`).join('');
}

function renderProjectPanel({config, folderIndex, version, result}) {
  const sources = config.sources || [];
  const artifactCounts = new Map();
  for (const artifact of result.artifacts) artifactCounts.set(artifact.source, (artifactCounts.get(artifact.source) || 0) + 1);
  const sourceOptions = sources.map(source => `<option value="${escape(source.name)}">${escape(source.name)}</option>`).join('');
  const rows = sources.map((source, index) => sourceRow(source, index, sources.length, artifactCounts)).join('');
  return `<div class="project-editor" data-project-editor data-folder="${folderIndex}" data-version="${escape(version)}">`
    + `<div class="editor-toolbar"><div class="actions"><button type="button" class="action secondary" data-config-command="addSource">Add source with guided setup…</button><button type="button" class="action secondary" data-config-command="assignGroup">Organize document groups…</button><button type="button" class="action secondary" data-config-command="testRegex">Test regex on a document…</button></div>`
    + `<span class="editor-status" data-editor-status role="status" aria-live="polite"></span></div>`
    + `<h3>Documents</h3><p class="hint">Each source is a document set the analysis reads. Drag the ⠿ handle or use ▲ ▼ to reorder, edit a pattern or type, then press <kbd>Enter</kbd> or <b>Apply</b>. Patterns apply line by line; name groups <code>(?&lt;id&gt;…)</code>, <code>(?&lt;title&gt;…)</code> and <code>(?&lt;target&gt;…)</code>.</p>`
    + `<div class="table-wrap"><table class="source-table" data-source-config><thead><tr><th scope="col">Order</th><th scope="col">Source</th><th scope="col">Type</th><th scope="col">Path or query</th><th scope="col">Artifact regex</th><th scope="col">Reference regex</th><th scope="col">Group</th><th scope="col">Artifacts</th><th scope="col">Actions</th></tr></thead><tbody data-source-body>${rows || '<tr><td colspan="9" class="muted">No sources configured.</td></tr>'}</tbody></table></div>`
    + `<details class="add-source"><summary>Add a document source</summary><form data-add-source class="inline-form"><label>Name<input type="text" name="name" required autocomplete="off" placeholder="requirements"></label><label>Type<select name="format">${formatOptions('text')}</select></label><label>Files<input type="text" name="include" required autocomplete="off" value="${escape(defaultInclude.text)}"></label><label>Artifact regex<input type="text" name="artifact" required autocomplete="off" spellcheck="false" value="^(?&lt;id&gt;REQ-[0-9]+): (?&lt;title&gt;.+)$"></label><label>Reference regex (optional)<input type="text" name="reference" autocomplete="off" spellcheck="false" placeholder="(?&lt;target&gt;REQ-[0-9]+)"></label><div class="field-error" role="alert" data-add-error></div><button type="submit" class="action">Add source</button></form><p class="hint">CSV, ReqIF, DOORS and Codebeamer sources need extra fields; use the guided setup above.</p></details>`
    + `<h3>Coverage rules</h3><p class="hint">A rule says which source covers another, for example tests → requirements.</p>`
    + `<div class="table-wrap"><table class="rule-table" data-rule-config><thead><tr><th scope="col">Rule</th><th scope="col">Link type</th><th scope="col">Actions</th></tr></thead><tbody>${ruleRows(config)}</tbody></table></div>`
    + (sources.length > 1 ? `<form data-add-rule class="inline-form"><label>Covering source<select name="from">${sourceOptions}</select></label><label>Covered source<select name="to">${sources.map((source, index) => `<option value="${escape(source.name)}"${index === 1 ? ' selected' : ''}>${escape(source.name)}</option>`).join('')}</select></label><label>Link type<input type="text" name="type" required autocomplete="off" value="verifies"></label><div class="field-error" role="alert" data-add-rule-error></div><button type="submit" class="action">Add coverage rule</button></form>` : '<p class="hint">Add a second source to define coverage rules.</p>')
    + `<details class="connection-actions"><summary>Connector setup</summary><div class="actions"><button type="button" class="action secondary" data-config-command="doorsNext">Configure DOORS Next</button><button type="button" class="action secondary" data-config-command="codebeamer">Configure Codebeamer</button><button type="button" class="action secondary" data-config-command="doorsClassic">Open DOORS Classic script</button></div></details></div>`;
}

module.exports = {renderProjectPanel, PATTERN_FORMATS, defaultInclude};
