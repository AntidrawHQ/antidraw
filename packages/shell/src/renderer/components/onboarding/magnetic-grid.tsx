import { useEffect, useRef } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "motion/react";

const COLS = 5;
const ROWS = 5;
const CELL_SIZE = 32;
const GAP = 5;
const REPEL_RADIUS = 120;
const REPEL_STRENGTH = 28;
const gridWidth = COLS * (CELL_SIZE + GAP) - GAP;
const gridHeight = ROWS * (CELL_SIZE + GAP) - GAP;
const springConfig = { stiffness: 420, damping: 20, mass: 0.28 };

const GridCell = ({
  row,
  colIdx,
  cursorX,
  cursorY,
}: {
  row: number;
  colIdx: number;
  cursorX: MotionValue<number>;
  cursorY: MotionValue<number>;
}) => {
  const cxp = colIdx * (CELL_SIZE + GAP) + CELL_SIZE / 2;
  const cyp = row * (CELL_SIZE + GAP) + CELL_SIZE / 2;

  const rawX = useTransform([cursorX, cursorY], ([mx, my]: number[]) => {
    const dx = cxp - mx,
      dy = cyp - my,
      dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1 || dist > REPEL_RADIUS) return 0;
    return ((1 - dist / REPEL_RADIUS) ** 2 * REPEL_STRENGTH * dx) / dist;
  });
  const rawY = useTransform([cursorX, cursorY], ([mx, my]: number[]) => {
    const dx = cxp - mx,
      dy = cyp - my,
      dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1 || dist > REPEL_RADIUS) return 0;
    return ((1 - dist / REPEL_RADIUS) ** 2 * REPEL_STRENGTH * dy) / dist;
  });
  const x = useSpring(rawX, springConfig);
  const y = useSpring(rawY, springConfig);
  const scale = useTransform([cursorX, cursorY], ([mx, my]: number[]) => {
    const dx = cxp - mx,
      dy = cyp - my,
      dist = Math.sqrt(dx * dx + dy * dy);
    return dist > REPEL_RADIUS ? 1 : 1 - (1 - dist / REPEL_RADIUS) * 0.12;
  });
  const ss = useSpring(scale, { stiffness: 420, damping: 20, mass: 0.28 });

  return (
    <motion.div
      style={{
        width: CELL_SIZE,
        height: CELL_SIZE,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 4,
        translateX: x,
        translateY: y,
        scale: ss,
      }}
    />
  );
};

export const MagneticGrid = () => {
  const isHovering = useRef(false);
  const reducedMotion = useReducedMotion();
  const cursorX = useMotionValue(gridWidth / 2);
  const cursorY = useMotionValue(gridHeight / 2);

  useEffect(() => {
    if (reducedMotion) return;
    let frame: number;
    const cxc = gridWidth / 2,
      cyc = gridHeight / 2,
      rx = gridWidth * 0.4,
      ry = gridHeight * 0.38;
    const loop = (time: number) => {
      if (!isHovering.current) {
        const t = time * 0.001;
        cursorX.set(
          cxc +
            (Math.sin(t * 1.7) * 0.5 +
              Math.sin(t * 2.9 + 0.8) * 0.3 +
              Math.sin(t * 4.3 + 2.1) * 0.2) *
              rx,
        );
        cursorY.set(
          cyc +
            (Math.sin(t * 2.1 + 1.0) * 0.5 +
              Math.sin(t * 3.7 + 2.4) * 0.3 +
              Math.sin(t * 5.1 + 0.3) * 0.2) *
              ry,
        );
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [cursorX, cursorY, reducedMotion]);

  return (
    <div
      onMouseMove={(e) => {
        isHovering.current = true;
        const r = e.currentTarget.getBoundingClientRect();
        cursorX.set(e.clientX - r.left);
        cursorY.set(e.clientY - r.top);
      }}
      onMouseLeave={() => {
        isHovering.current = false;
      }}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, ${CELL_SIZE}px)`,
        gridTemplateRows: `repeat(${ROWS}, ${CELL_SIZE}px)`,
        gap: GAP,
        cursor: "default",
      }}
    >
      {Array.from({ length: ROWS * COLS }).map((_, idx) => (
        <GridCell
          key={idx}
          row={Math.floor(idx / COLS)}
          colIdx={idx % COLS}
          cursorX={cursorX}
          cursorY={cursorY}
        />
      ))}
    </div>
  );
};
