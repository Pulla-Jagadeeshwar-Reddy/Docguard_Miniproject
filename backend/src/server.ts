import { app } from "./app.js";
import { env } from "./config/env.js";
import { scheduleExpirySweep } from "./services/expiry-sweeper.js";

app.listen(env.port, () => {
  console.log(`DocuGuard API listening on port ${env.port}`);
  scheduleExpirySweep();
});
