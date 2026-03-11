import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "ink-testing-library";

import { App } from "./App.js";

afterEach(() => {
  cleanup();
});

async function waitForFrame(
  getFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 2_000,
): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const frame = getFrame() ?? "";
    if (predicate(frame)) {
      return frame;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for frame. Last frame:\n${getFrame() ?? ""}`);
}

async function typeText(
  write: (value: string) => void,
  value: string,
): Promise<void> {
  for (const character of value) {
    write(character);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("App interactions", () => {
  it("collapses and expands the active folder with h and l", async () => {
    const instance = render(<App sourceArg="./testdata" targetCwd={process.cwd()} />);

    await waitForFrame(
      instance.lastFrame,
      (frame) => frame.includes("frontend") && frame.includes("form-primitives"),
    );

    instance.stdin.write("h");

    const collapsedFrame = await waitForFrame(
      instance.lastFrame,
      (frame) => frame.includes("› + [ ] local-nested-skills") && !frame.includes("frontend"),
    );

    expect(collapsedFrame).not.toContain("form-primitives");

    instance.stdin.write("l");

    const expandedFrame = await waitForFrame(
      instance.lastFrame,
      (frame) =>
        frame.includes("›   + [ ] frontend") &&
        frame.includes("platform") &&
        frame.includes("security"),
    );

    expect(expandedFrame).toContain("frontend");
    expect(expandedFrame).not.toContain("form-primitives");
  });

  it("updates the selected count when toggling the active folder", async () => {
    const instance = render(<App sourceArg="./testdata" targetCwd={process.cwd()} />);

    await waitForFrame(
      instance.lastFrame,
      (frame) => frame.includes("0 selected") && frame.includes("local-nested-skills"),
    );

    instance.stdin.write(" ");

    const selectedFrame = await waitForFrame(
      instance.lastFrame,
      (frame) => frame.includes("8 selected"),
    );

    expect(selectedFrame).toContain("8 selected");
    expect(selectedFrame).toContain("[x] local-nested-skills");
  });

  it("filters the tree through search mode", async () => {
    const instance = render(<App sourceArg="./testdata" targetCwd={process.cwd()} />);

    await waitForFrame(
      instance.lastFrame,
      (frame) => frame.includes("local-nested-skills") && frame.includes("mixed-malformed-skills"),
    );

    instance.stdin.write("/");
    await waitForFrame(instance.lastFrame, (frame) => frame.includes("Search: _"));

    await typeText(instance.stdin.write, "enterprise");
    await waitForFrame(instance.lastFrame, (frame) => frame.includes("Search: enterprise_"));

    instance.stdin.write("\r");

    const filteredFrame = await waitForFrame(
      instance.lastFrame,
      (frame) =>
        frame.includes("filter: enterprise") &&
        frame.includes("enterprise-content-authorin…") &&
        !frame.includes("form-primitives"),
    );

    expect(filteredFrame).toContain("filter: enterprise");
    expect(filteredFrame).not.toContain("form-primitives");
  });
});
