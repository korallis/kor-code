import type { Execution } from "@kor-code/core";

export interface Controller { dispatch(execution: Execution): Promise<never> }
export function createController(): Controller {
  return { async dispatch(): Promise<never> { throw new Error("Kor controller is reserved for Phase 2"); } };
}
