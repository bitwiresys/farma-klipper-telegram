'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type GCodeViewerProps = {
  printerId: string;
  filename: string;
  token: string;
  toolheadPosition?: { x: number; y: number; z: number };
  showNozzle?: boolean;
  showProgress?: boolean;
  progress?: number; // 0-100
  currentLayer?: number | null;
  totalLayers?: number | null;
  className?: string;
  lowPoly?: boolean;
  simulationMode?: boolean; // Enable interactive sliders
};

// G-code parser with proper extrusion detection
function parseGCode(gcode: string): {
  positions: Float32Array;
  colors: Float32Array;
  layerData: { z: number; startVertex: number; endVertex: number }[];
} {
  const positions: number[] = [];
  const colors: number[] = [];
  const layerData: { z: number; startVertex: number; endVertex: number }[] = [];

  let x = 0, y = 0, z = 0;
  let lastZ = -Infinity;
  let lastE = 0;
  let absoluteE = true; // M82 default
  let currentLayerIdx = -1;
  let vertexCount = 0;

  const lines = gcode.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    const parts = line.split(/\s+/);
    const cmd = parts[0]?.toUpperCase();

    // Handle extruder mode
    if (cmd === 'M82') { absoluteE = true; continue; }
    if (cmd === 'M83') { absoluteE = false; continue; }
    if (cmd === 'G92') {
      // Set position - handle E reset
      for (const part of parts.slice(1)) {
        if (part.startsWith('E')) {
          lastE = parseFloat(part.slice(1)) || 0;
        }
      }
      continue;
    }

    if (cmd !== 'G0' && cmd !== 'G1') continue;

    let newX = x, newY = y, newZ = z;
    let eVal: number | null = null;

    for (const part of parts.slice(1)) {
      const axis = part[0]?.toUpperCase();
      const val = parseFloat(part.slice(1));
      if (isNaN(val)) continue;

      if (axis === 'X') newX = val;
      else if (axis === 'Y') newY = val;
      else if (axis === 'Z') newZ = val;
      else if (axis === 'E') eVal = val;
    }

    // Detect layer change by Z increase
    if (newZ > lastZ + 0.0001) {
      // Close previous layer
      if (currentLayerIdx >= 0 && layerData[currentLayerIdx]) {
        layerData[currentLayerIdx].endVertex = vertexCount;
      }
      
      currentLayerIdx++;
      lastZ = newZ;
      layerData.push({ z: newZ, startVertex: vertexCount, endVertex: vertexCount });
    }

    // Check extrusion
    let isExtruding = false;
    if (eVal !== null) {
      const deltaE = absoluteE ? (eVal - lastE) : eVal;
      isExtruding = deltaE > 0.0001;
      lastE = absoluteE ? eVal : lastE + eVal;
    }

    // Only draw if extruding AND moving
    if (isExtruding && (newX !== x || newY !== y || newZ !== z)) {
      positions.push(x, y, z, newX, newY, newZ);
      vertexCount += 2;

      // Color: cyan gradient based on layer
      const t = Math.min(currentLayerIdx / Math.max(layerData.length, 1), 1);
      const r = 0.1 + t * 0.1;
      const g = 0.7 + t * 0.2;
      const b = 0.8 - t * 0.2;

      colors.push(r, g, b, r, g, b);
    }

    x = newX;
    y = newY;
    z = newZ;
  }

  // Close last layer
  if (currentLayerIdx >= 0 && layerData[currentLayerIdx]) {
    layerData[currentLayerIdx].endVertex = vertexCount;
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    layerData,
  };
}

