import type { Bridge } from "./bridge";
import { setMode, getMode } from "./editor";
export function setupMode(bridge: Bridge): void {
  bridge.registerHandler("mode.set", ({ mode }: { mode: string }) => {
    const mapped =
      mode === "edit" ? "source" : mode === "split" ? "live" : mode;
    if (!["live", "source", "preview"].includes(mapped))
      throw Error("未知编辑模式");
    setMode(mapped as "live" | "source" | "preview");
    return { mode: getMode() };
  });
}
