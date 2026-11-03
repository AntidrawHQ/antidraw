export type MenuStyle = "list" | "described" | "swatch" | "preview" | "mega" | "editorial" | "chips"

/** Wide styles span the navbar instead of hanging under their link. */
export const WIDE: Record<MenuStyle, boolean> = { list: false, described: false, swatch: false, preview: false, mega: true, editorial: false, chips: false }
