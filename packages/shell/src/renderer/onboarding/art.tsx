/**
 * The onboarding cards' thumbnails: small live pieces that fill their box.
 * Each is drawn large and scaled down by the card (IdeaCard), so its sizes
 * are those of the box it's drawn in, not of the card.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
// A plain join, as the design has it: no class is merged away.
const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const useTick = (ms: number) => {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return t;
};

/* ───────────────────────── Ideas ───────────────────────── */

const DashArt = () => (
  <div className="flex h-full gap-[4%] p-[6%]">
    <div className="w-[10%] rounded-[3px] bg-white/[0.06]" />
    <div className="flex flex-1 flex-col gap-[6%]">
      <div className="flex h-[22%] gap-[4%]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 rounded-[3px] bg-white/[0.07]" />
        ))}
      </div>
      <div className="flex flex-1 items-end gap-[3%] rounded-[3px] bg-white/[0.04] p-[4%]">
        {[40, 65, 50, 80, 60, 90, 72, 58].map((h, i) => (
          <div key={i} className="flex-1 rounded-[1px] bg-white/25 transition-all duration-500 group-hover:bg-white/40" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  </div>
);

const LiveArt = () => {
  const [pts, setPts] = useState(() => Array.from({ length: 16 }, (_, i) => 50 + Math.sin(i / 2) * 18));
  useEffect(() => {
    const id = window.setInterval(
      () => setPts((p) => [...p.slice(1), Math.max(12, Math.min(88, (p.at(-1) ?? 50) + (Math.random() - 0.48) * 22))]),
      700,
    );
    return () => window.clearInterval(id);
  }, []);
  const d = pts.map((y, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * 160} ${100 - y}`).join(" ");
  return (
    <div className="relative h-full p-[6%]">
      <div className="text-[clamp(12px,1.6vw,20px)] font-semibold text-white/85 tabular-nums">{((pts.at(-1) ?? 50) * 12.4).toFixed(0)}</div>
      <svg viewBox="0 0 160 100" preserveAspectRatio="none" className="absolute inset-x-[6%] bottom-[8%] h-[55%] w-[88%]">
        <path d={`${d} L160 100 L0 100 Z`} fill="rgba(52,211,153,0.10)" style={{ transition: "d 600ms ease" }} />
        <path d={d} fill="none" stroke="#34d399" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ transition: "d 600ms ease" }} />
      </svg>
    </div>
  );
};

const VoiceArt = () => {
  const t = useTick(140);
  return (
    <div className="flex h-full items-center justify-center gap-[8%]">
      <div
        className="aspect-square h-[52%] max-h-20 rounded-full"
        style={{
          background: "radial-gradient(circle at 35% 30%, #c7d2fe, #6366f1 45%, #1e1b4b 100%)",
          boxShadow: "0 0 24px rgba(99,102,241,0.45)",
          transform: `scale(${1 + Math.sin(t / 3) * 0.04})`,
          transition: "transform 140ms linear",
        }}
      />
      <div className="flex h-[40%] items-center gap-[3px]">
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-white/50"
            style={{ height: `${25 + Math.abs(Math.sin((t + i * 2) / 2.2)) * 75}%`, transition: "height 140ms linear" }}
          />
        ))}
      </div>
    </div>
  );
};

const VideoArt = () => {
  const t = useTick(60);
  const x = (t % 100) / 100;
  return (
    <div className="flex h-full flex-col justify-center gap-[7%] px-[8%]">
      <div className="relative grid h-[48%] place-items-center overflow-hidden rounded-[6px] bg-gradient-to-br from-[#1f2937] to-[#111827] ring-1 ring-white/10">
        <span
          className="text-[clamp(10px,1.3vw,16px)] font-semibold tracking-tight text-white/85"
          style={{ opacity: x < 0.5 ? x * 2 : 1, transform: `translateY(${Math.max(0, 6 - x * 24)}px)` }}
        >
          Introducing Acme
        </span>
      </div>
      <div className="relative h-[14%] rounded-[3px] bg-white/[0.06]">
        {[0.18, 0.42, 0.7].map((p) => (
          <span key={p} className="absolute top-0 bottom-0 w-px bg-white/15" style={{ left: `${p * 100}%` }} />
        ))}
        <span className="absolute -top-[20%] -bottom-[20%] w-[2px] rounded bg-[#f87171]" style={{ left: `${x * 100}%` }} />
      </div>
    </div>
  );
};

const MotionArt = () => {
  const t = useTick(900);
  const on = t % 2 === 1;
  return (
    <div className="flex h-full items-center justify-center gap-[10%]">
      <span
        className={cn(
          "flex h-[30%] max-h-9 items-center rounded-full px-[6%] text-[clamp(10px,1.2vw,14px)] font-medium transition-all duration-300",
          on ? "scale-95 bg-white text-black" : "scale-100 bg-white/10 text-white/80",
        )}
      >
        {on ? "Saved ✓" : "Save"}
      </span>
      <span className={cn("relative h-[22%] max-h-7 w-[22%] max-w-14 rounded-full transition-colors duration-300", on ? "bg-[#34d399]" : "bg-white/15")}>
        <span
          className="absolute top-[10%] bottom-[10%] aspect-square rounded-full bg-white shadow transition-all duration-300"
          style={{ left: on ? "auto" : "6%", right: on ? "6%" : "auto" }}
        />
      </span>
    </div>
  );
};

// Cloudflare's glyph, as Kumo's <CloudflareLogo variant="glyph" /> draws it.
const CloudflareGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 49 22" fill="none" role="img" aria-label="Cloudflare logo" className={className}>
    <path
      d="M33.204 20.4C33.3649 19.9741 33.4217 19.5159 33.3695 19.0636C33.3173 18.6113 33.1577 18.1781 32.904 17.8C32.6435 17.4876 32.3239 17.2297 31.9636 17.0409C31.6032 16.8522 31.2092 16.7363 30.804 16.7L13.404 16.5C13.304 16.5 13.204 16.4 13.104 16.4C13.0808 16.3825 13.0618 16.3599 13.0488 16.3339C13.0358 16.3078 13.029 16.2791 13.029 16.25C13.029 16.2209 13.0358 16.1922 13.0488 16.1662C13.0618 16.1401 13.0808 16.1175 13.104 16.1C13.204 15.9 13.304 15.8 13.504 15.8L31.004 15.6C32.115 15.4767 33.1731 15.0597 34.0695 14.3918C34.9659 13.7239 35.6681 12.8293 36.104 11.8L37.104 9.20002C37.104 9.10002 37.204 9.00001 37.104 8.90001C36.5604 6.47843 35.2411 4.30052 33.3466 2.69721C31.4521 1.09391 29.086 0.152865 26.6079 0.0170769C24.1298 -0.118712 21.675 0.558179 19.6167 1.94489C17.5584 3.33161 16.009 5.35233 15.204 7.70002C14.159 6.95365 12.8843 6.59957 11.604 6.70002C10.4291 6.83102 9.33369 7.35777 8.49774 8.19372C7.66179 9.02966 7.13505 10.1251 7.00404 11.3C6.93745 11.9014 6.97125 12.5097 7.10404 13.1C5.20298 13.1526 3.39743 13.9448 2.07147 15.3081C0.745511 16.6714 0.00377461 18.4982 0.00403983 20.4C-0.0123708 20.7695 0.0212659 21.1395 0.104038 21.5C0.10863 21.5781 0.141713 21.6517 0.19701 21.707C0.252307 21.7623 0.325975 21.7954 0.404041 21.8H32.504C32.704 21.8 32.904 21.7 32.904 21.5L33.204 20.4Z"
      fill="#F48120"
    />
    <path
      d="M38.704 9.20002H38.204C38.104 9.20002 38.004 9.30001 37.904 9.40001L37.204 11.8C37.0431 12.2259 36.9864 12.6841 37.0386 13.1364C37.0908 13.5887 37.2504 14.0219 37.504 14.4C37.7646 14.7124 38.0842 14.9704 38.4445 15.1591C38.8049 15.3479 39.1989 15.4637 39.604 15.5L43.304 15.7C43.404 15.7 43.504 15.8 43.604 15.8C43.6273 15.8175 43.6462 15.8401 43.6592 15.8662C43.6723 15.8922 43.679 15.9209 43.679 15.95C43.679 15.9791 43.6723 16.0078 43.6592 16.0339C43.6462 16.0599 43.6273 16.0826 43.604 16.1C43.504 16.3 43.404 16.4 43.204 16.4L39.404 16.6C38.293 16.7233 37.2349 17.1403 36.3386 17.8082C35.4422 18.4761 34.74 19.3707 34.304 20.4L34.104 21.3C34.004 21.4 34.104 21.6 34.304 21.6H47.504C47.5448 21.6058 47.5863 21.6021 47.6254 21.5891C47.6644 21.5761 47.6999 21.5541 47.729 21.525C47.7581 21.4959 47.7801 21.4604 47.7931 21.4214C47.8061 21.3823 47.8099 21.3408 47.804 21.3C48.0421 20.4527 48.1764 19.5797 48.204 18.7C48.1882 16.1854 47.1822 13.7782 45.404 12C43.6259 10.2218 41.2187 9.21587 38.704 9.20002Z"
      fill="#FAAD3F"
    />
  </svg>
);

// Kumo's art: Cloudflare's glyph over a small table of zones, each with a
// status badge, and an orange primary button.
const KumoArt = () => (
  <div className="flex h-full flex-col gap-[7%] p-[7%]">
    <div className="flex h-[26%] items-center gap-[5%]">
      <CloudflareGlyph className="h-full w-auto shrink-0" />
      <span className="h-[45%] w-[34%] rounded-[2px] bg-white/[0.12]" />
      <span className="ml-auto grid h-[70%] w-[26%] place-items-center rounded-[3px] bg-[#f6821f]">
        <span className="h-[30%] w-[55%] rounded-[1px] bg-white/80" />
      </span>
    </div>
    <div className="flex flex-1 flex-col justify-evenly rounded-[4px] bg-white/[0.04] px-[5%] ring-1 ring-white/[0.06]">
      {["#34d399", "#34d399", "#fbbf24"].map((c, i) => (
        <div key={i} className="flex items-center gap-[6%]">
          <span className="h-[5px] w-[38%] rounded-[2px] bg-white/25" />
          <span className="h-[5px] w-[20%] rounded-[2px] bg-white/10" />
          <span className="ml-auto h-[7px] w-[16%] rounded-full" style={{ background: c, opacity: 0.75 }} />
        </div>
      ))}
    </div>
  </div>
);

// Slides' art: three 16:9 slides fanned out, one per direction, the front
// one a title slide over a small chart.
const SlidesArt = () => (
  <div className="relative h-full">
    {[
      { x: "8%", y: "26%", r: -6, bg: "#f5f0e8", ink: "#2b2118", accent: "#e8613a" },
      { x: "30%", y: "16%", r: 4, bg: "#111827", ink: "#e5e7eb", accent: "#60a5fa" },
      { x: "20%", y: "34%", r: -1, bg: "#2b2b2b", ink: "#fafafa", accent: "#d97757" },
    ].map((sl, i) => (
      <div
        key={i}
        className="absolute flex aspect-video w-[58%] flex-col gap-[8%] rounded-[4px] p-[5%] shadow-[0_4px_12px_rgba(0,0,0,0.45)] ring-1 ring-white/10 transition-transform duration-300 group-hover:-translate-y-[3%]"
        style={{ left: sl.x, top: sl.y, background: sl.bg, transform: `rotate(${sl.r}deg)` }}
      >
        <span className="h-[14%] w-[62%] rounded-[1px]" style={{ background: sl.ink, opacity: 0.85 }} />
        <span className="h-[8%] w-[40%] rounded-[1px]" style={{ background: sl.ink, opacity: 0.35 }} />
        <span className="mt-auto flex h-[34%] items-end gap-[6%]">
          {[45, 70, 55, 100].map((h, j) => (
            <span
              key={j}
              className="flex-1 rounded-[1px]"
              style={{ height: `${h}%`, background: j === 3 ? sl.accent : sl.ink, opacity: j === 3 ? 1 : 0.25 }}
            />
          ))}
        </span>
      </div>
    ))}
  </div>
);

/* ───────────────────────── Use cases ───────────────────────── */

const Mini = ({ className = "", children }: { className?: string; children?: ReactNode }) => (
  <div className={cn("rounded-[5px] bg-white/[0.07] ring-1 ring-white/10", className)}>{children}</div>
);
const Bar = ({ w, o = 0.3, h = 6 }: { w: string; o?: number; h?: number }) => (
  <span className="block rounded-[2px] bg-white" style={{ width: w, height: h, opacity: o }} />
);

// A screenshot, then three variations of it.
const ScreenshotArt = () => (
  <div className="flex h-full items-center gap-[5%] px-[7%]">
    <Mini className="relative flex h-[66%] w-[42%] flex-col gap-[8%] p-[5%]">
      <Bar w="60%" o={0.5} />
      <Bar w="85%" o={0.2} />
      <span className="mt-auto block h-[34%] rounded-[3px] bg-white/[0.12]" />
      <span className="absolute -top-[9px] -left-[9px] grid size-[18px] place-items-center rounded-full bg-[#2a2a2a] ring-1 ring-white/20">
        <span className="size-[7px] rounded-full border-[1.5px] border-white/60" />
      </span>
    </Mini>
    <span className="h-[2px] w-[6%] bg-white/25" />
    <div className="flex h-[78%] flex-1 flex-col gap-[7%]">
      {[0.55, 0.35, 0.2].map((o, i) => (
        <Mini key={i} className="flex flex-1 items-center gap-[8%] px-[7%]">
          <span className="block h-[50%] w-[22%] rounded-[2px] bg-white" style={{ opacity: o }} />
          <Bar w="45%" o={0.25} h={5} />
        </Mini>
      ))}
    </div>
  </div>
);

// A doc's lines turning into a screen.
const PrdArt = () => (
  <div className="flex h-full items-center gap-[6%] px-[8%]">
    <div className="flex h-[72%] w-[36%] flex-col gap-[9%] rounded-[4px] bg-[#f4f4f4] p-[6%]">
      <span className="block h-[8px] w-[70%] rounded-[2px] bg-neutral-800" />
      {["90%", "75%", "85%", "60%"].map((w, i) => (
        <span key={i} className="block h-[4px] rounded-[2px] bg-neutral-400" style={{ width: w }} />
      ))}
    </div>
    <svg
      viewBox="0 0 24 24"
      className="size-[16px] shrink-0 text-white/40"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
    <Mini className="flex h-[72%] flex-1 flex-col gap-[9%] p-[6%]">
      <Bar w="55%" o={0.55} />
      <div className="flex flex-1 gap-[7%]">
        <span className="flex-1 rounded-[3px] bg-white/[0.12]" />
        <span className="flex-1 rounded-[3px] bg-white/[0.12]" />
      </div>
      <span className="block h-[16%] w-[42%] rounded-[3px] bg-white/70" />
    </Mini>
  </div>
);

// Option A next to option B.
const OptionsArt = () => (
  <div className="flex h-full items-center justify-center gap-[6%] px-[8%]">
    {(["A", "B"] as const).map((l) => (
      <div key={l} className="relative h-[70%] flex-1">
        <span className="absolute -top-[14px] left-0 text-[12px] font-semibold text-white/55">{l}</span>
        <Mini className={cn("flex h-full gap-[6%] p-[6%]", l === "B" && "flex-col")}>
          {l === "A" ? (
            <>
              <span className="flex flex-1 flex-col gap-[10%]">
                <Bar w="80%" o={0.4} />
                <Bar w="60%" o={0.2} />
              </span>
              <span className="w-[38%] rounded-[3px] bg-white/[0.16]" />
            </>
          ) : (
            <>
              <Bar w="50%" o={0.4} />
              <span className="flex-1 rounded-[3px] bg-white/[0.16]" />
            </>
          )}
        </Mini>
      </div>
    ))}
  </div>
);

// A customer's quote, and the screen that answers it.
const CustomerArt = () => (
  <div className="relative h-full">
    <div className="absolute top-[14%] left-[8%] w-[52%] rounded-[8px] rounded-bl-[2px] bg-white/[0.12] p-[4%]">
      <Bar w="85%" o={0.5} h={5} />
      <span className="mt-[6px] block">
        <Bar w="60%" o={0.3} h={5} />
      </span>
    </div>
    <Mini className="absolute right-[8%] bottom-[12%] flex h-[52%] w-[52%] flex-col gap-[10%] p-[5%]">
      <Bar w="50%" o={0.5} />
      <span className="flex-1 rounded-[3px] bg-white/[0.12]" />
    </Mini>
  </div>
);

// A demo in a prospect's colours, in a browser frame.
const DemoArt = () => (
  <div className="flex h-full items-center px-[8%]">
    <div className="h-[76%] w-full overflow-hidden rounded-[5px] bg-[#f4f4f4] ring-1 ring-white/10">
      <div className="flex h-[16%] items-center gap-[3px] bg-[#e2e2e2] px-[4%]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-[5px] rounded-full bg-neutral-400" />
        ))}
      </div>
      <div className="flex h-[84%] gap-[5%] p-[5%]">
        <span className="w-[18%] rounded-[3px] bg-[#1e3a8a]" />
        <div className="flex flex-1 flex-col gap-[8%]">
          <span className="flex items-center gap-[6%]">
            <span className="size-[10px] rounded-[3px] bg-[#1e3a8a]" />
            <span className="block h-[5px] w-[40%] rounded-[2px] bg-neutral-700" />
          </span>
          <span className="flex flex-1 items-end gap-[6%] rounded-[3px] bg-white p-[5%]">
            {[40, 65, 50, 90].map((h, i) => (
              <span key={i} className="flex-1 rounded-[1px] bg-[#1e3a8a]" style={{ height: `${h}%`, opacity: i === 3 ? 1 : 0.35 }} />
            ))}
          </span>
        </div>
      </div>
    </div>
  </div>
);

// A feature video, storyboarded: three numbered scene frames, a comment
// pinned on one, over a timeline cut into the same scenes. The playhead moves.
const FeatureVideoArt = () => {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((x) => (x + 1) % 100), 60);
    return () => window.clearInterval(id);
  }, []);
  const scene = t < 30 ? 0 : t < 65 ? 1 : 2;
  return (
    <div className="flex h-full flex-col justify-center gap-[9%] px-[7%]">
      <div className="flex gap-[4%]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="relative flex-1">
            <span className="absolute -top-[13px] left-0 text-[10px] font-semibold text-white/45">{i + 1}</span>
            <div
              className={cn(
                "flex aspect-video flex-col justify-center gap-[12%] overflow-hidden rounded-[4px] bg-[#1b1b1b] px-[12%] ring-1 transition-colors",
                scene === i ? "ring-white/60" : "ring-white/10",
              )}
            >
              <Bar w={["70%", "50%", "40%"][i] ?? "50%"} o={0.6} h={5} />
              <span className="block h-[30%] rounded-[2px] bg-white/[0.14]" style={{ width: ["45%", "80%", "60%"][i] }} />
            </div>
            {i === 1 && (
              <span className="absolute -top-[7px] -right-[6px] grid size-[15px] place-items-center rounded-full rounded-bl-[3px] bg-white text-[8px] font-bold text-neutral-900">
                1
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="relative flex h-[9px] gap-[2px] overflow-hidden rounded-[2px]">
        {[30, 35, 35].map((w, i) => (
          <span key={i} className={cn("h-full", scene === i ? "bg-white/25" : "bg-white/[0.08]")} style={{ width: `${w}%` }} />
        ))}
        <span className="absolute top-0 bottom-0 w-[2px] bg-white" style={{ left: `${t}%` }} />
      </div>
    </div>
  );
};

// Three screens, linked.
const FlowArt = () => (
  <div className="flex h-full items-center justify-center gap-[3%] px-[6%]">
    {[0, 1, 2].map((i) => (
      <div key={i} className="contents">
        {i > 0 && <span className="h-[2px] w-[6%] bg-white/30" />}
        <Mini className="flex h-[60%] flex-1 flex-col gap-[10%] p-[5%]">
          <Bar w="60%" o={0.45} h={5} />
          <span className="flex-1 rounded-[2px] bg-white/[0.1]" />
          <span className={cn("block h-[16%] rounded-[2px]", i === 2 ? "bg-white/70" : "bg-white/30")} />
        </Mini>
      </div>
    ))}
  </div>
);

/** Each card's art, by its prompt's id. */
export const ART: Record<string, () => ReactNode> = {
  dashboard: DashArt,
  liveline: LiveArt,
  voice: VoiceArt,
  video: VideoArt,
  motion: MotionArt,
  kumo: KumoArt,
  slides: SlidesArt,
  "uc-screenshot": ScreenshotArt,
  "uc-prd": PrdArt,
  "uc-options": OptionsArt,
  "uc-customer": CustomerArt,
  "uc-demo": DemoArt,
  "uc-video": FeatureVideoArt,
  "uc-flow": FlowArt,
};
