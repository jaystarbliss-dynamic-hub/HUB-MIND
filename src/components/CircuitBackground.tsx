import React, { useEffect, useRef } from 'react';

export const CircuitBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Horizon apex point
    const getVP = () => ({
      x: width / 2,
      y: height * 0.44
    });

    // Define symmetrical circuit trace paths (left & right sides)
    interface Point { x: number; y: number }
    interface Path {
      points: Point[];
      totalLen: number;
      segLengths: number[];
    }

    const createPaths = (): Path[] => {
      const paths: Path[] = [];
      const count = 7; // per side
      const vp = getVP();

      for (let side = -1; side <= 1; side += 2) {
        if (side === 0) continue;
        for (let i = 0; i < count; i++) {
          const norm = (i + 1) / count;
          const startX = vp.x + side * (width * 0.08 + norm * width * 0.45);
          const startY = height + 40;

          const step1Y = height * (0.82 - i * 0.025);
          const step1X = startX;

          const step2X = vp.x + side * (width * 0.04 + norm * width * 0.28);
          const step2Y = step1Y;

          const step3Y = height * (0.64 - i * 0.02);
          const step3X = step2X;

          const step4X = vp.x + side * (width * 0.015 + norm * width * 0.12);
          const step4Y = step3Y;

          const apexX = vp.x + side * (norm * 2);
          const apexY = vp.y;

          const rawPoints: Point[] = [
            { x: startX, y: startY },
            { x: step1X, y: step1Y },
            { x: step2X, y: step2Y },
            { x: step3X, y: step3Y },
            { x: step4X, y: step4Y },
            { x: apexX, y: apexY }
          ];

          let totalLen = 0;
          const segLengths: number[] = [];
          for (let p = 0; p < rawPoints.length - 1; p++) {
            const dx = rawPoints[p + 1].x - rawPoints[p].x;
            const dy = rawPoints[p + 1].y - rawPoints[p].y;
            const len = Math.hypot(dx, dy);
            segLengths.push(len);
            totalLen += len;
          }

          paths.push({ points: rawPoints, totalLen, segLengths });
        }
      }
      return paths;
    };

    let paths = createPaths();

    // Energy Node Particles - Reduced count and unified workspace green palette
    interface Particle {
      pathIndex: number;
      progress: number; // 0 to 1
      speed: number;
      size: number;
      color: string;
      trail: { x: number; y: number }[];
    }

    const particles: Particle[] = [];
    const numParticles = 10; // Reduced for subtle elegance
    // Exact signature Hub-Mind workspace green palette
    const workspaceTealGreens = ['#75e4d2', '#5eead4', '#6de0c9', '#10b981', '#34d399'];

    for (let i = 0; i < numParticles; i++) {
      particles.push({
        pathIndex: Math.floor(Math.random() * paths.length),
        progress: Math.random(),
        speed: 0.0014 + Math.random() * 0.002,
        size: 2.2 + Math.random() * 1.6,
        color: workspaceTealGreens[i % workspaceTealGreens.length],
        trail: []
      });
    }

    const getPointAtProgress = (path: Path, prog: number): Point => {
      const targetDist = prog * path.totalLen;
      let accumulated = 0;

      for (let i = 0; i < path.segLengths.length; i++) {
        const segLen = path.segLengths[i];
        if (accumulated + segLen >= targetDist || i === path.segLengths.length - 1) {
          const segProg = segLen > 0 ? (targetDist - accumulated) / segLen : 0;
          const p1 = path.points[i];
          const p2 = path.points[i + 1];
          return {
            x: p1.x + (p2.x - p1.x) * segProg,
            y: p1.y + (p2.y - p1.y) * segProg
          };
        }
        accumulated += segLen;
      }
      return path.points[path.points.length - 1];
    };

    let pulseTime = 0;

    const render = () => {
      pulseTime += 0.025;
      ctx.clearRect(0, 0, width, height);

      // Deep dark background gradient matching workspace theme
      const bgGrad = ctx.createRadialGradient(
        width / 2, height * 0.44, 10,
        width / 2, height / 2, Math.max(width, height) * 0.85
      );
      bgGrad.addColorStop(0, '#0a131c');
      bgGrad.addColorStop(0.5, '#070b12');
      bgGrad.addColorStop(1, '#04060a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      const vp = getVP();
      paths = createPaths();

      // 1. Draw circuit trace lines in workspace green gradient
      ctx.lineWidth = 1.2;
      paths.forEach((path) => {
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y);
        }

        const grad = ctx.createLinearGradient(path.points[0].x, path.points[0].y, vp.x, vp.y);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
        grad.addColorStop(0.5, 'rgba(94, 215, 193, 0.25)');
        grad.addColorStop(1, 'rgba(117, 228, 210, 0.65)');
        ctx.strokeStyle = grad;
        ctx.stroke();

        // Corner joint dots in workspace teal
        path.points.forEach((pt, idx) => {
          if (idx > 0 && idx < path.points.length - 1) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(117, 228, 210, 0.5)';
            ctx.fill();
          }
        });
      });

      // 2. Draw moving energy node particles
      particles.forEach((p) => {
        p.progress += p.speed;
        if (p.progress >= 1) {
          p.progress = 0;
          p.pathIndex = Math.floor(Math.random() * paths.length);
          p.trail = [];
        }

        const currentPath = paths[p.pathIndex % paths.length];
        const pos = getPointAtProgress(currentPath, p.progress);

        p.trail.unshift({ x: pos.x, y: pos.y });
        if (p.trail.length > 7) p.trail.pop();

        // Motion trail
        for (let t = p.trail.length - 1; t >= 0; t--) {
          const pt = p.trail[t];
          const fade = (1 - t / p.trail.length) * 0.5;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, p.size * (1 - (t / p.trail.length) * 0.35), 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = fade;
          ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        // Outer radial glow halo
        const outerGlow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, p.size * 4.5);
        outerGlow.addColorStop(0, p.color);
        outerGlow.addColorStop(0.4, p.color);
        outerGlow.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, p.size * 4.5, 0, Math.PI * 2);
        ctx.fillStyle = outerGlow;
        ctx.fill();

        // Bright white-green core
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, p.size * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = '#f0fdfa';
        ctx.fill();
      });

      // 3. Vanishing Point Horizon Flare
      const flareRadius = 32 + Math.sin(pulseTime) * 6;
      const flare = ctx.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, flareRadius * 2);
      flare.addColorStop(0, 'rgba(240, 253, 250, 0.95)');
      flare.addColorStop(0.3, 'rgba(117, 228, 210, 0.8)');
      flare.addColorStop(0.7, 'rgba(16, 185, 129, 0.35)');
      flare.addColorStop(1, 'transparent');

      ctx.beginPath();
      ctx.arc(vp.x, vp.y, flareRadius * 2, 0, Math.PI * 2);
      ctx.fillStyle = flare;
      ctx.fill();

      // Core star point
      ctx.beginPath();
      ctx.arc(vp.x, vp.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#75e4d2';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
};
