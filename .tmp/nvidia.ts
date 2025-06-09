import Alpaca from "@alpacahq/alpaca-trade-api";

export async function buyNVIDIAGetQuoteAndOrder(
  client: Alpaca,
  quantity = 1
) {
  const symbol = 'NVDA'; // NVIDIA's ticker symbol

  try {
    // 1. Get current market data (optional, but good practice for price awareness)
    // You might want to get a quote to understand the current price before placing a market order.
    // For market orders, the price is not explicitly set, but it's good to know.
    console.log(`Fetching latest quote for ${symbol}...`);
    const quote: any = await client.getLatestQuote(symbol);
    console.log(`Latest bid price for ${symbol}: $${quote.bidprice}`);
    console.log(`Latest ask price for ${symbol}: $${quote.askprice}`);
    console.log(`Mid price for ${symbol}: $${(quote.bidprice + quote.askprice) / 2}`);


    // 2. Check if the market is open (important for live trading, good for paper too)
    console.log("Checking market status...");
    const clock = await client.getClock();
    if (!clock.is_open) {
      console.warn("Market is currently closed. Order might be queued or rejected.");
      // For market orders, if the market is closed, it might be queued for the next open.
      // For live trading, you might want to adjust your order type (e.g., OPG for open)
    } else {
      console.log(`Market is open. Current time: ${clock.timestamp}`);
    }

    // 3. Place a Market Order to buy NVIDIA stock
    console.log(`Attempting to place a market order to buy ${quantity} share(s) of ${symbol}...`);
    const order = await client.createOrder({
      symbol: symbol,
      qty: quantity,
      side: 'buy',
      type: 'market',
      time_in_force: 'day', // 'day': order expires at the end of the trading day if not filled
      // You can add a client_order_id for your own tracking:
      // client_order_id: `my-nvda-buy-order-${Date.now()}`
    });

    console.log("Order submitted successfully:");
    console.log(order);

    // You can also retrieve the order details later using its ID:
    // const retrievedOrder = await alpaca.getOrder(order.id);
    // console.log("Retrieved order details:", retrievedOrder);

  } catch (error: any) {
    console.error("Error purchasing NVIDIA stock:", error);
    // Alpaca API errors usually have an 'error' property on the error object
    if (error.error) {
      console.error("Alpaca Error Message:", error.error);
    }
  }
}