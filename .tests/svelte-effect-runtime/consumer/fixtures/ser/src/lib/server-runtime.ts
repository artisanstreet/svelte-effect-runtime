import { Context, Layer } from "effect";

export const RuntimeLabel = Context.Service<{ readonly value: string }>("ConformanceRuntimeLabel");

export const RuntimeLabelLive = Layer.succeed(RuntimeLabel, { value: "configured" });
