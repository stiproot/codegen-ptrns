import { Config } from "effect";
import * as dotenv from "dotenv";

dotenv.config();

const azureOpenAIApiKey = Config.string("AZURE_OPENAI_API_KEY");
const azureOpenAIApiDeploymentName = Config.string("AZURE_OPENAI_API_DEPLOYMENT_NAME");
const azureOpenAIApiVersion = Config.string("AZURE_OPENAI_API_VERSION");

export const appConfig = Config.all({
  azureOpenAIApiKey,
  azureOpenAIApiDeploymentName,
  azureOpenAIApiVersion,
});