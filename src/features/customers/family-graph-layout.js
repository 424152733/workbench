export function getFamilyGraphColumns(width,dimensions={}) {
  const nodeWidth=dimensions.nodeWidth || 218;
  const gapX=dimensions.gapX ?? 130;
  const availableWidth=Math.max(nodeWidth,Number(width) || 700);
  return Math.max(1,Math.min(3,Math.floor((availableWidth-32+gapX)/(nodeWidth+gapX))));
}

export function getFamilyGraphLayoutRows(data={},columns=3) {
  const nodes=Array.isArray(data.nodes)?data.nodes:[];
  if (!nodes.length) return [];

  const maxColumns=Math.max(1,Math.floor(Number(columns) || 1));
  const nodeById=new Map(nodes.map((node)=>[String(node.id),node]));
  const parentById=new Map(nodes.map((node)=>[String(node.id),String(node.id)]));
  const find=(id)=>{
    const parent=parentById.get(id);
    if (parent===id) return id;
    const root=find(parent);
    parentById.set(id,root);
    return root;
  };
  const union=(left,right)=>{
    const leftRoot=find(left);
    const rightRoot=find(right);
    if (leftRoot!==rightRoot) parentById.set(rightRoot,leftRoot);
  };

  for (const relation of Array.isArray(data.lines)?data.lines:[]) {
    if (!['sibling','partner'].includes(relation.kind)) continue;
    const left=String(relation.memberAId);
    const right=String(relation.memberBId);
    if (nodeById.has(left) && nodeById.has(right)) union(left,right);
  }

  const groups=[];
  const groupByRoot=new Map();
  for (const node of nodes) {
    const root=find(String(node.id));
    if (!groupByRoot.has(root)) {
      const group=[];
      groupByRoot.set(root,group);
      groups.push(group);
    }
    groupByRoot.get(root).push(node);
  }

  const groupIndexByMemberId=new Map();
  groups.forEach((group,index)=>group.forEach((node)=>groupIndexByMemberId.set(String(node.id),index)));
  const childGroups=groups.map(()=>new Set());
  const incomingCount=groups.map(()=>0);
  const canReach=(from,target)=>{
    const pending=[from];
    const visited=new Set();
    while (pending.length) {
      const current=pending.pop();
      if (current===target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of childGroups[current]) pending.push(next);
    }
    return false;
  };

  for (const relation of Array.isArray(data.lines)?data.lines:[]) {
    if (relation.kind!=='parent_child') continue;
    const parentIndex=groupIndexByMemberId.get(String(relation.memberAId));
    const childIndex=groupIndexByMemberId.get(String(relation.memberBId));
    if (parentIndex==null || childIndex==null || parentIndex===childIndex || childGroups[parentIndex].has(childIndex)) continue;
    // Ignore a contradictory edge if it would put an ancestor below itself.
    if (canReach(childIndex,parentIndex)) continue;
    childGroups[parentIndex].add(childIndex);
    incomingCount[childIndex]+=1;
  }

  const generations=groups.map(()=>0);
  const ready=groups.map((_,index)=>index).filter((index)=>incomingCount[index]===0);
  while (ready.length) {
    const parentIndex=ready.shift();
    for (const childIndex of childGroups[parentIndex]) {
      generations[childIndex]=Math.max(generations[childIndex],generations[parentIndex]+1);
      incomingCount[childIndex]-=1;
      if (incomingCount[childIndex]===0) ready.push(childIndex);
    }
  }

  const groupsByGeneration=new Map();
  groups.forEach((group,index)=>{
    const generation=generations[index];
    const generationGroups=groupsByGeneration.get(generation) || [];
    generationGroups.push(group);
    groupsByGeneration.set(generation,generationGroups);
  });

  const rows=[];
  for (const generation of [...groupsByGeneration.keys()].sort((left,right)=>left-right)) {
    let row=[];
    const flushRow=()=>{
      if (row.length) rows.push(row);
      row=[];
    };
    for (const group of groupsByGeneration.get(generation)) {
      if (group.length>maxColumns) {
        flushRow();
        for (let index=0;index<group.length;index+=maxColumns) rows.push(group.slice(index,index+maxColumns));
        continue;
      }
      if (row.length+group.length>maxColumns) flushRow();
      row.push(...group);
    }
    flushRow();
  }
  return rows;
}

