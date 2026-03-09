import { describe, expect, it, vi } from "vitest";

import { readTerminalSize, subscribeToTerminalResize } from "./useTerminalSize.js";

function createStdout(columns = 80, rows = 24) {
  let resizeListener: (() => void) | undefined;

  return {
    get columns() {
      return columns;
    },
    set columns(value: number) {
      columns = value;
    },
    get rows() {
      return rows;
    },
    set rows(value: number) {
      rows = value;
    },
    on: vi.fn((event: "resize", listener: () => void) => {
      if (event === "resize") {
        resizeListener = listener;
      }
    }),
    off: vi.fn((event: "resize", listener: () => void) => {
      if (event === "resize" && resizeListener === listener) {
        resizeListener = undefined;
      }
    }),
    emitResize() {
      resizeListener?.();
    },
  };
}

describe("useTerminalSize helpers", () => {
  it("reads current terminal size with defaults", () => {
    expect(readTerminalSize({ columns: undefined, rows: undefined })).toEqual({
      columns: 80,
      rows: 24,
    });
  });

  it("subscribes to resize events and reports updated terminal size", () => {
    const stdout = createStdout(100, 30);
    const onResize = vi.fn();

    const unsubscribe = subscribeToTerminalResize(stdout, onResize);

    expect(onResize).toHaveBeenNthCalledWith(1, { columns: 100, rows: 30 });

    stdout.columns = 132;
    stdout.rows = 42;
    stdout.emitResize();

    expect(onResize).toHaveBeenNthCalledWith(2, { columns: 132, rows: 42 });

    unsubscribe();

    expect(stdout.on).toHaveBeenCalledOnce();
    expect(stdout.off).toHaveBeenCalledOnce();
  });
});
