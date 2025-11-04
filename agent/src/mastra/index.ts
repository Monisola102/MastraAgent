import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { nutritionAgent } from "./agents/nutrition-agent";
import { foodInfoAgentRoute } from "./routes/agentRoutes";

const mastra = new Mastra({
  agents: { nutritionAgent },
  storage: new LibSQLStore({ url: ":memory:" }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "debug",
  }),
  observability: {
    default: { enabled: true },
  },
  server: {
    build: {
      openAPIDocs: true,
      swaggerUI: true,
    },
    apiRoutes: [foodInfoAgentRoute],
  },
});

export { mastra };