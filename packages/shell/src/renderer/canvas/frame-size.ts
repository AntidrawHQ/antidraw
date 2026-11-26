import { Laptop, Monitor, Smartphone, Tablet } from "lucide-react";

// The sizes a frame's toolbar offers (SizeMenu), and how a frame's size reads
// as one of them.

export type PresetId = "mobile" | "tablet" | "laptop" | "desktop";
export type Preset = { id: PresetId; label: string; w: number; h: number; Icon: typeof Smartphone };

export const PRESETS: Preset[] = [
  { id: "mobile", label: "Mobile", w: 390, h: 844, Icon: Smartphone },
  { id: "tablet", label: "Tablet", w: 768, h: 1024, Icon: Tablet },
  { id: "laptop", label: "Laptop", w: 1280, h: 800, Icon: Laptop },
  { id: "desktop", label: "Desktop", w: 1920, h: 1080, Icon: Monitor },
];

// The smallest a size typed or stepped in the menu goes. There's no largest:
// a size the user sets is theirs.
export const MIN_SIZE = 50;

// A frame's size as the menu has it. h null: the frame's height hugs its
// content (Auto).
export type FrameSize = { w: number; h: number | null };

// Phones and tablets turn on their side; laptops and desktops don't.
const TURNS: PresetId[] = ["mobile", "tablet"];

// The preset a size is: its own, or a phone or tablet turned on its side.
export const presetAt = ({ w, h }: FrameSize): { preset: Preset; turned: boolean } | null => {
  const upright = PRESETS.find((p) => p.w === w && p.h === h);
  if (upright) return { preset: upright, turned: false };
  const turned = PRESETS.find((p) => TURNS.includes(p.id) && p.h === w && p.w === h);
  return turned ? { preset: turned, turned: true } : null;
};

export const clampSize = (n: number) => Math.max(MIN_SIZE, Math.round(n));
