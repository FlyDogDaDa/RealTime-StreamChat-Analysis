import React, { useEffect, useState, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import * as d3 from 'd3-force';

// 穩定的配色表
const CLUSTER_COLORS = [
  '#880E4F', // 深玫紅
  '#1A237E', // 深靛藍
  '#1B5E20', // 深森林綠
  '#4A148C', // 深紫
  '#004D40', // 深青綠
  '#BF360C', // 深橙紅
  '#01579B', // 深天藍
  '#3E2723', // 深咖啡
  '#006064', // 深石青
  '#263238', // 深藍灰
  '#B71C1C', // 深紅
  '#4527A0', // 深藍紫
  '#004D40', // 深墨綠
  '#AD1457', // 深粉紫
  '#283593'  // 深寶石藍
];
function App() {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [controls, setControls] = useState({ repulsion: -1000, distance: 150 });
  const fgRef = useRef();
  const nodesRef = useRef([]);
  const colorMapRef = useRef({});

  const VIDEO_ID = "[影片ID請填寫我]"; // 修改為你的直播 ID

  // 根據 Cluster ID 分配穩定顏色
  const getUiColor = (clusterId, firstMsgId) => {
    if (clusterId === -1) return 'rgba(65, 65, 65, 0.8)';
    if (!colorMapRef.current[clusterId]) {
      const hash = firstMsgId.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
      const colorIdx = Math.abs(hash) % CLUSTER_COLORS.length;
      colorMapRef.current[clusterId] = CLUSTER_COLORS[colorIdx];
    }
    return colorMapRef.current[clusterId];
  };

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8000/ws/${VIDEO_ID}`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const incomingNodes = data.nodes;

      // 1. 座標持久化 (防止爆炸)
      const updatedNodes = incomingNodes.map(newNode => {
        const oldNode = nodesRef.current.find(n => n.text === newNode.text);
        const nodeWithCoord = oldNode ? { ...newNode, x: oldNode.x, y: oldNode.y, vx: oldNode.vx, vy: oldNode.vy } : newNode;
        
        // 分配穩定顏色
        nodeWithCoord.uiColor = getUiColor(newNode.cluster, newNode.id);
        return nodeWithCoord;
      });

      nodesRef.current = updatedNodes;

      // 2. 建立連線
      const links = [];
      updatedNodes.forEach((nodeA, i) => {
        updatedNodes.slice(i + 1).forEach((nodeB) => {
          if (nodeA.cluster !== -1 && nodeA.cluster === nodeB.cluster) {
            links.push({ source: nodeA.id, target: nodeB.id });
          }
        });
      });

      setGraphData({ nodes: updatedNodes, links });
    };
    return () => ws.close();
  }, [VIDEO_ID]);

  // 更新力場 (排斥力、碰撞力)
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    fg.d3Force('charge').strength(controls.repulsion);
    fg.d3Force('link').distance(controls.distance);
    
    // 防止氣泡重疊的碰撞力
    fg.d3Force('collide', d3.forceCollide(node => {
      const fontSize = 14 + Math.min((node.count || 1) * 1.5, 16);
      return (node.text.length * (fontSize / 3)) + 20; 
    }).iterations(2));

    fg.d3ReheatSimulation();
  }, [controls, graphData.nodes]);

  // 自定義氣泡渲染
  const paintNode = useCallback((node, ctx, globalScale) => {
    const count = node.count || 1;
    const baseFontSize = 14;
    const fontSize = (baseFontSize + Math.min(count * 1.5, 16)) / globalScale;
    
    ctx.font = `${fontSize}px "Microsoft JhengHei", sans-serif`;
    const label = count > 1 ? `${node.text} (x${count})` : node.text;
    const textWidth = ctx.measureText(label).width;
    const padding = 8 / globalScale;
    const bckgW = textWidth + padding * 2;
    const bckgH = fontSize + padding;

    const x = node.x - bckgW / 2;
    const y = node.y - bckgH / 2;
    const r = 6 / globalScale;

    // 氣泡背景
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 4 / globalScale;
    ctx.fillStyle = node.uiColor;
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(x, y, bckgW, bckgH, r);
    } else {
        ctx.rect(x, y, bckgW, bckgH);
    }
    ctx.fill();

    // 氣泡外框 (重複越多越粗)
    ctx.shadowBlur = 0;
    ctx.strokeStyle = node.cluster === -1 ? 'rgba(255,255,255,0.1)' : 'white';
    ctx.lineWidth = (count > 1 ? 3 : 1) / globalScale;
    ctx.stroke();

    // 文字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.fillText(label, node.x, node.y);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#050505' }}>
      {/* UI 面板 */}
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, background: 'rgba(0,0,0,0.8)', padding: 20, borderRadius: 12, color: 'white', width: 220, border: '1px solid #333' }}>
        <div style={{ marginBottom: 15 }}>
          排斥力: {Math.abs(controls.repulsion)}
          <input type="range" min="-3000" max="-200" step="100" value={controls.repulsion} onChange={e => setControls({ ...controls, repulsion: +e.target.value })} style={{ width: '100%' }} />
        </div>
        <div>
          群組距離: {controls.distance}
          <input type="range" min="400" max="3200" step="10" value={controls.distance} onChange={e => setControls({ ...controls, distance: +e.target.value })} style={{ width: '100%' }} />
        </div>
        <div style={{ marginTop: 15, fontSize: 11, color: '#666' }}>相似留言會自動合併並變大</div>
      </div>

      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        nodeCanvasObject={paintNode}
        nodeCanvasObjectMode={() => 'replace'}
        linkColor={link => {
            const s = nodesRef.current.find(n => n.id === (link.source.id || link.source));
            return s ? s.uiColor : 'rgba(255,255,255,0.05)';
        }}
        linkWidth={1.5}
        d3AlphaDecay={0.02}
        velocityDecay={0.4}
      />
    </div>
  );
}

export default App;