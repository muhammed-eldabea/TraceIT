'use strict';
function buildProjectTree(vscode,folder,config,result){
  const state=vscode.TreeItemCollapsibleState;
  const node=(label,collapse,icon)=>{const item=new vscode.TreeItem(label,collapse);item.iconPath=new vscode.ThemeIcon(icon);return item;};
  const root=node(folder.name,state.Expanded,'root-folder');
  root.description=`${result.artifacts.length} artifacts · ${result.links.length} links`;
  root.tooltip=folder.uri.fsPath || folder.name;
  const related=new Map();
  for(const link of result.links)for(const artifact of [link.from,link.to]){if(!related.has(artifact))related.set(artifact,[]);related.get(artifact).push(link);}
  const open=artifact=>({command:'reqtrace.openReference',title:'Open artifact',arguments:[artifact.url?vscode.Uri.parse(artifact.url):artifact.viewUri?vscode.Uri.parse(artifact.viewUri):vscode.Uri.joinPath(folder.uri,artifact.path),Math.max(0,(artifact.line || 1)-1)]});
  const bySource=new Map();for(const artifact of result.artifacts){if(!bySource.has(artifact.source))bySource.set(artifact.source,[]);bySource.get(artifact.source).push(artifact);}
  const sources=(config.sources || []).map(source=>{
    const artifacts=bySource.get(source.name)||[];
    const group=node(source.name,artifacts.length?state.Collapsed:state.None,'files');
    group.description=`${source.format || 'text'} · ${artifacts.length}`;
    group.tooltip=source.include || source.queryUrl || source.query || source.name;
    group.children=artifacts.map(artifact=>{
      const links=related.get(artifact)||[];
      const item=node(`${artifact.id}: ${artifact.title || ''}`,links.length?state.Collapsed:state.None,'symbol-field');
      item.description=`${links.length} links`;
      item.tooltip=`${artifact.path}${artifact.page ? ` page ${artifact.page}` : `:${artifact.line || 1}`}`;
      item.command=open(artifact);
      item.children=links.map(link=>{const other=link.from===artifact?link.to:link.from;const child=node(`${link.type}: ${other.id}`,state.None,'references');child.description=other.source;child.command=open(other);return child;});
      return item;
    });
    return {source,item:group};
  });
  root.children=[];const groups=new Map();
  for(const {source,item} of sources){
    if(!source.group){root.children.push(item);continue;}
    if(!groups.has(source.group)){const group=node(source.group,state.Expanded,'folder');group.children=[];groups.set(source.group,group);root.children.push(group);}
    groups.get(source.group).children.push(item);
  }
  const issues=[...result.diagnostics,...result.unresolved.map(r=>`${r.from.id} → ${r.target}: ${r.reason}`)];
  if(issues.length){const group=node('Issues',state.Collapsed,'warning');group.description=String(issues.length);group.children=issues.map(message=>{const item=node(message,state.None,'warning');item.tooltip=message;return item;});root.children.push(group);}
  return root;
}
module.exports={buildProjectTree};