export function GCodeViewer({
  printerId,
  filename,
  token,
  toolheadPosition,
  showNozzle = true,
  showProgress = true,
  progress = 0,
  currentLayer,
  totalLayers,
  className = '',
  lowPoly = false,
  simulationMode = false,
}: GCodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const nozzleRef = useRef<THREE.Mesh | null>(null);
  const animationRef = useRef<number>(0);
  const linesRef = useRef<THREE.LineSegments | null>(null);
  const originalColorsRef = useRef<Float32Array | null>(null);
  const layerDataRef = useRef<{ z: number; startVertex: number; endVertex: number }[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layerCount, setLayerCount] = useState(0);
  
  // Simulation state
  const [simLayer, setSimLayer] = useState(0);
  const [layerProgress, setLayerProgress] = useState(100);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f14);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
    camera.position.set(150, 150, 150);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: !lowPoly,
      powerPreference: lowPoly ? 'low-power' : 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(lowPoly ? 1 : Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.enablePan = true;
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 200, 100);
    scene.add(directionalLight);

    // Build plate (grid)
    const gridHelper = new THREE.GridHelper(250, 25, 0x20d3c2, 0x1a1a2e);
    scene.add(gridHelper);

    // Nozzle indicator
    if (showNozzle) {
      const nozzleGeometry = new THREE.ConeGeometry(2, 8, lowPoly ? 4 : 8);
      const nozzleMaterial = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
      const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
      nozzle.rotation.x = Math.PI;
      nozzle.position.set(0, 5, 0);
      scene.add(nozzle);
      nozzleRef.current = nozzle;
    }

    // Animation loop
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationRef.current);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [lowPoly, showNozzle]);

  // Load G-code file
  useEffect(() => {
    if (!sceneRef.current || !token) return;

    const loadGCode = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/gcode/${printerId}?filename=${encodeURIComponent(filename)}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Failed to load G-code: ${res.status} ${errText.slice(0, 100)}`);
        }

        const gcode = await res.text();
        
        if (!gcode || gcode.length < 10) {
          throw new Error('Empty or invalid G-code file');
        }

        const { positions, colors, layerData } = parseGCode(gcode);

        if (positions.length === 0) {
          throw new Error('No extrusion moves found in G-code');
        }

        // Remove old lines if any
        if (linesRef.current) {
          sceneRef.current?.remove(linesRef.current);
          linesRef.current.geometry.dispose();
        }

        // Create geometry for G-code paths
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.LineBasicMaterial({
          vertexColors: true,
          linewidth: 1,
          transparent: true,
          opacity: 1,
        });

        const lines = new THREE.LineSegments(geometry, material);
        sceneRef.current?.add(lines);
        linesRef.current = lines;
        
        // Store original colors for later manipulation
        originalColorsRef.current = new Float32Array(colors);
        layerDataRef.current = layerData;
        setLayerCount(layerData.length);

        // Center camera on model
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        if (bbox) {
          const center = new THREE.Vector3();
          bbox.getCenter(center);
          controlsRef.current?.target.copy(center);
          cameraRef.current?.lookAt(center);
        }

        setLoading(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        setError(msg);
        setLoading(false);
      }
    };

    loadGCode();
  }, [printerId, filename, token]);

  // Update layer visibility based on simulation or print progress
  useEffect(() => {
    if (!linesRef.current || !originalColorsRef.current || layerDataRef.current.length === 0) return;

    const geometry = linesRef.current.geometry;
    const colorAttr = geometry.getAttribute('color');
    const positionAttr = geometry.getAttribute('position');
    
    if (!colorAttr || !positionAttr) return;

    const totalLayerCount = totalLayers ?? layerDataRef.current.length;
    
    // In simulation mode use simLayer, otherwise use currentLayer/progress
    const targetLayer = simulationMode 
      ? simLayer 
      : (currentLayer ?? Math.floor((progress / 100) * totalLayerCount));
    
    const layerIdx = Math.min(Math.max(targetLayer, 0), layerDataRef.current.length - 1);
    const currentLayerInfo = layerDataRef.current[layerIdx];
    
    // Get Z threshold for visibility
    const zThreshold = currentLayerInfo?.z ?? Infinity;
    
    const positions = positionAttr.array as Float32Array;
    const colors = colorAttr.array as Float32Array;
    const originalColors = originalColorsRef.current;

    // Reset all colors first
    for (let i = 0; i < colors.length; i++) {
      colors[i] = originalColors[i];
    }

    // Apply dimming to future layers
    for (let i = 0; i < positions.length; i += 6) {
      const z1 = positions[i + 2];
      const z2 = positions[i + 5];
      const avgZ = (z1 + z2) / 2;
      
      const isPrinted = avgZ <= zThreshold + 0.01;
      
      if (!isPrinted) {
        // Dim future layers
        const baseIdx = (i / 3) * 3;
        colors[baseIdx] *= 0.3;
        colors[baseIdx + 1] *= 0.3;
        colors[baseIdx + 2] *= 0.3;
        colors[baseIdx + 3] *= 0.3;
        colors[baseIdx + 4] *= 0.3;
        colors[baseIdx + 5] *= 0.3;
      }
    }

    colorAttr.needsUpdate = true;
  }, [progress, currentLayer, totalLayers, simLayer, simulationMode]);

  // Update nozzle position from toolhead
  useEffect(() => {
    if (!nozzleRef.current || !toolheadPosition) return;

    const { x, y, z } = toolheadPosition;
    nozzleRef.current.position.set(x, z + 5, y); // Swap Y/Z for Three.js coords
  }, [toolheadPosition]);

  const totalLayerCount = totalLayers ?? layerCount;
  const displayLayer = simulationMode ? simLayer : (currentLayer ?? Math.floor((progress / 100) * totalLayerCount));

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="h-full w-full" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/80">
          <div className="text-textPrimary">Loading G-code...</div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/80 p-4">
          <div className="text-red-400 text-center text-sm">{error}</div>
        </div>
      )}

      {/* Vertical layer slider (simulation) - right side */}
      {showProgress && layerCount > 0 && (
        <div className="absolute right-2 top-2 bottom-12 w-6 flex flex-col items-center">
          <div className="text-[9px] text-textMuted mb-1">Layer</div>
          <div className="flex-1 w-2 rounded-full bg-surface2 relative overflow-hidden">
            <div
              className="absolute bottom-0 left-0 right-0 bg-accentCyan/70 rounded-full transition-all"
              style={{
                height: `${((displayLayer + 1) / totalLayerCount) * 100}%`,
              }}
            />
          </div>
          {simulationMode && (
            <input
              type="range"
              min={0}
              max={layerCount - 1}
              value={simLayer}
              onChange={(e) => setSimLayer(parseInt(e.target.value))}
              className="absolute inset-0 opacity-0 cursor-pointer"
              style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
            />
          )}
          <div className="text-[9px] text-textMuted mt-1">
            {displayLayer + 1}/{totalLayerCount}
          </div>
        </div>
      )}

      {/* Horizontal layer progress slider - bottom */}
      {showProgress && (
        <div className="absolute bottom-2 left-2 right-10">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-textMuted w-12">Layer</span>
            <div className="flex-1 h-1.5 rounded-full bg-surface2 relative">
              <div
                className="absolute left-0 top-0 bottom-0 rounded-full bg-accentCyan transition-all"
                style={{ width: `${((displayLayer + 1) / totalLayerCount) * 100}%` }}
              />
              {simulationMode && (
                <input
                  type="range"
                  min={0}
                  max={layerCount - 1}
                  value={simLayer}
                  onChange={(e) => setSimLayer(parseInt(e.target.value))}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                />
              )}
            </div>
            <span className="text-[10px] text-textMuted w-12 text-right">{progress.toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Miniature viewer for dashboard (non-interactive thumbnail)
export function GCodeThumbnail({
  printerId,
  filename,
  token,
  className = '',
}: {
  printerId: string;
  filename: string;
  token: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !token) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw placeholder
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load and render simplified G-code
    const render = async () => {
      try {
        const res = await fetch(`/api/gcode/${printerId}?filename=${encodeURIComponent(filename)}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        if (!res.ok) return;

        const gcode = await res.text();
        const { positions } = parseGCode(gcode);

        if (positions.length === 0) return;

        // Find bounds
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (let i = 0; i < positions.length; i += 3) {
          const x = positions[i];
          const y = positions[i + 1];
          const z = positions[i + 2];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }

        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const scale = Math.min(canvas.width / rangeX, canvas.height / rangeY) * 0.8;

        // Clear and draw
        ctx.fillStyle = '#0b0f14';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = '#20d3c2';
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        for (let i = 0; i < positions.length; i += 6) {
          const x1 = (positions[i] - minX) * scale + (canvas.width - rangeX * scale) / 2;
          const y1 = canvas.height - ((positions[i + 2] - minZ) * scale + (canvas.height - rangeY * scale) / 2);
          const x2 = (positions[i + 3] - minX) * scale + (canvas.width - rangeX * scale) / 2;
          const y2 = canvas.height - ((positions[i + 5] - minZ) * scale + (canvas.height - rangeY * scale) / 2);

          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }

        ctx.stroke();
        setLoaded(true);
      } catch {
        // Silently fail for thumbnail
      }
    };

    render();
  }, [printerId, filename, token]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={120}
      className={`rounded ${loaded ? 'opacity-100' : 'opacity-50'} ${className}`}
    />
  );
}
