import assert from 'node:assert/strict';
import test from 'node:test';
import { getFamilyGraphConnection, getFamilyGraphRelationLabel, positionFamilyGraphData } from './features/customers/family-graph-layout.js';

test('family graph places two member cards with a visible gap inside the canvas',()=>{
  const result=positionFamilyGraphData({nodes:[{id:'primary'},{id:'child'}],lines:[]},{width:702,height:428});
  const [primary,child]=result.nodes;
  assert.equal(primary.y,child.y);
  assert.equal(child.x-(primary.x+218),130);
  assert.ok(primary.x>=0 && child.x+218<=702);
  assert.ok(primary.y>=0 && primary.y+88<=428);
});

test('family graph connection endpoints stay on the facing edges of two cards',()=>{
  const connection=getFamilyGraphConnection({x:20,y:30},{x:368,y:30});
  assert.match(connection.path,/M 238 74 C .* 368 74$/);
  assert.equal(connection.labelX,303);
  assert.equal(connection.labelY,74);
});

test('family graph uses straight connector segments when requested for a small graph',()=>{
  const connection=getFamilyGraphConnection({x:20,y:30},{x:20,y:190},{straight:true});
  assert.equal(connection.path,'M 129 118 L 129 190');
});

test('family graph creates a vertical relationship path for stacked nodes',()=>{
  const connection=getFamilyGraphConnection({x:20,y:30},{x:20,y:190});
  assert.match(connection.path,/M 129 118 C .* 129 190$/);
  assert.equal(connection.labelX,129);
  assert.equal(connection.labelY,154);
});

test('parent-child label direction follows the member A to member B path',()=>{
  const relation={kind:'parent_child'};
  const leftToRight=getFamilyGraphConnection({x:20,y:30},{x:368,y:30});
  const rightToLeft=getFamilyGraphConnection({x:368,y:30},{x:20,y:30});
  assert.equal(getFamilyGraphRelationLabel(relation,leftToRight),'父母 → 子女');
  assert.equal(getFamilyGraphRelationLabel(relation,rightToLeft),'子女 ← 父母');
});

test('parent-child label direction follows vertically stacked member cards',()=>{
  const relation={kind:'parent_child'};
  const topToBottom=getFamilyGraphConnection({x:20,y:30},{x:20,y:190});
  const bottomToTop=getFamilyGraphConnection({x:20,y:190},{x:20,y:30});
  assert.equal(getFamilyGraphRelationLabel(relation,topToBottom),'父母 ↓ 子女');
  assert.equal(getFamilyGraphRelationLabel(relation,bottomToTop),'子女 ↑ 父母');
});

test('family graph centers an incomplete final row and preserves other graph data',()=>{
  const lines=[{from:'a',to:'b'}];
  const result=positionFamilyGraphData({nodes:[{id:'a'},{id:'b'},{id:'c'}],lines},{width:702,height:428});
  assert.deepEqual(result.lines,lines);
  assert.equal(result.nodes[2].x,(702-218)/2);
  assert.ok(result.nodes[2].y>result.nodes[1].y);
});

test('wide family graph places parents above children and siblings beside each other',()=>{
  const graph={
    nodes:[{id:'huang',isPrimary:true},{id:'yan'},{id:'zhao'}],
    lines:[
      {memberAId:'yan',memberBId:'huang',kind:'parent_child'},
      {memberAId:'huang',memberBId:'zhao',kind:'sibling'},
    ],
  };
  const result=positionFamilyGraphData(graph,{width:1800,height:500});
  const byId=new Map(result.nodes.map((node)=>[node.id,node]));
  const huang=byId.get('huang');
  const yan=byId.get('yan');
  const zhao=byId.get('zhao');

  assert.equal(huang.y,zhao.y);
  assert.equal(zhao.x-(huang.x+218),130);
  assert.ok(yan.y<huang.y);
  assert.equal(yan.x,huang.x);
});
