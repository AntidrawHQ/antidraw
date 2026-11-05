/**
 * The onboarding's prompts: what a new workspace's empty canvas offers to
 * run in the chat. Each prompt tells Claude to ask its own questions before
 * it starts, so there are no blanks for the user to fill.
 */
import { MARKS, type Mark } from "./logos";

/** Anything the canvas can run in the chat: a starter or a library. */
export type Pick = {
  id: string;
  prompt: string;
  /** What an untitled chat is named from. */
  title: string;
};

export type Starter = Pick & { blurb: string };

export type Library = Pick & {
  name: string;
  /** Who makes it (the company, for a design system), shown before the blurb. */
  by?: string;
  blurb: string;
  /** The maker's logo, on its tile colour. */
  mark: Mark;
};

/* ───────────────────────── Bring your brand ───────────────────────── */

const BRAND: Starter = {
  id: "brand",
  title: "Point at your website and build in your brand",
  blurb: "Pulls colours, fonts, logo and voice from your site",
  prompt:
    "Build something in my brand. Before you start, ask me for my website URL and what you should make with it: a landing page, a product announcement, a social card, or something you'd suggest. Then pull my brand from the site: colors, fonts, logo, spacing, and how the copy sounds. Show me the brand you pulled before you build, so I can correct anything you got wrong.",
};

// The company's own design system. Claude finds out where it lives before
// installing anything.
const OWN_SYSTEM: Starter = {
  id: "own-ds",
  title: "Use your company's design system",
  blurb: "From npm, a private registry or a GitHub repo",
  prompt:
    "Set up my company's design system in this project. Before you start, ask me where it lives (an npm package, a private registry, a GitHub repo or a local folder) and how to get access if it's private. Install it, then show me a short inventory of what you found: components, tokens and themes. Then build a first screen with it, using only its own components and tokens.",
};

// A codebase on this machine, read for context: its components, tokens and
// conventions shape what Claude builds here. Nothing there is changed.
const CODEBASE: Starter = {
  id: "codebase",
  title: "Build from a codebase on your machine",
  blurb: "Claude reads its components, tokens and patterns first",
  prompt:
    "Use a codebase on my machine as context. Before you start, ask me for the folder path and what you should build. Read it without changing anything there: find its components, design tokens, styles and conventions, and give me a short summary of what you found. Then build what I asked for in this workspace so it looks and feels like it belongs in that codebase, reusing its patterns. Copy or recreate what you need here rather than importing across projects.",
};

// Over everything: where the user's brand lives. Building in their own look
// from the first prompt is the thing to try first. Each row says what Claude
// does with it.
export const BRAND_SOURCES = [
  { st: BRAND, kind: "site" as const, title: "Your website", does: "Claude reads your site and pulls your brand" },
  { st: OWN_SYSTEM, kind: "ds" as const, title: "Your design system", does: "Claude installs it and builds with its parts" },
  { st: CODEBASE, kind: "code" as const, title: "Your codebase", does: "Claude reads its components and tokens" },
];

/* ───────────────────────── Use cases ───────────────────────── */

// Jobs people bring with them: start from what they're working on, not
// from a technology.
export const USE_CASES: Starter[] = [
  {
    id: "uc-screenshot",
    title: "Try a change on a real screen",
    blurb: "Attach a screenshot, compare a few takes on it",
    prompt:
      "I want to explore a change to a page in my product. Before you start, ask me to attach a screenshot of the page if I haven't, and what the change should solve, in a sentence or two. First rebuild the page as closely as you can, using my design system if this workspace has one. Then make three or four distinct takes on the change, each as its own component so I can compare them on the canvas, and tell me in one line what each one trades off.",
  },
  {
    id: "uc-video",
    title: "Make a video for your feature",
    blurb: "Storyboard it scene by scene on the canvas, then animate",
    prompt:
      "Make a short video for a feature I'm shipping. Before you start, ask me what the feature does and who it's for, where the video will be posted (X, LinkedIn, the changelog or a product page) and how long it should be: 15, 30 or 60 seconds. If the feature's screens are in this workspace or I attach screenshots, show the real UI rather than a generic one.\n\nStoryboard it on the canvas before animating anything: put each scene in its own component, named in order (Scene01, Scene02…), showing its key frame at the video's size, with a line on what moves and for how long. For the opening scene, give me two or three directions to pick from. I'll comment on the frames and adjust them there. Once I approve the storyboard, animate it with Remotion, building on the approved scene components so the video matches what I signed off, and set it up so it can be rendered to an MP4.",
  },
  {
    id: "uc-prd",
    title: "Turn a PRD into a clickable prototype",
    blurb: "Paste the doc or a requirements table",
    prompt:
      "Turn my PRD into a clickable prototype. Before you start, ask me to paste the PRD or a table of requirements, and a screenshot of where the feature lives if there is one. Build the main flow end to end with realistic data, including empty, loading and error states. Then list anything the PRD left unclear, as questions I can take to the team.",
  },
  {
    id: "uc-options",
    title: "Compare directions before anyone builds",
    blurb: "Each one in its own frame, with the same data",
    prompt:
      "Help me choose between a few directions by building each one. Before you start, ask me what we're deciding, which directions are on the table and what matters most in choosing. Build each option as its own component with the same data so they can be compared side by side, then give me a short comparison of the trade-offs.",
  },
  {
    id: "uc-customer",
    title: "Prototype what a customer asked for",
    blurb: "From call notes to something you can show back",
    prompt:
      "Prototype a feature a customer asked for. Before you start, ask me to paste the call notes or describe the request, who the customer is, and a screenshot of that part of the product if I have one. Build a clickable prototype I can show back to them, and list the assumptions you made so I can check them on the next call.",
  },
  {
    id: "uc-demo",
    title: "Mock up your product for a sales call",
    blurb: "With the prospect's name, colours and data",
    prompt:
      "Mock up my product for a prospect I'm meeting. Before you start, ask me who the prospect is (company and website), which features to show and what story the demo should tell. Use their name, brand colours and realistic data from their world throughout, and make it clickable so I can drive it live on a call.",
  },
  {
    id: "uc-flow",
    title: "Design a flow you can click through",
    blurb: "Onboarding, checkout or setup, every screen linked",
    prompt:
      "Design a multi-step flow that can be clicked through end to end. Before you start, ask me which flow (onboarding, checkout, setup or something else), who goes through it and what they should have at the end. Link every screen, keep state between steps, and cover the edge cases: going back, skipping, validation errors and a success screen.",
  },
];

