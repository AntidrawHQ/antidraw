import { useEffect, useCallback } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "motion/react";

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
}) => (
  <div
    className="absolute w-[5px] h-[5px] rounded-[1px] bg-white/16 border-[0.5px] border-white/10 -translate-x-1/2 -translate-y-1/2"
    style={{ top, left, right, bottom }}
  />
);

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
      className="absolute"
      style={{
        translateX: springX,
        translateY: springY,
        translateZ: config.z,
        rotateZ: rz,
        opacity,
      }}
    >
      <div className="absolute -top-4 left-0 text-[8px] font-mono text-white/20 whitespace-nowrap tracking-[0.02em]">
        {config.name}
      </div>

      <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[7px] font-mono text-white/[0.14]">
        {config.w}
      </div>

      <div className="absolute -right-5 top-1/2 -translate-y-1/2 text-[7px] font-mono text-white/[0.14]">
        {config.h}
      </div>

      <div
        className="relative overflow-hidden rounded-[2px] border border-white/[0.08] bg-[#303030] shadow-[0_2px_8px_rgba(0,0,0,0.25),0_0_1px_rgba(0,0,0,0.3)]"
        style={{ width: config.w, height: config.h }}
      >
        <div className="absolute top-1/2 left-0 right-0 h-[0.5px] bg-white/[0.04]" />
        <div className="absolute left-1/2 top-0 bottom-0 w-[0.5px] bg-white/[0.04]" />

        {showGhost && (
          <div className="absolute inset-3 flex flex-col gap-1.5 opacity-50">
            <div className="h-1.5 w-[45%] rounded-[2px] bg-white/[0.04]" />
            <div className="h-1 w-[70%] rounded-[2px] bg-white/[0.04]" />
            <div className="flex-1 rounded-[3px] bg-white/[0.04] mt-1" />
          </div>
        )}

        <Handle top={0} left={0} />
        <Handle top={0} right={-HANDLE_SIZE} />
        <Handle bottom={-HANDLE_SIZE} left={0} />
        <Handle bottom={-HANDLE_SIZE} right={-HANDLE_SIZE} />
      </div>
    </motion.div>
  );
};

export const DesignFramesH = () => {
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
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(((e.clientX - rect.left) / rect.width) * 2 - 1);
      mouseY.set(((e.clientY - rect.top) / rect.height) * 2 - 1);
    },
    [mouseX, mouseY],
  );

  const handleMouseLeave = useCallback(() => {
    mouseX.set(0);
    mouseY.set(0);
  }, [mouseX, mouseY]);

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="w-[300px] h-[210px] flex items-center justify-center cursor-default [perspective:800px] overflow-hidden relative"
    >
      <div className="[transform-style:preserve-3d] relative w-0 h-0">
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
