import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Typography } from 'antd';
import { ReloadOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { getFamilyGraphColumns, getFamilyGraphLayoutRows, positionFamilyGraphData, getFamilyGraphConnection, getFamilyGraphRelationLabel } from './family-graph-layout.js';

const {Text} = Typography;
const NODE_WIDTH = 218;
const NODE_HEIGHT = 88;
const CANVAS_MIN_HEIGHT = 430;
const GRAPH_GAP_X = 130;
const GRAPH_GAP_Y = 72;
const STRAIGHT_CONNECTION_NODE_LIMIT = 6;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

function clampZoom(value) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 100) / 100));
}

function getZoomOffset(size, zoom) {
  return zoom < 1 ? (size - size * zoom) / 2 : 0;
}

function getMemberSubtitle(member) {
  const role = member.isPrimary ? '主要服务联系人' : member.isGuest ? '简要成员' : '家庭客户';
  return [role, !member.isGuest && member.stage].filter(Boolean).join(' · ');
}

function getGraphCanvasHeight(width, graphData) {
  const columns = getFamilyGraphColumns(width,{nodeWidth:NODE_WIDTH,gapX:GRAPH_GAP_X});
  const rows = getFamilyGraphLayoutRows(graphData,columns).length;
  return Math.max(CANVAS_MIN_HEIGHT, rows * NODE_HEIGHT + Math.max(0, rows - 1) * GRAPH_GAP_Y + 48);
}

function clampNodePosition(position, canvasSize) {
  return {
    x: Math.max(12, Math.min(position.x, Math.max(12, canvasSize.width - NODE_WIDTH - 12))),
    y: Math.max(12, Math.min(position.y, Math.max(12, canvasSize.height - NODE_HEIGHT - 12))),
  };
}

