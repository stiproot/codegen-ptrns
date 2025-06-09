import { Effect, Context, Layer, Config, ConfigError } from "effect";
import Alpaca from "@alpacahq/alpaca-trade-api";
import "dotenv/config";

// class Cfg extends Context.Tag("Config")<
//   Cfg,
//   {
//     readonly getConfig: Effect.Effect<
//       {
//         readonly alpacaApiKey: string,
//         readonly alpacaSecretKey: string,
//       },
//       ConfigError.ConfigError,
//       never
//     >
//   }
// >() { }

// const CfgLive = Layer.succeed(
//   Cfg,
//   {
//     getConfig: Effect.gen(function* () {
//       const apiKey = yield* Config.string("ALPACA_API_KEY")
//       const secretKey = yield* Config.string("ALPACA_SECRET_KEY")

//       return {
//         alpacaApiKey: apiKey,
//         alpacaSecretKey: secretKey,
//       }
//     })
//   }
// )

class Logger extends Context.Tag("Logger")<
  Logger,
  { readonly log: (msg: string) => Effect.Effect<void> }
>() { }

const LoggerLive = Layer.effect(
  Logger,
  Effect.gen(function* () {
    return {
      log: (msg: string) =>
        Effect.gen(function* () {

          const apiKey = yield* Config.string("ALPACA_API_KEY").pipe(
            Effect.catchTag("ConfigError", (error) =>
              Effect.dieMessage(`Failed to load configuration: ${error.message}`)
            ))

          const secretKey = yield* Config.string("ALPACA_SECRET_KEY").pipe(
            Effect.catchTag("ConfigError", (error) =>
              Effect.dieMessage(`Failed to load configuration: ${error.message}`)
            ))

          console.log(msg)
          console.log(`(Alpaca API Key: ${apiKey}, Secret Key: ${secretKey})`)
        })
    }
  })
)

class AlpacaClientFactory extends Context.Tag("AlpacaClient")<
  AlpacaClientFactory,
  { readonly createClient: () => Effect.Effect<Alpaca> }
>() { }

// const AlpacaClientFactoryLive = Layer.effect(
//   AlpacaClientFactory,
//   Effect.gen(function* () {
//     const config = yield* Cfg
//     const logger = yield* Logger

//     return {
//       createClient: () =>
//         Effect.gen(function* () {
//           const { alpacaApiKey, alpacaSecretKey } = yield* config.getConfig.pipe(
//             Effect.catchTag("ConfigError", (error) =>
//               Effect.dieMessage(`Failed to load configuration: ${error.message}`)
//             ))

//           yield* logger.log("creating client...")
//           return new Alpaca({
//             keyId: alpacaApiKey,
//             secretKey: alpacaSecretKey,
//             paper: true,
//           })
//         })
//     }
//   })
// )

// const AppCfgLive = Layer.merge(CfgLive, LoggerLive);

// const MainLive = AlpacaClientFactoryLive.pipe(
//   Layer.provideMerge(AppCfgLive),
//   Layer.provide(CfgLive)
// )

// const program = Effect.gen(function* () {
//   const factory = yield* AlpacaClientFactory;
//   const logger = yield* Logger

//   const client = yield* factory.createClient()

//   yield* logger.log(`building client from program. Client type: ${typeof client}`)

//   return client;
// })

// const runnable = Effect.provide(program, MainLive)

// Effect.runPromise(runnable).then(() => console.log('done!'))