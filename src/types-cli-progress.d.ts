/**
 * Minimal type declaration for the cli-progress module.
 *
 * Why we have this file (educational note for someone new to RAGs):
 *   `cli-progress` doesn't ship its own .d.ts. We could install
 *   `@types/cli-progress`, but that adds a dev dependency for a
 *   single import. A hand-rolled declaration is cheaper, and we
 *   only use two of its methods.
 */
declare module "cli-progress" {
  export const Presets: { shades_classic: unknown };
  export class SingleBar {
    constructor(format: unknown, preset: unknown);
    start(total: number, startValue: number): void;
    update(value: number): void;
    stop(): void;
  }
}