/* ───────────────────────── Ideas ───────────────────────── */

// Things to make, each naming its library in the title.
export const IDEAS: Starter[] = [
  {
    id: "slides",
    title: "Design a slide deck, three ways",
    blurb: "Pick a direction, then Claude builds the full deck",
    prompt:
      "Make a slide deck as a React component. Before you start, ask me what it's about, who it's for, roughly how many slides, and whether to use my brand or content I'll paste in. Then design three distinct visual directions (type, colour, layout), each as its own component showing the title slide and one content slide, so I can compare them side by side. Once I pick one, build the full deck in that direction: one idea per slide, real charts or visuals where they help, arrow keys to move between slides and a slide counter.",
  },
  {
    id: "dashboard",
    title: "Build a dashboard with shadcn",
    blurb: "Sidebar, KPI cards, charts and a filterable table",
    prompt:
      "Build a dashboard with shadcn/ui. Before you start, ask me what it tracks, who will use it, and which numbers matter most. Include a sidebar, KPI cards at the top, a couple of charts, and a table with filters. Use realistic sample data unless I attach my own. Make it look like a real product, not a template.",
  },
  {
    id: "kumo",
    title: "Build a Cloudflare dashboard with Kumo UI",
    blurb: "Cloudflare's own sidebar, tables, badges and cards",
    prompt:
      "Build a dashboard screen with Kumo, Cloudflare's component library (@cloudflare/kumo). Before you start, ask me what it manages (domains, Workers, users, billing or something else) and which actions matter most. Use Kumo's own components (Sidebar, LayerCard, Table, Badge, Button) and its theme rather than custom styles, with realistic sample data.",
  },
  {
    id: "liveline",
    title: "Make charts that move with Liveline",
    blurb: "Animated, real-time, with a headline number",
    prompt:
      "Use Liveline to make an animated chart. Before you start, ask me what it should show, or suggest three ideas and let me pick. It should feel alive: smooth updates, hover details, and a clear headline number. Start with sample data that updates in real time.",
  },
  {
    id: "voice",
    title: "Design a voice assistant with ElevenLabs UI & shadcn",
    blurb: "Orb, live waveform and transcript",
    prompt:
      "Build a voice assistant UI with ElevenLabs UI and shadcn/ui components: the Orb, a live waveform, a voice button and a conversation transcript. Before you start, ask me what the assistant is for and how it should feel: calm, playful or professional.",
  },
  {
    id: "video",
    title: "Make a product intro using Remotion",
    blurb: "A short animated film, storyboarded first",
    prompt:
      "Make a short product intro video with Remotion. Before you start, ask me what the product is, the one thing viewers should remember, and how long it should be: 15, 30 or 60 seconds. Storyboard it on the canvas first, one component per scene showing its key frame, so I can comment on each before you animate.",
  },
  {
    id: "motion",
    title: "Craft a micro-interaction with Motion",
    blurb: "Three directions for one delightful detail",
    prompt:
      "Design a micro-interaction with Motion that feels great to use. Before you start, ask me which element it's for (a button, a toggle, a like, a checkout step), then show me three directions side by side so I can pick one.",
  },
];

/* ───────────────────────── Libraries ───────────────────────── */

