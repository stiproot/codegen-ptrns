import { Effect, Console } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { appConfig } from "./cfg";
import { createModel, createWorkflow, getTools, MCPClientService, runQuery } from "./utls";


// Main program logic using the MCP Client service
const program = Effect.gen(function* () {
  // Load configuration using Effect's Config primitive
  const config = yield* appConfig;

  // Get tools from MCP client (service is injected via Layer)
  const tools = yield* getTools;

  // Create model
  const model = yield* createModel(config, tools);

  // Create workflow
  const app = yield* createWorkflow(model, tools);

  // Run queries
  const queries = ["What is the weather doing in Los Angeles today?"];

  yield* Console.log("\n=== RUNNING LANGGRAPH AGENT ===");

  for (const query of queries) {
    yield* runQuery(app, query);
  }
});

const main = program.pipe(
  Effect.catchAll((error: any) =>
    Console.error(`Error: ${error._tag || 'Unknown'}`, error).pipe(
      Effect.andThen(() => Effect.die(error))
    )
  ),
  Effect.tap(() => Console.log("Example completed successfully")),
  Effect.provide(MCPClientService.Default)
);

NodeRuntime.runMain(main);