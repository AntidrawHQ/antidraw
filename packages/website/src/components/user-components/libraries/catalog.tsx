/**
 * Every library the landing's showcases name, with its mark and maker: the open-source ones you
 * bring yourself, and company design systems. Only libraries with public React packages. Shared by the Library* showcase variations.
 */
import { MARKS, type Mark } from "../antidraw-empty/logos"
import { COMPANY_SYSTEMS } from "./companies/CompanyLogoStrip"
import { arkMark } from "./open/ArkTile"

export type Lib = { library: string; maker: string; mark: Mark }

export const OPEN_LIBS: Lib[] = [
  { library: "shadcn/ui", maker: "Open source", mark: MARKS.shadcn },
  { library: "Radix", maker: "WorkOS", mark: MARKS.radix },
  { library: "Ark UI", maker: "Chakra UI", mark: arkMark },
  { library: "React Aria", maker: "Adobe", mark: MARKS.adobe },
  { library: "Mantine", maker: "Open source", mark: MARKS.mantine },
  { library: "Material UI", maker: "MUI", mark: MARKS.material },
  { library: "Chakra UI", maker: "Open source", mark: MARKS.chakra },
  { library: "HeroUI", maker: "Open source", mark: MARKS.heroui },
  { library: "Motion", maker: "Motion", mark: MARKS.motion },
  { library: "Magic UI", maker: "Open source", mark: MARKS.magicui },
  { library: "Recharts", maker: "Open source", mark: MARKS.recharts },
  { library: "Remotion", maker: "Remotion", mark: MARKS.remotion },
  // Three.js itself isn't a React library; React Three Fiber is how React uses it.
  { library: "React Three Fiber", maker: "Poimandres", mark: MARKS.three },
  { library: "ElevenLabs UI", maker: "ElevenLabs", mark: MARKS.elevenlabs },
]

export const COMPANY_LIBS: Lib[] = [
  { library: "Kumo", maker: "Cloudflare", mark: MARKS.cloudflare },
  { library: "Fluent UI", maker: "Microsoft", mark: MARKS.microsoft },
  { library: "Polaris", maker: "Shopify", mark: MARKS.shopify },
  { library: "Primer", maker: "GitHub", mark: MARKS.github },
  { library: "React Spectrum", maker: "Adobe", mark: MARKS.adobe },
  { library: "Ant Design", maker: "Ant Group", mark: MARKS.antdesign },
  ...COMPANY_SYSTEMS,
]

/** A mark at any size: the 16px glyph scaled up inside a rounded square on the brand colour. */
export function BigMark({ mark, size = 40, radius = 10, className }: { mark: Mark; size?: number; radius?: number; className?: string }) {
  const k = size / 20
  return (
    <span className={className} style={{ display: "grid", placeItems: "center", width: size, height: size, borderRadius: radius, background: mark.bg, overflow: "hidden", flexShrink: 0 }}>
      <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, transform: `scale(${k})` }}>{mark.node}</span>
    </span>
  )
}
