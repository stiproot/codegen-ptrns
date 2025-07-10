import { AzureChatOpenAI } from "@langchain/openai";
import {
  StateGraph,
  END,
  START,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { Effect, Console, Exit, Scope, Config, Layer, Context } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import * as Schema from "effect/Schema";
import * as dotenv from "dotenv";

dotenv.config();

const azureOpenAIApiKey = Config.string("AZURE_OPENAI_API_KEY");
const azureOpenAIApiDeploymentName = Config.string("AZURE_OPENAI_API_DEPLOYMENT_NAME");
const azureOpenAIApiVersion = Config.string("AZURE_OPENAI_API_VERSION");

const appConfig = Config.all({
  azureOpenAIApiKey,
  azureOpenAIApiDeploymentName,
  azureOpenAIApiVersion,
});

class MCPClientError extends Schema.TaggedError<MCPClientError>()("MCPClientError", {
  cause: Schema.Unknown,
}) { }

class NoToolsError extends Schema.TaggedError<NoToolsError>()("NoToolsError", {
  message: Schema.String,
}) { }

class MCPClientService extends Effect.Service<MCPClientService>()("MCPClientService", {
  scoped: Effect.acquireRelease(
    Effect.sync(() => new MultiServerMCPClient({
      throwOnLoadError: true,
      prefixToolNameWithServerName: true,
      additionalToolNamePrefix: "mcp",
      useStandardContentBlocks: true,
      mcpServers: {
        weather: {
          transport: "stdio",
          command: process.execPath,
          args: ["../mcp-servers/weather-server-typescript/build/index.js"],
        },
      },
    })),
    (client) => Effect.tryPromise({
      try: () => client.close(),
      catch: () => new MCPClientError({ cause: "Failed to close client" }),
    }).pipe(
      Effect.tap(() => Console.log("Closed all MCP connections")),
      Effect.ignore
    )
  )
}) { }

// Get tools from MCP client using the service
const getTools = Effect.gen(function* () {
  const client = yield* MCPClientService;
  const tools = yield* Effect.tryPromise({
    try: () => client.getTools(),
    catch: (error) => new MCPClientError({ cause: error }),
  });

  if (tools.length === 0) {
    yield* Effect.fail(new NoToolsError({ message: "No tools found" }));
  }

  yield* Console.log(
    `Loaded ${tools.length} MCP tools: ${tools
      .map((tool) => tool.name)
      .join(", ")}`
  );

  return tools;
});

// Create Azure OpenAI model
const createModel = (config: Config.Config.Success<typeof appConfig>, tools: any[]) =>
  Effect.try({
    try: () => {
      const model = new AzureChatOpenAI({
        modelName: "gpt-4o",
        azureOpenAIApiKey: config.azureOpenAIApiKey,
        azureOpenAIApiDeploymentName: config.azureOpenAIApiDeploymentName,
        azureOpenAIApiVersion: config.azureOpenAIApiVersion,
        temperature: 0.7,
      }).bindTools(tools);
      return model;
    },
    catch: (error) => new MCPClientError({ cause: error }),
  });

// Create LangGraph workflow
const createWorkflow = (model: any, tools: any[]) =>
  Effect.try({
    try: () => {
      const toolNode = new ToolNode(tools);

      console.log("\n=== CREATING LANGGRAPH AGENT FLOW ===");

      // Define the function that calls the model
      const llmNode = async (state: typeof MessagesAnnotation.State) => {
        console.log("Calling LLM with messages:", state.messages.length);
        const response = await model.invoke(state.messages);
        return { messages: [response] };
      };

      // Create a new graph with MessagesAnnotation
      const workflow = new StateGraph(MessagesAnnotation)
        .addNode("llm", llmNode)
        .addNode("tools", toolNode)
        .addEdge(START, "llm")
        .addEdge("tools", "llm")
        .addConditionalEdges("llm", (state) => {
          const lastMessage = state.messages[state.messages.length - 1];
          const aiMessage = lastMessage as AIMessage;
          if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
            console.log("Tool calls detected, routing to tools node");
            return "tools";
          }
          console.log("No tool calls, ending the workflow");
          return END;
        });

      return workflow.compile();
    },
    catch: (error) => new MCPClientError({ cause: error }),
  });

// Run a single query
const runQuery = (app: any, query: string) =>
  Effect.tryPromise({
    try: async () => {
      console.log(`\nQuery: ${query}`);

      const result = await app.invoke({
        messages: [new HumanMessage(query)],
      });

      console.log(`\nFinal Messages (${result.messages.length}):`);
      result.messages.forEach((msg: BaseMessage, i: number) => {
        const msgType = "type" in msg ? msg.type : "unknown";
        console.log(
          `[${i}] ${msgType}: ${typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content)
          }`
        );
      });

      const finalMessage = result.messages[result.messages.length - 1];
      console.log(`\nResult: ${finalMessage.content}`);

      return result;
    },
    catch: (error) => new MCPClientError({ cause: error }),
  });

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

// Run the program using Effect's built-in runtime with layers
const main = program.pipe(
  Effect.catchAll((error: any) =>
    Console.error(`Error: ${error._tag || 'Unknown'}`, error).pipe(
      Effect.andThen(() => Effect.die(error))
    )
  ),
  Effect.tap(() => Console.log("Example completed successfully")),
  Effect.provide(MCPClientService.Default) // Provide the MCP Client Layer
);

NodeRuntime.runMain(main);