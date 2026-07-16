import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * CausticsCanvas — the light at the bottom of the pool.
 *
 * A WebGL fragment shader rendering voronoi water caustics in brand cyan.
 * This is the app's single signature moment: it appears behind the
 * route-complete celebration and nowhere else.
 *
 * Degradation ladder:
 *   WebGL available + motion allowed  -> live shader
 *   no WebGL                          -> CSS conic-gradient shimmer (.caustics-fallback)
 *   prefers-reduced-motion            -> one static frame (shader, time frozen)
 */

const VERTEX_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;

uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_tint;

/* voronoi F2-F1 — the difference field is what reads as light webs */
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

void causticLayer(vec2 uv, float t, out float f1, out float f2) {
  vec2 g = floor(uv);
  vec2 f = fract(uv);
  f1 = 8.0;
  f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 lattice = vec2(float(x), float(y));
      vec2 offset = hash22(g + lattice);
      offset = 0.5 + 0.5 * sin(t + 6.2831 * offset);
      vec2 r = lattice + offset - f;
      float d = dot(r, r);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res.y;
  float t = u_time * 0.55;

  float f1a, f2a, f1b, f2b;
  causticLayer(uv * 3.0, t, f1a, f2a);
  causticLayer(uv * 5.5 + 17.0, -t * 0.8, f1b, f2b);

  float webA = 1.0 - smoothstep(0.0, 0.09, f2a - f1a);
  float webB = 1.0 - smoothstep(0.0, 0.12, f2b - f1b);

  float light = webA * 0.75 + webB * 0.45;
  light = pow(light, 1.6);

  /* gentle vertical falloff so text stays readable above */
  float fade = 1.0 - smoothstep(0.15, 1.0, gl_FragCoord.y / u_res.y) * 0.45;

  float alpha = clamp(light * fade, 0.0, 1.0) * 0.55;
  gl_FragColor = vec4(u_tint, alpha);
}
`;

function readBrandTint() {
  // Pull the live brand color so theme changes propagate to the shader.
  try {
    const probe = document.createElement('span');
    probe.style.color = 'var(--brand)';
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    const match = computed.match(/[\d.]+/g);
    if (match && match.length >= 3) {
      return [match[0] / 255, match[1] / 255, match[2] / 255];
    }
  } catch {
    /* fall through to default */
  }
  return [0.024, 0.62, 0.78]; // cyan-600-ish
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export function CausticsCanvas({ className }) {
  const canvasRef = useRef(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });

    if (!gl) {
      setWebglFailed(true);
      return;
    }

    const compile = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
      }
      return shader;
    };

    let program;
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SRC));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('program link failed');
      }
    } catch {
      setWebglFailed(true);
      return;
    }

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const posLoc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const resLoc = gl.getUniformLocation(program, 'u_res');
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const tintLoc = gl.getUniformLocation(program, 'u_tint');

    const tint = readBrandTint();
    gl.uniform3f(tintLoc, tint[0], tint[1], tint[2]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      const w = Math.max(1, Math.round(clientWidth * dpr));
      const h = Math.max(1, Math.round(clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(resLoc, canvas.width, canvas.height);
    };

    let rafId = null;
    const start = performance.now();

    const drawFrame = (now) => {
      resize();
      gl.uniform1f(timeLoc, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    if (reducedMotion) {
      // One static frame: the light, frozen.
      const drawStatic = () => drawFrame(start + 4200);
      drawStatic();
      window.addEventListener('resize', drawStatic);
      return () => window.removeEventListener('resize', drawStatic);
    }

    const loop = (now) => {
      drawFrame(now);
      rafId = requestAnimationFrame(loop);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
      } else if (rafId === null) {
        rafId = requestAnimationFrame(loop);
      }
    };

    rafId = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', handleVisibility);
      const loseContext = gl.getExtension('WEBGL_lose_context');
      loseContext?.loseContext();
    };
  }, [reducedMotion]);

  if (webglFailed) {
    return (
      <div
        aria-hidden="true"
        className={cn('caustics-fallback', className)}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('h-full w-full', className)}
    />
  );
}

export default CausticsCanvas;
