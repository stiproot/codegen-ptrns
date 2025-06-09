require('dotenv').config();

import Alpaca from "@alpacahq/alpaca-trade-api";

export const createClient = (): Alpaca => new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true,
});
