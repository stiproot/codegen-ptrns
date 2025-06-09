import { StateGraph, END, START } from "@langchain/langgraph";
import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { VM } from "vm2";
import * as dotenv from "dotenv";

dotenv.config();

// 1. Define the Agent State
interface AgentState {
  messages: Array<HumanMessage | AIMessage>;
  generatedCode?: string;
  evaluationResult?: string;
}

// 2. Define the "Generate Code" Node
async function generateCodeNode(state: AgentState): Promise<Partial<AgentState>> {
  const llm = new AzureChatOpenAI({
    modelName: "gpt-4o",
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
    temperature: 0.7,
  });

  const prompt = `You are a helpful AI assistant that writes simple TypeScript code.
The user wants to perform a calculation or a simple task.
Generate TypeScript code that fulfills the user's request.
The code should be a self-contained function named 'execute' that takes no arguments and returns a string or number.
Do NOT include imports, just the function.

Example:
User Request: "Add 5 and 3"
\`\`\`typescript
function execute(): number {
  return 5 + 3;
}
\`\`\`

User Request: "${(state.messages[state.messages.length - 1] as HumanMessage).content}"
\`\`\`typescript
`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  const generatedCode = response.content.toString().match(/```typescript\n([\s\S]*?)```/)?.[1]?.trim();

  if (!generatedCode) {
    console.error("Failed to extract TypeScript code from LLM response.");
    return {
      messages: state.messages.concat(new AIMessage("I couldn't generate valid TypeScript code from your request.")),
    };
  }

  console.log("Generated Code:\n", generatedCode);

  return {
    messages: state.messages.concat(new AIMessage(`I've generated the following TypeScript code:\n\`\`\`typescript\n${generatedCode}\n\`\`\``)),
    generatedCode: generatedCode,
  };
}

// 3. Define the "Evaluate Code" Node
async function evaluateCodeNode(state: AgentState): Promise<Partial<AgentState>> {
  const code = state.generatedCode;
  if (!code) {
    return {
      messages: state.messages.concat(new AIMessage("No code was generated to evaluate.")),
    };
  }

  let result: string;
  try {
    // We create a new VM instance for sandboxed execution
    const vm = new VM({
      timeout: 1000, // Max 1 second for execution
      sandbox: {}, // No global variables accessible by default
    });

    // We'll wrap the user's code to call the 'execute' function
    const wrappedCode = `${code}\n\nmodule.exports = execute();`;
    const vmResult = vm.run(wrappedCode);
    result = `Execution successful. Result: ${JSON.stringify(vmResult)}`;
  } catch (error: any) {
    result = `Code execution failed. Error: ${error.message}`;
  }

  console.log("Evaluation Result:\n", result);

  return {
    messages: state.messages.concat(new AIMessage(`Code Evaluation Result:\n${result}`)),
    evaluationResult: result,
  };
}

// 4. Define the Graph
export const workflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      value: (x: (HumanMessage | AIMessage)[], y: (HumanMessage | AIMessage)[]) => x.concat(y),
      default: () => [],
    },
    generatedCode: {
      value: (x?: string, y?: string) => y ?? x,
      default: () => undefined,
    },
    evaluationResult: {
      value: (x?: string, y?: string) => y ?? x,
      default: () => undefined,
    },
  },
})
  .addNode("generate_code", generateCodeNode)
  .addNode("evaluate_code", evaluateCodeNode)
  .addEdge("generate_code", "evaluate_code")
  .addEdge("evaluate_code", END) // End the workflow after evaluation
  .addEdge(START, "generate_code"); // Start from the code generation node

// Compile the graph
export const app = workflow.compile();

// Example Usage (can be in a separate file like `app.ts` or directly here)
async function runWorkflow(prompt: string) {
  console.log(`Running workflow for prompt: "${prompt}"`);
  const finalState = await app.invoke({
    messages: [new HumanMessage(prompt)],
  });
  console.log("Final State:", finalState.messages.map((msg: any) => msg.content).join("\n"));
}

// Run some examples
(async () => {
  await runWorkflow("Write a TypeScript function that calculates the factorial of 5.");
  // console.log("\n--- Next Workflow ---\n");
  // await runWorkflow("Create a function that returns the string 'Hello, LangGraph!'");
  // console.log("\n--- Next Workflow ---\n");
  // await runWorkflow("What is 10 divided by 2?"); // This will generate a simple arithmetic operation
})();