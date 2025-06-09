import { StateGraph, END, START } from "@langchain/langgraph";
import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config(); // Load environment variables

// --- 1. Define the Agent State ---
interface AgentState {
  messages: Array<HumanMessage | AIMessage | ToolMessage>;
  stockSymbol?: string;
  analysisResult?: StockAnalysis;
  tradeExecuted?: boolean;
  alpacaError?: string;
}

// --- 2. Define Structured Output Schema for Stock Analysis ---
const StockAnalysisSchema = z.object({
  symbol: z.string().describe("The stock symbol being analyzed (e.g., TSLA, AAPL)."),
  sentiment: z.enum(["positive", "negative", "neutral"]).describe("Overall market sentiment for the stock."),
  reasoning: z.string().describe("Brief explanation for the sentiment and recommendation."),
  recommendation: z.enum(["BUY", "SELL", "HOLD"]).describe("The trading recommendation based on the analysis."),
  targetPrice: z.number().optional().describe("An optional target price for the recommendation, if applicable."),
});

type StockAnalysis = z.infer<typeof StockAnalysisSchema>;

// --- 3. Define the Alpaca Trading Client (Simulated) ---
// In a real application, you'd use a library like `@alpacahq/typescript-sdk`
// For this example, we'll simulate the client behavior.
class SimulatedAlpacaClient {
  private apiKey: string;
  private secretKey: string;
  private paperTrading: boolean;

  constructor(apiKey: string, secretKey: string, paperTrading: boolean) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.paperTrading = paperTrading;
    console.log(`Simulated Alpaca Client initialized. Paper trading: ${this.paperTrading}`);
  }

  async placeOrder(symbol: string, qty: number, side: "buy" | "sell", type: "market" | "limit", timeInForce: "day" | "gtc"): Promise<any> {
    console.log(`Simulating order placement for ${symbol}: ${side} ${qty} shares (type: ${type}, TIF: ${timeInForce})`);
    if (this.paperTrading) {
      // Simulate success for paper trading
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
      const orderId = `sim_order_${Math.random().toString(36).substring(2, 10)}`;
      return {
        id: orderId,
        symbol: symbol,
        qty: qty,
        side: side,
        type: type,
        time_in_force: timeInForce,
        status: "accepted",
        message: `Simulated order ${orderId} placed successfully in paper account.`,
      };
    } else {
      // In a real scenario, this would call the actual Alpaca API
      // For demonstration, we'll just throw an error if not paper trading
      throw new Error("Live trading not implemented in this simulation.");
    }
  }

  async getAccount(): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 200));
    return {
      buying_power: 100000,
      cash: 100000,
      portfolio_value: 100000,
      account_status: "ACTIVE",
    };
  }

  // Add more simulated Alpaca methods as needed
}

// Initialize the simulated Alpaca client
const alpacaClient = new SimulatedAlpacaClient(
  process.env.ALPACA_API_KEY_ID || "dummy_key",
  process.env.ALPACA_SECRET_KEY || "dummy_secret",
  process.env.ALPACA_PAPER_TRADING === "true"
);

// Define the LangChain Tool for placing orders
const alpacaBuyStockTool = tool(
  async ({ symbol, qty }: { symbol: string; qty: number }) => {
    try {
      const order = await alpacaClient.placeOrder(symbol, qty, "buy", "market", "day");
      return `Successfully placed a BUY order for ${qty} shares of ${symbol}. Order ID: ${order.id}. Status: ${order.status}. Message: ${order.message}`;
    } catch (error: any) {
      return `Failed to place BUY order for ${symbol}: ${error.message}`;
    }
  },
  {
    name: "alpaca_buy_stock",
    description: "Places a market buy order for a specified stock symbol with a given quantity. Use this tool only when the AI has confidently decided to BUY a stock.",
    schema: z.object({
      symbol: z.string().describe("The ticker symbol of the stock to buy (e.g., AAPL, GOOGL)."),
      qty: z.number().int().positive().describe("The number of shares to buy. Must be a positive integer."),
    }),
  }
);

// --- 4. Define Nodes for the LangGraph Workflow ---

// Node 1: Analyze Stock and Decide
async function analyzeAndDecideNode(state: AgentState): Promise<Partial<AgentState>> {
  const llm = new AzureChatOpenAI({
    modelName: "gpt-4o",
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
    temperature: 0.1,
  });

  // Bind the structured output schema to the LLM
  const llmWithStructuredOutput = llm.withStructuredOutput(StockAnalysisSchema);

  const lastUserMessage = (state.messages[state.messages.length - 1] as HumanMessage).content;
  const prompt = `Analyze the current market sentiment and provide a trading recommendation for the following stock.
  Focus on recent news, general market conditions, and potential future movements.
  Provide a concise reasoning for your sentiment and recommendation.

  Stock to analyze: "${lastUserMessage}"`;

  console.log(`\n--- Analyzing: "${lastUserMessage}" ---`);

  let analysis: StockAnalysis;
  try {
    const response = await llmWithStructuredOutput.invoke([new HumanMessage(prompt)]);
    analysis = response as StockAnalysis; // LangChain handles parsing to schema
    console.log("Structured Analysis from LLM:", analysis);
  } catch (error: any) {
    console.error("Failed to get structured analysis from LLM:", error);
    return {
      messages: state.messages.concat(new AIMessage(`Error in analysis: ${error.message}`)),
      analysisResult: undefined,
    };
  }

  // Update state with analysis and an AIMessage
  return {
    messages: state.messages.concat(
      new AIMessage(
        `Based on my analysis for ${analysis.symbol}:\n` +
        `Sentiment: ${analysis.sentiment}\n` +
        `Recommendation: ${analysis.recommendation}\n` +
        `Reasoning: ${analysis.reasoning}\n` +
        (analysis.targetPrice ? `Target Price: $${analysis.targetPrice}\n` : "") +
        `Proceeding to make a trading decision.`
      )
    ),
    stockSymbol: analysis.symbol,
    analysisResult: analysis,
  };
}

