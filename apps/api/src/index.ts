import { bootstrap } from "./server/lifecycle.js";
import { log } from "./log.js";

bootstrap().catch((err: unknown) => {
  log.error("startup failed", {
    err: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
  process.exit(1);
});
