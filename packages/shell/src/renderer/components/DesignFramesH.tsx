import { useRef, useEffect, useCallback } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "motion/react";

const col = {
  bg: "#262626",
  frame: "#303030",
  frameBorder: "rgba(255,255,255,0.08)",
  handle: "rgba(255,255,255,0.16)",
  handleBorder: "rgba(255,255,255,0.1)",
  dimensionText: "rgba(255,255,255,0.14)",
  frameName: "rgba(255,255,255,0.2)",
  ghost: "rgba(255,255,255,0.04)",
  guideLine: "rgba(255,255,255,0.04)",
  label: "rgba(255,255,255,0.22)",
};

type FrameConfig = {
  w: number;
  h: number;
  x: number;
  y: number;
  z: number;
  rz: number;
  speed: number;
  phase: number;
  name: string;
};

const frames: FrameConfig[] = [
  { w: 120, h: 82, x: -68, y: -38, z: 0, rz: -2, speed: 0.5, phase: 0, name: "Hero Section" },
  { w: 75, h: 75, x: 71, y: -30, z: -50, rz: 3, speed: 0.7, phase: 1.5, name: "Icon Grid" },
  { w: 105, h: 68, x: -34, y: 41, z: -100, rz: 1.5, speed: 0.38, phase: 3.1, name: "Card" },
  { w: 60, h: 105, x: 82, y: 22, z: -150, rz: -4, speed: 0.85, phase: 4.3, name: "Mobile" },
];

const HANDLE_SIZE = 5;
const springConfig = { stiffness: 55, damping: 18, mass: 0.8 };

/* ── Corner Handle ─────────────────────────────────────────────── */

const Handle = ({
  top,
  left,
  right,
  bottom,
}: {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
}) => {
  return (
    <div
      style={{
        position: "absolute",
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        borderRadius: 1,
        background: col.handle,
        border: `0.5px solid ${col.handleBorder}`,
        top,
        left,
        right,
        bottom,
        transform: "translate(-50%, -50%)",
      }}
    />
  );
};

/* ── Single Artboard ───────────────────────────────────────────── */

const FloatingArtboard = ({
  config,
  index,
  mouseX,
  mouseY,
  time,
}: {
  config: FrameConfig;
  index: number;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  time: MotionValue<number>;
}) => {
  const depthFactor = 1 - index * 0.14;

  const x = useTransform([time, mouseX], ([t, mx]: number[]) => {
    const drift = Math.sin((t as number) * config.speed + config.phase) * 11;
    const parallax = (mx as number) * 22 * depthFactor;
    return config.x + drift + parallax;
  });

  const y = useTransform([time, mouseY], ([t, my]: number[]) => {
    const drift = Math.cos((t as number) * config.speed * 0.7 + config.phase) * 7;
    const parallax = (my as number) * 16 * depthFactor;
    return config.y + drift + parallax;
  });

  const springX = useSpring(x, springConfig);
  const springY = useSpring(y, springConfig);

  const rz = useTransform(
    time,
    (t) => config.rz + Math.sin(t * config.speed * 0.4 + config.phase) * 1.5,
  );

  const opacity = 0.5 + depthFactor * 0.5;
  const showGhost = index === 0;

  return (
    <motion.div
      style={{
        position: "absolute",
        translateX: springX,
        translateY: springY,
        translateZ: config.z,
        rotateZ: rz,
        opacity,
      }}
    >
      {/* Frame name label (above) */}
      <div
        style={{
          position: "absolute",
          top: -16,
          left: 0,
          fontSize: 8,
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          color: col.frameName,
          whiteSpace: "nowrap",
          letterSpacing: "0.02em",
        }}
      >
        {config.name}
      </div>

      {/* Width dimension (top) */}
      <div
        style={{
          position: "absolute",
          top: -8,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 7,
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          color: col.dimensionText,
        }}
      >
        {config.w}
      </div>

      {/* Height dimension (right) */}
      <div
        style={{
          position: "absolute",
          right: -20,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 7,
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          color: col.dimensionText,
        }}
      >
        {config.h}
      </div>

      {/* The artboard itself */}
      <div
        style={{
          width: config.w,
          height: config.h,
          background: col.frame,
          border: `1px solid ${col.frameBorder}`,
          borderRadius: 2,
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25), 0 0 1px rgba(0,0,0,0.3)",
        }}
      >
        {/* Center crosshair guides */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            height: 0.5,
            background: col.guideLine,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 0.5,
            background: col.guideLine,
          }}
        />

        {/* Ghost layout content (static) */}
        {showGhost && (
          <div
            style={{
              position: "absolute",
              inset: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              opacity: 0.5,
            }}
          >
            <div style={{ height: 6, width: "45%", borderRadius: 2, background: col.ghost }} />
            <div style={{ height: 4, width: "70%", borderRadius: 2, background: col.ghost }} />
            <div style={{ flex: 1, borderRadius: 3, background: col.ghost, marginTop: 4 }} />
          </div>
        )}

        {/* Corner handles */}
        <Handle top={0} left={0} />
        <Handle top={0} right={-HANDLE_SIZE} />
        <Handle bottom={-HANDLE_SIZE} left={0} />
        <Handle bottom={-HANDLE_SIZE} right={-HANDLE_SIZE} />
      </div>
    </motion.div>
  );
};

/* ── Main Component ────────────────────────────────────────────── */

export const DesignFramesH = () => {
  const isHovering = useRef(false);
  const reducedMotion = useReducedMotion();

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const time = useMotionValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    let frame: number;
    const loop = (ts: number) => {
      time.set(ts * 0.001);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [time, reducedMotion]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      isHovering.current = true;
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(((e.clientX - rect.left) / rect.width) * 2 - 1);
      mouseY.set(((e.clientY - rect.top) / rect.height) * 2 - 1);
    },
    [mouseX, mouseY],
  );

  const handleMouseLeave = useCallback(() => {
    isHovering.current = false;
    mouseX.set(0);
    mouseY.set(0);
  }, [mouseX, mouseY]);

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        width: 300,
        height: 210,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "default",
        perspective: 800,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div style={{ transformStyle: "preserve-3d", position: "relative", width: 0, height: 0 }}>
        {frames.map((config, i) => (
          <FloatingArtboard
            key={i}
            config={config}
            index={i}
            mouseX={mouseX}
            mouseY={mouseY}
            time={time}
          />
        ))}
      </div>
    </div>
  );
};
