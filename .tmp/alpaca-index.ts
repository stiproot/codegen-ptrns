import Alpaca from "@alpacahq/alpaca-trade-api";

import { createClient } from "./utls";
import { buyNVIDIAGetQuoteAndOrder } from "./nvidia";

const client: Alpaca = createClient();

buyNVIDIAGetQuoteAndOrder(client, 2).then(() => {
  console.log("NVIDIA purchase process completed.");
}).catch((error) => {
  console.error("An error occurred during the NVIDIA purchase process:", error);
});

