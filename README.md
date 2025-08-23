# Hyperliquid Fibonacci Trading Bot (Node.js Version)

Welcome to the Hyperliquid Fibonacci Trading Bot, a fully automated, modular, and scalable trading system built in Node.js. This bot is designed to trade perpetual futures on the Hyperliquid DEX based on a sophisticated Fibonacci retracement and state machine strategy.

It actively monitors the market, calculates technical indicators, manages risk with dynamic stop-losses, and provides real-time notifications and monitoring tools.

---

## ✨ Features

* **Automated Trading:** Executes long entries based on a defined Fibonacci-based strategy.
* **Stateful Position Management:** On startup, it automatically detects and imports any existing open positions from your Hyperliquid account.
* **Advanced Risk Management:** Implements a multi-stage stop-loss system:
    1.  An initial, fixed **ROE-based stop-loss**.
    2.  A dynamic **Fibonacci-based trailing stop-loss** that activates to protect profits.
    3.  A fixed **ROE-based take-profit**.
* **Live Monitoring:** A powerful, real-time terminal dashboard to monitor your live position, risk parameters (SL/TP prices), technical indicators, and recent events.
* **Data Backfilling:** Includes a utility to pre-load the bot's database with historical price data for robust analysis from the start.
* **Manual Trade Trigger:** A testing tool to manually inject a "buy" signal, allowing you to safely test your trade execution and risk management logic without waiting for market conditions.
* **Discord Notifications:** Sends real-time alerts for critical events like bot startup, signal generation, and trade execution.
* **Modular & Scalable:** Built with a clean, component-based architecture in Node.js, making it easy to understand, maintain, and extend.

---

## 📂 Project Structure

```
/hyperliquid-node-bot
|-- /src
|   |-- /components
|   |   |-- DataCollector.js       # Fetches live price data
|   |   |-- TechnicalAnalyzer.js   # Calculates Fib levels, ATR, etc.
|   |   |-- SignalGenerator.js     # Decides when to buy
|   |   |-- TradeExecutor.js       # Places trades on the exchange
|   |   |-- RiskManager.js         # Manages SL/TP for open positions
|   |   |-- StateManager.js        # Tracks the bot's state (in position?)
|   |   |-- Notifier.js            # Sends Discord alerts
|   |-- /database
|   |   |-- DatabaseManager.js     # Handles all SQLite operations
|   |-- /utils
|   |   |-- logger.js              # For pretty console logs
|   |-- app.js                     # The main application entry point
|-- .env                           # Your secret keys and config
|-- config.js                      # Main configuration for the bot
|-- package.json                   # Project dependencies
|-- historical_prices.json         # (Optional) Your historical data for backfilling
|-- backfill_data.js               # Script to load historical data
|-- clear_prices.js                # Script to clear price data from the DB
|-- monitor_db.js                  # The live monitoring dashboard script
|-- trigger_trade.js               # The manual trade injection script
```

---

## 🚀 Setup and Installation

### 1. Prerequisites

* **Node.js:** Version 18 or higher.
* **npm:** Should be included with your Node.js installation.

### 2. Clone the Repository

Clone this project to your local machine:
```bash
git clone <your-repository-url>
cd hyperliquid-node-bot
```

### 3. Install Dependencies

Install all the necessary packages defined in `package.json`:
```bash
npm install
```

### 4. Configure Your Bot

Create a file named `.env` in the root of the project directory. This is where you will store all your secret keys.

**Copy and paste the following into your `.env` file and fill in your details:**

```
# This private key is for the wallet that has permission to place trades (API Wallet)
HYPERLIQUID_WALLET_PRIVATE_KEY="your_api_wallet_private_key_here"

# This PUBLIC ADDRESS is for the main account that holds the positions
HYPERLIQUID_MAIN_ACCOUNT_ADDRESS="your_main_account_public_address_here"

# Your Discord webhook URL for notifications
DISCORD_WEBHOOK_URL="your_discord_webhook_url_here"
```

You can also adjust the core trading parameters (like trade size, leverage, and stop-loss percentages) in the `config.js` file.

---

## 🛠️ Usage

### 1. Backfill Historical Data (Optional but Recommended)

To ensure the bot's technical analysis is accurate from the very first trade, you can pre-load its database with historical price data.

1.  **Prepare your data:** Create a file named `historical_prices.json` in the project's root directory. The format must be a JSON array of objects, like this:
    ```json
    [
      { "timestamp": "2025-08-23T11:43:01.488Z", "price": 203.015 },
      { "timestamp": "2025-08-23T11:44:02.487Z", "price": 202.975 }
    ]
    ```
2.  **Clear old data (if any):** `node clear_prices.js`
3.  **Run the backfill script:**
    ```bash
    node backfill_data.js
    ```

### 2. Start the Bot

Run the main application from the root directory. It will start collecting data, analyzing the market, and executing trades when the conditions are met.
```bash
node src/app.js
```

### 3. Monitor the Bot in Real-Time

The live monitoring dashboard is the best way to see what your bot is doing. It shows your open position, live risk parameters, technical analysis, and recent events.

**Open a second terminal window**, navigate to the project directory, and run:
```bash
node monitor_db.js
```

### 4. Test with a Manual Trade

You can test your `TradeExecutor` and `RiskManager` without waiting for a real signal.

**Open a third terminal window**, navigate to the project directory, and run:
```bash
# To force a buy signal
node trigger_trade.js buy

# To clear the trigger if you change your mind
node trigger_trade.js clear
```
The bot will detect the trigger on its next cycle, send a Discord alert, and attempt to execute the trade.
