import { useEffect, useState } from "react";

interface TerminalLike {
  columns?: number;
  rows?: number;
  on: (event: "resize", listener: () => void) => void;
  off: (event: "resize", listener: () => void) => void;
}

export interface TerminalSize {
  columns: number;
  rows: number;
}

export function readTerminalSize(stdout: Pick<TerminalLike, "columns" | "rows">): TerminalSize {
  return {
    columns: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  };
}

export function subscribeToTerminalResize(
  stdout: TerminalLike,
  onResize: (size: TerminalSize) => void,
): () => void {
  const syncTerminalSize = (): void => {
    onResize(readTerminalSize(stdout));
  };

  syncTerminalSize();
  stdout.on("resize", syncTerminalSize);

  return () => {
    stdout.off("resize", syncTerminalSize);
  };
}

export function useTerminalSize(stdout: TerminalLike): TerminalSize {
  const [terminalSize, setTerminalSize] = useState<TerminalSize>(() => readTerminalSize(stdout));

  useEffect(() => {
    return subscribeToTerminalResize(stdout, (nextSize) => {
      setTerminalSize((currentSize) => {
        if (currentSize.columns === nextSize.columns && currentSize.rows === nextSize.rows) {
          return currentSize;
        }

        return nextSize;
      });
    });
  }, [stdout]);

  return terminalSize;
}
