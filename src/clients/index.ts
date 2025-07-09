import { Effect, Layer, Context, Config, Console, } from "effect";
import { StateGraph, END, START, } from "@langchain/langgraph";
import { AzureChatOpenAI, AzureOpenAI, ChatOpenAI, } from "@langchain/openai";
import { HumanMessage, AIMessage, } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { VM } from "vm2";

import "dotenv/config";


export interface IConfigProvider {
  provide<T>(name: string): Effect.Effect<T>,
}

export class ConfigProvider extends Context.Tag("ConfigProvider")<ConfigProvider, IConfigProvider>() { }

export const ConfigProviderLive = Layer.effect(
  ConfigProvider,
  Effect.gen(function* () {
    return {
      provide: <T>(name: string) => Effect.gen(function* () {
        const val = yield* Config.string(name).pipe(
          Effect.catchTag("ConfigError", (error) =>
            Effect.dieMessage(`Failed to load configuration: ${error.message}`)
          ))
        return val as T
      })
    } as IConfigProvider
  }),
)

export interface ILlmModelFactory {
  create(): Effect.Effect<AzureChatOpenAI>,
}

export class LlmModelFactory extends Context.Tag("LlmModelFactory")<LlmModelFactory, ILlmModelFactory>() { }

export const LlmModelFactoryLive = Layer.effect(
  LlmModelFactory,
  Effect.gen(function* () {
    return {
      create: () => Effect.gen(function* () {

        const provider = yield* ConfigProvider

        const apiKey: string = yield* provider.provide<string>("AZURE_OPENAI_API_KEY")
        // const apiInstanceName: string = yield* provider.provide<string>("AZURE_OPENAI_API_INSTANCE_NAME")
        const apiDeploymentName: string = yield* provider.provide<string>("AZURE_OPENAI_API_DEPLOYMENT_NAME")
        const apiVersion: string = yield* provider.provide<string>("AZURE_OPENAI_API_VERSION")

        return new AzureChatOpenAI({
          modelName: "gpt-4o",
          azureOpenAIApiKey: apiKey,
          // azureOpenAIApiInstanceName: apiInstanceName,
          azureOpenAIApiDeploymentName: apiDeploymentName,
          azureOpenAIApiVersion: apiVersion,
          temperature: 0.7,
        })
      })
    } as ILlmModelFactory
  })
)

export const program = Effect.gen(function* () {
  const llmFactory = yield* LlmModelFactory
  const model = yield* llmFactory.create()
  yield* Console.log(model);
})

const layers = Layer.merge(LlmModelFactoryLive, ConfigProviderLive)

Effect.runPromise(Effect.provide(program, layers)).then(console.log)