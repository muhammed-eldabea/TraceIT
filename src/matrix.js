'use strict';
const escape = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderMatrices(result, limit = 80, folderIndex, projectUri) {
  const indexes=new Map(result.artifacts.map((artifact,index)=>[artifact,index]));
  const label=artifact=>Number.isInteger(folderIndex) ? `<button class="artifact" data-folder="${folderIndex}" data-artifact="${indexes.get(artifact)}">${escape(artifact.id)}</button>` : escape(artifact.id);
  return result.coverage.map(rule => {
    const sources = result.artifacts.filter(a => a.source === rule.from);
    const targets = result.artifacts.filter(a => a.source === rule.to);
    const columns = sources.slice(0,limit), rows = targets.slice(0,limit);
    const pairs = new Map();
    for(const link of result.links.filter(l=>l.from.source===rule.from && l.to.source===rule.to && l.type===rule.type)) {
      const key=`${indexes.get(link.from)}:${indexes.get(link.to)}`;
      pairs.set(key,Boolean(link.manual)||Boolean(pairs.get(key)));
    }
    const headings = columns.map(a => `<th scope="col" title="${escape(a.title)}">${label(a)}</th>`).join('');
    const body = rows.map(target => `<tr><th scope="row" title="${escape(target.title)}">${label(target)}</th>${columns.map(source => {
      const key=`${indexes.get(source)}:${indexes.get(target)}`, linked=pairs.has(key), manual=pairs.get(key);
      if(!projectUri || (linked && !manual))return `<td>${linked ? '<span aria-label="linked">●</span>' : '<span aria-label="no link">—</span>'}</td>`;
      const action=linked?'remove':'add', verb=linked?'Remove manual':'Add';
      return `<td><button class="artifact" data-matrix-${action} data-project="${escape(projectUri)}" data-from-source="${escape(source.source)}" data-from-id="${escape(source.id)}" data-to-source="${escape(target.source)}" data-to-id="${escape(target.id)}" data-link-type="${escape(rule.type)}" aria-label="${verb} ${escape(rule.type)} link from ${escape(source.id)} to ${escape(target.id)}">${linked?'●':'+'}</button></td>`;
    }).join('')}</tr>`).join('');
    const warning = sources.length > limit || targets.length > limit ? `<p>Showing the first ${limit} artifacts per source; the coverage count above includes all artifacts.</p>` : '';
    return `<section class="matrix"><h3>${escape(rule.from)} → ${escape(rule.to)}: ${escape(rule.type)}</h3><p>Rows are covered targets; columns are covering artifacts. A dot indicates a detected link.${projectUri ? ' A plus adds a manual link; select a manual link dot to remove it.' : ''}</p>${warning}${sources.length && targets.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Target / source</th>${headings}</tr></thead><tbody>${body}</tbody></table></div>` : '<p>No artifacts on one or both sides of this rule.</p>'}</section>`;
  }).join('');
}
module.exports = { renderMatrices };
