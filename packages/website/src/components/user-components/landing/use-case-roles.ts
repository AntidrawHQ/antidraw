/**
 * The use cases by role, as data: titles, lines and pitches, no scenes. The navbar and the footer list them
 * from here without loading a single scene; landing/UseCases.tsx attaches each case's Scene to draw the rows.
 */
export type UseCaseInfo = { title: string; line: string }
export type RoleInfo = { role: string; pitch: string; cases: UseCaseInfo[] }

export const USE_CASE_ROLES: RoleInfo[] = [
  {
    role: "PMs",
    pitch: "Make prototypes and wireframes people can actually use and share. Explore directions until you find the right one, at AI-native speed.",
    cases: [
      { title: "Several takes on one PRD", line: "Hand it the PRD and ask for three takes. Each one is built from the components your team already ships, so every option on the table is one engineering could actually build." },
      { title: "Real flows you can click through", line: "Screens that link up, with the transitions, loading states and small interactions in place. Walk a stakeholder through the real thing instead of narrating a slide." },
      { title: "Real data, real logic", line: "Drop in a spreadsheet or a sample of real data, and give the prototype logic a picture can't fake: sorting, filtering, search, totals, pricing maths. Your numbers and edge cases, not lorem ipsum." },
      { title: "Test it with users", line: "Run research sessions on a prototype that behaves like the product. Testers click through the real flow while you watch, and you can change it between sessions." },
    ],
  },
  {
    role: "Designers",
    pitch: "Design in the material the product is made of.",
    cases: [
      { title: "Animations other tools can't do", line: "Springs, gestures, scroll, drag and physics you can actually feel, not a prototype link that fakes it with dissolves. Tune the motion on the real component until it's right." },
      { title: "Build the controls you need", line: "Ask for the exact sliders, swatches and toggles a design needs, then shape it by hand. When AI can make almost anything, the craft is in having the right handles." },
      { title: "Design every state", line: "Hover, loading, empty, error, the 40-character name and the three-line title. Flip through them on the real component instead of drawing each one." },
      { title: "Responsive for real", line: "Resize the frame and the layout reflows the way it will in the browser. No more drawing a mobile, tablet and desktop copy of every screen." },
    ],
  },
  {
    role: "Marketers",
    pitch: "On-brand assets from the real product, with every detail yours to adjust.",
    cases: [
      { title: "Launch videos with Remotion", line: "Feature announcements made from your real components and brand, scene by scene. The product in the video is the product people get, and every frame is yours to adjust." },
      { title: "Slides made of real components", line: "Launch keynotes and webinar decks built from your actual product and brand. Animated where you want it, and never out of date with the app." },
      { title: "Every size, from one design", line: "Because it's code, one design adapts. Ask for the square, the story and the banner, and each one lays itself out properly instead of being redrawn." },
    ],
  },
  {
    role: "Sales",
    pitch: "Show prospects the product they're buying, shaped around them.",
    cases: [
      { title: "Mockups with their data", line: "Their logo, their colours and their records, inside your product. Show a prospect what it looks like when it's theirs, before they've signed anything." },
    ],
  },
]
