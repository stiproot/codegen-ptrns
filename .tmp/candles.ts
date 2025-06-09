import { createClient } from "./utls";

const SYMBOL = "NVDA";
const START_DATE = "2025-06-06";
const END_DATE = "2025-06-07";

const alpaca = createClient();

async function getBars() {

  const bars: AsyncGenerator = alpaca.getBarsV2(SYMBOL, {
    start: START_DATE,
    end: END_DATE,
    timeframe: alpaca.newTimeframe(5, alpaca.timeframeUnit.MIN),
    limit: 2,
  });

  const got = [];

  for await (let b of bars) {
    got.push(b);
  }

  console.log(got);
}

(async () => await getBars())();
