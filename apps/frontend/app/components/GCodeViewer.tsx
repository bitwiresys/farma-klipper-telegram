'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type GCodeViewerProps = {
  printerId: string;
  filename: string;
  toolheadPosition?: { x: number; y: number; z: number };
  showNozzle?: boolean;
  showProgress?: boolean;
  progress?: number; // 0-100
  className?: string;
  lowPoly?: boolean; // For mobile optimization
};

// Simple G-code parser for basic visualization
function parseGCode(gcode: string, lowPoly: boolean): { positions: Float32Array; colors: Float32Array; layerZ: number[] } {
  const positions: number[] = [];
  const colors: number[] = [];
  const layerZ: number[] = [];

  let x = 0, y = 0, z = 0;
  let prevZ = 0;
  let isExtruding = false;
  let currentLayer = 0;

  const lines = gcode.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(';')) continue;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]?.toUpperCase();

    if (cmd === 'G0' || cmd === 'G1') {
      let newX = x, newY = y, newZ = z;
      let eVal = 0;
      let isMove = false;

      for (const part of parts.slice(1)) {
        const axis = part[0]?.toUpperCase();
        const val = parseFloat(part.slice(1));
        if (isNaN(val)) continue;

        if (axis === 'X') { newX = val; isMove = true; }
        else if (axis === 'Y') { newY = val; isMove = true; }
        else if (axis === 'Z') { newZ = val; isMove = true; }
        else if (axis === 'E') { eVal = val; }
      }

      // Detect layer change
      if (newZ !== prevZ && newZ > prevZ) {
        layerZ.push(newZ);
        prevZ = newZ;
        currentLayer++;
      }

      // Draw line if extruding (E increased)
      const extruding = eVal > 0;

      if (extruding && isMove) {
        // Add line vertices
        positions.push(x, y, z, newX, newY, newZ);

        // Color based on Z (gradient from bottom to top)
        const t = currentLayer / Math.max(currentLayer + 1, 10);
        const r = 0.2 + t * 0.3;
        const g = 0.6 + t * 0.2;
        const b = 0.8 - t * 0.3;

        colors.push(r, g, b, r, g, b);
      }

      x = newX;
      y = newY;
      z = newZ;
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    layerZ,
  };
}

export function GCodeViewer({
  printerId,
  filename,
  toolheadPosition,
  showNozzle = true,
  showProgress = true,
  progress = 0,
  className = '',
  lowPoly = false,
}: GCodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const nozzleRef = useRef<THREE.Mesh | null>(null);
  const animationRef = useRef<number>(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    // Build plate border
    const plateGeometry = new THREE.BoxGeometry(250, 1, 250);
    const plateMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a1a2e,
      transparent: true,
      opacity: 0.3,
    });
    const plate = new THREE.Mesh(plateGeometry, plateMaterial);
    plate.position.set(0, -0.5, 0);
    scene.add(plate);

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
    if (!sceneRef.current) return;

    const loadGCode = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/gcode/${printerId}?filename=${encodeURIComponent(filename)}`);
        if (!res.ok) {
          throw new Error(`Failed to load G-code: ${res.status}`);
        }

        const gcode = await res.text();
        const { positions, colors, layerZ } = parseGCode(gcode, lowPoly);

        if (positions.length === 0) {
          throw new Error('No valid G-code data found');
        }

        // Create geometry for G-code paths
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.LineBasicMaterial({
          vertexColors: true,
          linewidth: 1,
        });

        const lines = new THREE.LineSegments(geometry, material);
        sceneRef.current?.add(lines);

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
  }, [printerId, filename, lowPoly]);

  // Update nozzle position from toolhead
  useEffect(() => {
    if (!nozzleRef.current || !toolheadPosition) return;

    const { x, y, z } = toolheadPosition;
    nozzleRef.current.position.set(x, z + 5, y); // Swap Y/Z for Three.js coords
  }, [toolheadPosition]);

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="h-full w-full" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/80">
          <div className="text-textPrimary">Loading G-code...</div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/80">
          <div className="text-red-400">{error}</div>
        </div>
      )}

      {showProgress && progress > 0 && (
        <div className="absolute bottom-2 left-2 right-2">
          <div className="h-1 rounded-full bg-surface2">
            <div
              className="h-full rounded-full bg-accentCyan"
              style={{ width: `${progress}%` }}
            />
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
  className = '',
}: {
  printerId: string;
  filename: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw placeholder
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load and render simplified G-code
    const render = async () => {
      try {
        const res = await fetch(`/api/gcode/${printerId}?filename=${encodeURIComponent(filename)}`);
        if (!res.ok) return;

        const gcode = await res.text();
        const { positions } = parseGCode(gcode, true);

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
  }, [printerId, filename]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={120}
      className={`rounded ${loaded ? 'opacity-100' : 'opacity-50'} ${className}`}
    />
  );
}