export default function FamilyRelationshipGraph({family,selectedMemberId,onSelect,onRelationSelect,darkTheme}) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const zoomRef = useRef(1);
  const pendingZoomAnchorRef = useRef(null);
  const zoomActionRef = useRef(null);
  const [canvasWidth,setCanvasWidth] = useState(0);
  const [zoom,setZoom] = useState(1);
  const [manualLayout,setManualLayout] = useState({key:'',positions:{}});
  const members = Array.isArray(family.members) ? family.members : [];
  const relationships = Array.isArray(family.relationships) ? family.relationships : [];
  const layoutKey = `${family.id}:${members.map((member)=>member.id).join(',')}`;

  useLayoutEffect(()=>{
    const canvas=canvasRef.current;
    if (!canvas) return undefined;
    const updateSize=()=>setCanvasWidth(canvas.offsetWidth-canvas.clientLeft*2);
    updateSize();
    const observer=new ResizeObserver(updateSize);
    observer.observe(canvas);
    return ()=>observer.disconnect();
  },[]);

  useLayoutEffect(()=>{
    const canvas=canvasRef.current;
    const anchor=pendingZoomAnchorRef.current;
    if (!canvas || !anchor || anchor.zoom!==zoom) return;
    const offsetX=getZoomOffset(graphWidth,zoom);
    const offsetY=getZoomOffset(canvasHeight,zoom);
    canvas.scrollLeft=Math.max(0,offsetX+anchor.graphX*zoom-anchor.localX);
    canvas.scrollTop=Math.max(0,offsetY+anchor.graphY*zoom-anchor.localY);
    pendingZoomAnchorRef.current=null;
  },[zoom]);

  useLayoutEffect(()=>{
    const canvas=canvasRef.current;
    if (!canvas) return undefined;
    const handleWheel=(event)=>{
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect=canvas.getBoundingClientRect();
      zoomActionRef.current?.(
        zoomRef.current+(event.deltaY<0?ZOOM_STEP:-ZOOM_STEP),
        event.clientX-rect.left-canvas.clientLeft,
        event.clientY-rect.top-canvas.clientTop,
      );
    };
    canvas.addEventListener('wheel',handleWheel,{passive:false});
    return ()=>canvas.removeEventListener('wheel',handleWheel);
  },[]);

  const graphData = useMemo(()=>({
    nodes:members.map((member)=>({id:String(member.id)})),
    lines:relationships,
  }),[members,relationships]);
  const canvasHeight = getGraphCanvasHeight(canvasWidth || 700,graphData);
  const graphWidth=canvasWidth || 700;
  const zoomSpaceWidth=Math.max(graphWidth,graphWidth*zoom);
  const zoomSpaceHeight=Math.max(canvasHeight,canvasHeight*zoom);
  const zoomOffsetX=getZoomOffset(graphWidth,zoom);
  const zoomOffsetY=getZoomOffset(canvasHeight,zoom);
  const initialNodes = useMemo(()=>positionFamilyGraphData(graphData,{width:canvasWidth,height:canvasHeight},{nodeWidth:NODE_WIDTH,nodeHeight:NODE_HEIGHT,gapX:GRAPH_GAP_X,gapY:GRAPH_GAP_Y}).nodes,[graphData,canvasWidth,canvasHeight]);
  const basePositions = useMemo(()=>Object.fromEntries(initialNodes.map((node)=>[String(node.id),{x:node.x,y:node.y}])),[initialNodes]);
  const positions = useMemo(()=>{
    const saved=manualLayout.key===layoutKey ? manualLayout.positions : {};
    return Object.fromEntries(Object.entries(basePositions).map(([id,position])=>[id,clampNodePosition(saved[id] || position,{width:canvasWidth || 700,height:canvasHeight})]));
  },[basePositions,manualLayout,layoutKey,canvasWidth,canvasHeight]);
  const memberById = useMemo(()=>new Map(members.map((member)=>[String(member.id),member])),[members]);
  const lines = useMemo(()=>relationships.flatMap((relation)=>{
    const from=positions[String(relation.memberAId)];
    const to=positions[String(relation.memberBId)];
    if (!from || !to) return [];
    const connection=getFamilyGraphConnection(from,to,{nodeWidth:NODE_WIDTH,nodeHeight:NODE_HEIGHT,straight:members.length<=STRAIGHT_CONNECTION_NODE_LIMIT});
    const label=getFamilyGraphRelationLabel(relation,connection);
    return [{relation,label,labelWidth:Math.min(180,Math.max(84,label.length*7+20)),...connection}];
  }),[relationships,positions]);

  const changeZoom=(requestedZoom,localX,localY)=>{
    const canvas=canvasRef.current;
    if (!canvas) return;
    const currentZoom=zoomRef.current;
    const nextZoom=clampZoom(requestedZoom);
    if (nextZoom===currentZoom) return;
    const pointX=localX ?? canvas.clientWidth/2;
    const pointY=localY ?? canvas.clientHeight/2;
    pendingZoomAnchorRef.current={
      zoom:nextZoom,
      graphX:(canvas.scrollLeft+pointX-getZoomOffset(graphWidth,currentZoom))/currentZoom,
      graphY:(canvas.scrollTop+pointY-getZoomOffset(canvasHeight,currentZoom))/currentZoom,
      localX:pointX,
      localY:pointY,
    };
    zoomRef.current=nextZoom;
    setZoom(nextZoom);
  };
  zoomActionRef.current=changeZoom;

  const moveNode = (event) => {
    const drag=dragRef.current;
    if (!drag || drag.pointerId!==event.pointerId) return;
    const dx=event.clientX-drag.startX;
    const dy=event.clientY-drag.startY;
    if (!drag.moved && Math.hypot(dx,dy)<3) return;
    drag.moved=true;
    const currentZoom=zoomRef.current;
    const next=clampNodePosition({x:drag.startPosition.x+dx/currentZoom,y:drag.startPosition.y+dy/currentZoom},{width:canvasWidth,height:canvasHeight});
    setManualLayout((previous)=>({
      key:layoutKey,
      positions:{...(previous.key===layoutKey ? previous.positions : {}),[drag.nodeId]:next},
    }));
  };

  const finishDrag = (event) => {
    const drag=dragRef.current;
    if (!drag || drag.pointerId!==event.pointerId) return;
    if (drag.moved) {
      suppressClickRef.current=true;
      window.setTimeout(()=>{suppressClickRef.current=false;},100);
    }
    dragRef.current=null;
  };

  const resetLayout = () => {
    dragRef.current=null;
    pendingZoomAnchorRef.current=null;
    zoomRef.current=1;
    setZoom(1);
    if (canvasRef.current) {
      canvasRef.current.scrollLeft=0;
      canvasRef.current.scrollTop=0;
    }
    setManualLayout({key:layoutKey,positions:{}});
  };

  return <div className="family-graph-wrap">
    <div className="family-graph-toolbar">
      <Text className="muted">成员卡片展示身份信息，连线标注已确认的家庭关系。</Text>
      <div className="family-graph-zoom-controls" aria-label="画布缩放">
        <Button size="small" type="text" icon={<ZoomOutOutlined />} aria-label="缩小画布" title="缩小画布" disabled={zoom<=MIN_ZOOM} onClick={()=>changeZoom(zoom-ZOOM_STEP)} />
        <Text className="family-graph-zoom-value" aria-live="polite">{Math.round(zoom*100)}%</Text>
        <Button size="small" type="text" icon={<ZoomInOutlined />} aria-label="放大画布" title="放大画布" disabled={zoom>=MAX_ZOOM} onClick={()=>changeZoom(zoom+ZOOM_STEP)} />
        <Button size="small" icon={<ReloadOutlined />} onClick={resetLayout}>适应画布</Button>
      </div>
    </div>
    <div
      ref={canvasRef}
      className={`family-graph-canvas${darkTheme?' is-dark':''}`}
      style={{height:canvasHeight+2}}
      onPointerMove={moveNode}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      aria-label="家庭关系图谱"
    >
      <div className="family-graph-zoom-space" style={{width:zoomSpaceWidth,height:zoomSpaceHeight}}>
        <div
          className="family-graph-zoom-content"
          style={{left:zoomOffsetX,top:zoomOffsetY,width:graphWidth,height:canvasHeight,transform:`scale(${zoom})`}}
        >
          <svg className="family-graph-links" width="100%" height="100%" aria-hidden="true">
            <defs>
              <marker id="family-graph-arrow" className="family-graph-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {lines.map(({relation,path})=><path
              key={relation.id}
              className="family-graph-link"
              d={path}
              markerEnd={relation.kind==='parent_child' ? 'url(#family-graph-arrow)' : undefined}
            />)}
          </svg>
          {lines.map(({relation,label,labelX,labelY,labelWidth})=><button
            key={`label-${relation.id}`}
            type="button"
            className="family-graph-relation-label"
            style={{left:labelX,top:labelY,width:labelWidth}}
            onClick={()=>onRelationSelect(relation.id)}
            aria-label={`编辑关系：${label}`}
          >{label}</button>)}
          {members.map((member)=>{
            const id=String(member.id);
            const position=positions[id];
            const initial=Array.from(String(member.name || '').trim())[0] || '客';
            const selected=id===String(selectedMemberId);
            const dragging=dragRef.current?.nodeId===id;
            return <button
              key={id}
              type="button"
              className={`family-graph-person ${member.isPrimary?'is-primary':''} ${member.isGuest?'is-guest':''} ${selected?'is-selected':''} ${dragging?'is-dragging':''}`}
              style={{left:position.x,top:position.y,width:NODE_WIDTH,height:NODE_HEIGHT}}
              aria-label={`${member.name}，${getMemberSubtitle(member)}`}
              onPointerDown={(event)=>{
                if (event.button!==0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current={nodeId:id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startPosition:position,moved:false};
              }}
              onPointerMove={moveNode}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onClick={()=>{
                if (suppressClickRef.current) return;
                onSelect(member.id);
              }}
            >
              <span className="family-graph-person-avatar" aria-hidden="true">{initial}</span>
              <span className="family-graph-person-info">
                <strong className="family-graph-person-name">{member.name || '未命名成员'}</strong>
                <span className="family-graph-person-meta">{getMemberSubtitle(member)}</span>
              </span>
            </button>;
          })}
        </div>
      </div>
    </div>
    {selectedMemberId ? <Text className="family-graph-selected">当前成员：{memberById.get(String(selectedMemberId))?.name || ''}</Text> : null}
  </div>;
}