// A company's design system: Claude installs it and asks what to build.
const system = (id: string, name: string, by: string, pkg: string, blurb: string, mark: Mark): Library => ({
  id,
  name,
  title: name,
  by,
  blurb,
  mark,
  prompt: `Build with ${name}, ${by}'s design system (${pkg}). Install it if it isn't already. Before you start, ask me what to build with it, or suggest three screens that show what it does well. Use its own components, tokens and theme rather than custom styles.`,
});

// Any other library: `ask` is the question Claude starts with.
const library = (id: string, name: string, pkg: string, blurb: string, ask: string, mark: Mark): Library => ({
  id,
  name,
  title: name,
  blurb,
  mark,
  prompt: `Install ${name} (${pkg}) if it isn't already, and build something with it. Before you start, ${ask}`,
});

const SUGGEST = "ask me what to build with it, or suggest three ideas and let me pick.";

export const LIBRARY_GROUPS: { title: string; items: Library[] }[] = [
  {
    title: "Design systems",
    items: [
      system("lib-material", "Material UI", "Google", "@mui/material, Material Design for React", "Material Design, the system behind Android and Google's apps", MARKS.material),
      system("lib-fluent", "Fluent UI", "Microsoft", "@fluentui/react-components", "The system behind Windows, Office and Teams", MARKS.microsoft),
      system("lib-carbon", "Carbon", "IBM", "@carbon/react", "Enterprise product UI, data tables and charts", MARKS.ibm),
      system("lib-spectrum", "React Spectrum", "Adobe", "@adobe/react-spectrum", "The system behind Photoshop, Lightroom and Acrobat", MARKS.adobe),
      system("lib-primer", "Primer", "GitHub", "@primer/react", "GitHub's interface, from repos to pull requests", MARKS.github),
      system("lib-atlassian", "Atlassian Design System", "Atlassian", "the @atlaskit packages", "The system behind Jira, Confluence and Trello", MARKS.atlassian),
      system("lib-kumo", "Kumo", "Cloudflare", "@cloudflare/kumo", "Cloudflare's dashboard: sidebar, tables, layer cards", MARKS.cloudflare),
      system("lib-lightning", "Lightning", "Salesforce", "@salesforce-ux/design-system", "CRM screens: records, list views, forms", MARKS.salesforce),
      system("lib-ant", "Ant Design", "Ant Group", "antd", "Dense, data-heavy enterprise apps", MARKS.antdesign),
      system("lib-paste", "Paste", "Twilio", "@twilio-paste/core", "Accessible product UI from Twilio's console", MARKS.twilio),
      system("lib-gestalt", "Gestalt", "Pinterest", "gestalt", "Pinterest's visual, image-first components", MARKS.pinterest),
      system("lib-baseweb", "Base Web", "Uber", "baseui", "Uber's components, themeable down to every part", MARKS.uber),
      system("lib-canvas", "Canvas Kit", "Workday", "@workday/canvas-kit-react", "HR and finance apps: forms, tables, flows", MARKS.workday),
    ],
  },
  {
    title: "Component libraries",
    items: [
      library("lib-shadcn", "shadcn/ui", "the shadcn CLI", "Copy-in components on Radix and Tailwind", SUGGEST, MARKS.shadcn),
      library("lib-radix", "Radix Themes", "@radix-ui/themes", "Accessible, themeable components from WorkOS", SUGGEST, MARKS.radix),
      library("lib-mantine", "Mantine", "@mantine/core", "100+ components and hooks, dark mode built in", SUGGEST, MARKS.mantine),
      library("lib-chakra", "Chakra UI", "@chakra-ui/react", "Composable components with style props", SUGGEST, MARKS.chakra),
      library("lib-heroui", "HeroUI", "@heroui/react", "Polished, animated components on Tailwind", SUGGEST, MARKS.heroui),
    ],
  },
  {
    title: "Motion and media",
    items: [
      library("lib-motion", "Motion", "motion", "Animations, gestures and layout transitions", "ask me which element to animate, then show me three directions side by side.", MARKS.motion),
      library("lib-remotion", "Remotion", "remotion", "Make videos with React", "ask me what the video is about and how long it should be.", MARKS.remotion),
      library("lib-r3f", "React Three Fiber", "@react-three/fiber", "three.js scenes as React components", SUGGEST, MARKS.three),
      library("lib-elevenlabs", "ElevenLabs UI", "it installs through the shadcn CLI", "Voice agent parts: orb, waveform, transcript", "ask me what the assistant is for and how it should feel.", MARKS.elevenlabs),
      library("lib-magicui", "Magic UI", "it installs through the shadcn CLI", "Animated components for landing pages", SUGGEST, MARKS.magicui),
      library("lib-recharts", "Recharts", "recharts", "Composable charts for React", "ask me what the data is, or use realistic sample data and suggest three charts.", MARKS.recharts),
    ],
  },
];
