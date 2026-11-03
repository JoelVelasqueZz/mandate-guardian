import { run } from "./edison-paypal.js";
// Backward-compatible first step, now with persisted IDs and private evidence.
await run(["create", "A"]);
