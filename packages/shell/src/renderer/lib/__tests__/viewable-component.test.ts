import { describe, test, expect } from "vitest";
import type { ToolPart } from "@/renderer/components/ui/tool";
import { viewableComponent } from "../tool-utils";

const done = (type: string, input: Record<string, unknown>): ToolPart => ({
  type,
  state: "output-available",
  input,
});

describe("viewableComponent", () => {
  test("Write and Edit: the component named in file_path", () => {
    const path = "/ws/source/src/components/user-components/PricingCard.tsx";
    expect(viewableComponent(done("Write", { file_path: path }))).toBe("PricingCard");
    expect(viewableComponent(done("Edit", { file_path: path }))).toBe("PricingCard");
  });

  test("Bash: the component named in the command", () => {
    const commands = [
      "sed -i '' 's/gap-2/gap-3/' src/components/user-components/Card.tsx",
      "cat > src/components/user-components/Card.tsx <<'EOF'\nexport default () => null\nEOF",
      "python3 - <<'EOF'\np = 'src/components/user-components/Card.tsx'\nEOF",
      "rm /Users/me/.antidraw/workspaces/abc/source/src/components/user-components/Card.tsx",
    ];
    for (const command of commands) {
      expect(viewableComponent(done("Bash", { command }))).toBe("Card");
    }
  });

  test("Bash touching several components: the first one", () => {
    const command =
      "cp src/components/user-components/Old.tsx src/components/user-components/New.tsx";
    expect(viewableComponent(done("Bash", { command }))).toBe("Old");
  });

  test("nothing for files that aren't canvas components", () => {
    const cases = [
      done("Write", { file_path: "src/components/ui/button.tsx" }),
      done("Write", { file_path: "src/components/user-components/realfast/shared.tsx" }),
      done("Write", { file_path: "src/components/user-components/data.json" }),
      done("Bash", { command: "npm run build" }),
      done("Grep", { pattern: "user-components" }),
    ];
    for (const toolPart of cases) {
      expect(viewableComponent(toolPart)).toBeNull();
    }
  });

  test("nothing while running or after an error", () => {
    const input = { file_path: "src/components/user-components/Card.tsx" };
    for (const state of ["input-streaming", "input-available", "output-error"] as const) {
      expect(viewableComponent({ type: "Write", state, input })).toBeNull();
    }
  });
});
