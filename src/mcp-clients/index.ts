import { Effect, Layer, Context, Config, Console, } from "effect";
import { StateGraph, END, START, } from "@langchain/langgraph";
import { AzureChatOpenAI, AzureOpenAI, ChatOpenAI, } from "@langchain/openai";
import { HumanMessage, AIMessage, } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { VM } from "vm2";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import "dotenv/config";

async function main() {

  // Create client and connect to server
  const client = new MultiServerMCPClient({
    // Global tool configuration options
    // Whether to throw on errors if a tool fails to load (optional, default: true)
    throwOnLoadError: true,
    // Whether to prefix tool names with the server name (optional, default: true)
    prefixToolNameWithServerName: true,
    // Optional additional prefix for tool names (optional, default: "mcp")
    additionalToolNamePrefix: "mcp",

    // Use standardized content block format in tool outputs
    useStandardContentBlocks: true,

    // Server configuration
    mcpServers: {
      weather: {
        transport: "stdio",
        command: process.execPath,
        args: ["../mcp-servers/weather-server-typescript/build/index.js"],
      },
    },
  });

  const tools = await client.getTools();

  const apiKey: string = process.env.AZURE_OPENAI_API_KEY!;
  const apiDeploymentName: string = process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME!;
  const apiVersion: string = process.env.AZURE_OPENAI_API_VERSION!;

  // Create an OpenAI model
  const model = new AzureChatOpenAI({
    modelName: "gpt-4o",
    azureOpenAIApiKey: apiKey,
    azureOpenAIApiDeploymentName: apiDeploymentName,
    azureOpenAIApiVersion: apiVersion,
    temperature: 0.7,
  });

  // Create the React agent
  const agent = createReactAgent({
    llm: model,
    tools,
  });

  // Run the agent
  try {
    const weatherResponse = await agent.invoke({
      messages: [{ role: "user", content: "What is the weather doing in Los Angeles today?" }],
    });
    console.log(weatherResponse);
  } catch (error: any) {
    console.error("Error during agent execution:", error);
    // Tools throw ToolException for tool-specific errors
    if (error.name === "ToolException") {
      console.error("Tool execution failed:", error.message);
    }
  }

  await client.close();
}

main().catch((error) => {
  console.error("Error in main function:", error);
  process.exit(1);
});