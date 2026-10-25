import { app } from "./app.js";
import { env } from "./config/env.js";

app.listen(env.port, () => {
  console.log(`DocuGuard API listening on port ${env.port}`);
});
