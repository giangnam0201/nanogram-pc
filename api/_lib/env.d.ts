/* The Edge runtime exposes `process.env` for configuration but is not Node, so
   pulling in @types/node would describe a great deal that does not exist here.
   This declares only the part that is real. */

declare const process: {
  env: Record<string, string | undefined>;
};