export function positionFamilyGraphData(data={},viewSize={},dimensions={}) {
  const nodes=Array.isArray(data.nodes)?data.nodes:[];
  if (!nodes.length) return {...data,nodes};

  const nodeWidth=dimensions.nodeWidth || 218;
  const nodeHeight=dimensions.nodeHeight || 88;
  const gapX=dimensions.gapX ?? 130;
  const preferredGapY=dimensions.gapY ?? 72;
  const width=Math.max(nodeWidth,Number(viewSize.width) || 700);
  const height=Math.max(nodeHeight,Number(viewSize.height) || 430);
  const columns=getFamilyGraphColumns(width,dimensions);
  const layoutRows=getFamilyGraphLayoutRows(data,columns);
  const rowCount=layoutRows.length;
  const gapY=rowCount>1 ? Math.max(12,Math.min(preferredGapY,(height-rowCount*nodeHeight)/(rowCount-1))) : 0;
  const contentHeight=rowCount*nodeHeight+(rowCount-1)*gapY;
  const startY=Math.max(24,(height-contentHeight)/2);

  const positionedRows=layoutRows.map((rowNodes,row)=>{
    const rowWidth=rowNodes.length*nodeWidth+(rowNodes.length-1)*gapX;
    const startX=Math.max(24,(width-rowWidth)/2);
    return rowNodes.map((node,column)=>({...node,x:startX+column*(nodeWidth+gapX),y:startY+row*(nodeHeight+gapY)}));
  });
  const rowByMemberId=new Map();
  const positionByMemberId=new Map();
  positionedRows.forEach((row,rowIndex)=>row.forEach((node)=>{
    rowByMemberId.set(String(node.id),rowIndex);
    positionByMemberId.set(String(node.id),node);
  }));
  const childrenByParentId=new Map();
  for (const relation of Array.isArray(data.lines)?data.lines:[]) {
    if (relation.kind!=='parent_child') continue;
    const parentId=String(relation.memberAId);
    const childId=String(relation.memberBId);
    if (!positionByMemberId.has(parentId) || !positionByMemberId.has(childId) || rowByMemberId.get(childId)<=rowByMemberId.get(parentId)) continue;
    const children=childrenByParentId.get(parentId) || [];
    children.push(positionByMemberId.get(childId));
    childrenByParentId.set(parentId,children);
  }
  for (const [parentId,children] of childrenByParentId) {
    const parent=positionByMemberId.get(parentId);
    const parentRow=positionedRows[rowByMemberId.get(parentId)];
    if (parentRow.length!==1) continue;
    const childCenter=children.reduce((sum,child)=>sum+child.x+nodeWidth/2,0)/children.length;
    parent.x=Math.max(24,Math.min(width-nodeWidth-24,childCenter-nodeWidth/2));
  }

  return {
    ...data,
    nodes:positionedRows.flat(),
  };
}

export function getFamilyGraphConnection(from,to,dimensions={}) {
  const nodeWidth=dimensions.nodeWidth || 218;
  const nodeHeight=dimensions.nodeHeight || 88;
  const fromCenter={x:from.x+nodeWidth/2,y:from.y+nodeHeight/2};
  const toCenter={x:to.x+nodeWidth/2,y:to.y+nodeHeight/2};
  const dx=toCenter.x-fromCenter.x;
  const dy=toCenter.y-fromCenter.y;

  if (Math.abs(dx)>=Math.abs(dy)) {
    const direction=dx>=0?1:-1;
    const start={x:from.x+(direction>0?nodeWidth:0),y:fromCenter.y};
    const end={x:to.x+(direction>0?0:nodeWidth),y:toCenter.y};
    const curve=Math.max(30,Math.abs(end.x-start.x)*0.45);
    return {
      path:dimensions.straight ? `M ${start.x} ${start.y} L ${end.x} ${end.y}` : `M ${start.x} ${start.y} C ${start.x+direction*curve} ${start.y}, ${end.x-direction*curve} ${end.y}, ${end.x} ${end.y}`,
      labelX:(start.x+end.x)/2,
      labelY:(start.y+end.y)/2,
      orientation:'horizontal',
      forward:direction>0,
    };
  }

  const direction=dy>=0?1:-1;
  const start={x:fromCenter.x,y:from.y+(direction>0?nodeHeight:0)};
  const end={x:toCenter.x,y:to.y+(direction>0?0:nodeHeight)};
  const curve=Math.max(30,Math.abs(end.y-start.y)*0.45);
  return {
    path:dimensions.straight ? `M ${start.x} ${start.y} L ${end.x} ${end.y}` : `M ${start.x} ${start.y} C ${start.x} ${start.y+direction*curve}, ${end.x} ${end.y-direction*curve}, ${end.x} ${end.y}`,
    labelX:(start.x+end.x)/2,
    labelY:(start.y+end.y)/2,
    orientation:'vertical',
    forward:direction>0,
  };
}

export function getFamilyGraphRelationLabel(relation,connection={}) {
  if (relation.kind==='parent_child') {
    if (connection.orientation==='vertical') return connection.forward ? '父母 ↓ 子女' : '子女 ↑ 父母';
    return connection.forward===false ? '子女 ← 父母' : '父母 → 子女';
  }
  if (relation.kind==='partner') return '配偶 / 伴侣';
  if (relation.kind==='sibling') return '兄弟姐妹';
  return relation.kind==='other' ? relation.label || '其他关系' : '家庭关系';
}