// Node 2: Route based on Decision
function routeDecision(state: AgentState): "execute_trade" | "end" {
  const analysis = state.analysisResult;

  if (!analysis) {
    console.warn("No analysis result to make a decision. Ending.");
    return "end";
  }

  if (analysis.recommendation === "BUY") {
    console.log(`Recommendation is BUY for ${analysis.symbol}. Routing to execute_trade.`);
    return "execute_trade";
  } else {
    console.log(`Recommendation is ${analysis.recommendation} for ${analysis.symbol}. Ending workflow.`);
    return "end";
  }
}

// Node 3: Execute Trade (Tool Invocation)
async function executeTradeNode(state: AgentState): Promise<Partial<AgentState>> {
  const analysis = state.analysisResult;
  const symbol = state.stockSymbol;

  if (!analysis || analysis.recommendation !== "BUY" || !symbol) {
    console.error("Trade execution node reached without a BUY recommendation or symbol.");
    return {
      messages: state.messages.concat(new AIMessage("Internal error: Trade execution requested without a BUY recommendation.")),
      alpacaError: "Internal error: No BUY recommendation.",
    };
  }

  // Determine quantity to buy (simple example: always 1 share for demonstration)
  const qtyToBuy = 1;

  console.log(`\n--- Attempting to execute BUY order for ${qtyToBuy} shares of ${symbol} ---`);

  let toolResult: string;
  try {
    // Invoke the Alpaca tool
    toolResult = await alpacaBuyStockTool.invoke({ symbol, qty: qtyToBuy });
    console.log("Alpaca Tool Invocation Result:", toolResult);
  } catch (error: any) {
    console.error("Error invoking Alpaca tool:", error);
    toolResult = `An error occurred while invoking the trading tool: ${error.message}`;
  }

  // Update state with tool execution result
  return {
    messages: state.messages.concat(new ToolMessage({ content: toolResult, tool_call_id: "alpaca_buy_stock_call_1" })), // ToolMessage for tool output
    tradeExecuted: toolResult.includes("Successfully placed"),
    alpacaError: toolResult.includes("Failed") ? toolResult : undefined,
  };
}

// --- 5. Define the LangGraph Workflow ---
export const tradeWorkflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      value: (x: (HumanMessage | AIMessage | ToolMessage)[], y: (HumanMessage | AIMessage | ToolMessage)[]) => x.concat(y),
      default: () => [],
    },
    stockSymbol: {
      value: (x?: string, y?: string) => y ?? x,
      default: () => undefined,
    },
    analysisResult: {
      value: (x?: StockAnalysis, y?: StockAnalysis) => y ?? x,
      default: () => undefined,
    },
    tradeExecuted: {
      value: (x?: boolean, y?: boolean) => y ?? x,
      default: () => undefined,
    },
    alpacaError: {
      value: (x?: string, y?: string) => y ?? x,
      default: () => undefined,
    },
  },
})
  .addNode("analyze_and_decide", analyzeAndDecideNode)
  .addNode("execute_trade", executeTradeNode)
  .addEdge("execute_trade", END) // After executing trade, end the workflow
  .addConditionalEdges(
    "analyze_and_decide", // From this node
    routeDecision, // Use this function to decide next step
    {
      execute_trade: "execute_trade", // If routeDecision returns "execute_trade", go to "execute_trade" node
      end: END, // If routeDecision returns "end", end the workflow
    }
  )
  .addEdge(START, "analyze_and_decide"); // Start from the analysis node

// Compile the graph
export const tradeApp = tradeWorkflow.compile();

// --- Example Usage ---
async function runTradeWorkflow(stockPrompt: string) {
  console.log(`\n### Initiating trade workflow for: "${stockPrompt}" ###`);
  const finalState = await tradeApp.invoke({
    messages: [new HumanMessage(stockPrompt)],
  });

  console.log("\n### Workflow Completed ###");
  console.log("Final Messages:");
  for (const message of finalState.messages) {
    if (message._getType() === "human") {
      console.log(`Human: ${message.content}`);
    } else if (message._getType() === "ai") {
      console.log(`AI: ${message.content}`);
    } else if (message._getType() === "tool") {
      console.log(`Tool: ${message.content}`);
    }
  }
  console.log("Trade Executed:", finalState.tradeExecuted);
  if (finalState.alpacaError) {
    console.error("Alpaca Error:", finalState.alpacaError);
  }
}

// Run some examples
(async () => {
  // Scenario 1: LLM recommends BUY
  await runTradeWorkflow("Analyze Tesla stock (TSLA) for potential buy. Consider recent news and future outlook.");

  console.log("\n=====================================\n");

  // Scenario 2: LLM recommends HOLD
  await runTradeWorkflow("Should I buy or hold Apple (AAPL)? Look at its recent performance and market stability.");

  console.log("\n=====================================\n");

  // Scenario 3: LLM recommends SELL (should also end)
  await runTradeWorkflow("What about Netflix (NFLX)? Is it a good time to sell?");
})();