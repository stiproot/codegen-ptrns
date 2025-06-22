import { AiLanguageModel, AiTool, AiToolkit } from "@effect/ai"
import { OpenAiLanguageModel, OpenAiClient } from "@effect/ai-openai"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse
} from "@effect/platform"
import { NodeHttpClient } from "@effect/platform-node"
import { Array, Config, Console, Effect, Layer, Schema } from "effect"

class DadJoke extends Schema.Class<DadJoke>("DadJoke")({
  id: Schema.String,
  joke: Schema.String
}) { }

class SearchResponse extends Schema.Class<SearchResponse>("SearchResponse")({
  results: Schema.Array(DadJoke)
}) { }

class ICanHazDadJoke extends Effect.Service<ICanHazDadJoke>()("ICanHazDadJoke", {
  dependencies: [NodeHttpClient.layerUndici],
  effect: Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient
    const httpClientOk = httpClient.pipe(
      HttpClient.filterStatusOk,
      HttpClient.mapRequest(HttpClientRequest.prependUrl("https://icanhazdadjoke.com"))
    )

    const search = Effect.fn("ICanHazDadJoke.search")(
      function* (searchTerm: string) {
        return yield* httpClientOk.get("/search", {
          acceptJson: true,
          urlParams: { searchTerm }
        }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
          Effect.flatMap(({ results }) => Array.head(results)),
          Effect.map((joke) => joke.joke),
          Effect.scoped,
          Effect.orDie
        )
      }
    )

    return {
      search
    } as const
  })
}) { }

class DadJokeTools extends AiToolkit.make(
  AiTool.make("GetDadJoke", {
    description: "Get a hilarious dad joke from the ICanHazDadJoke API",
    success: Schema.String,
    failure: Schema.Never,
    parameters: {
      searchTerm: Schema.String.annotations({
        description: "The search term to use to find dad jokes"
      })
    }
  })
) { }

const DadJokeToolHandlers = DadJokeTools.toLayer(
  Effect.gen(function* () {
    const icanhazdadjoke = yield* ICanHazDadJoke
    return {
      GetDadJoke: ({ searchTerm }) => icanhazdadjoke.search(searchTerm)
    }
  })
).pipe(Layer.provide(ICanHazDadJoke.Default))

const program = AiLanguageModel.generateText({
  prompt: "Generate a dad joke about pirates",
  toolkit: DadJokeTools
}).pipe(
  Effect.flatMap((response) => Console.log(response.text)),
  Effect.provide(OpenAiLanguageModel.model("gpt-4o"))
)

const OpenAi = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY")
}).pipe(Layer.provide(NodeHttpClient.layerUndici))

program.pipe(
  Effect.provide([OpenAi, DadJokeToolHandlers]),
  Effect.runPromise
)