import { serve } from "@hono/node-server";
import { buildApp } from "./http/app.js";
import { config } from "./config.js";

const port = config().API_PORT;
serve({ fetch: buildApp().fetch, port }, () => {
  console.log(`Company Brain API listening on http://localhost:${port}`);
});
