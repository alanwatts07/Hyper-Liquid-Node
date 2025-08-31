# HyperLiquid Trading Bot

A sophisticated automated cryptocurrency trading bot designed for HyperLiquid exchange, implementing advanced technical analysis and risk management strategies.

## 🚀 Features

- **Automated Trading**: Execute buy/sell orders based on technical analysis signals
- **Multi-Timeframe Analysis**: Combines 5-minute and 4-hour Stochastic RSI analysis
- **Fibonacci-Based Entry Strategy**: Uses Fibonacci retracement levels for optimal entry points
- **Advanced Risk Management**: Configurable stop-loss and take-profit levels with dynamic position monitoring
- **Discord Notifications**: Real-time alerts for trades, signals, and bot status
- **Database Logging**: Comprehensive trade history and event logging
- **Manual Override System**: Emergency controls via file-based commands
- **Configurable Trade Blockers**: Multiple safety mechanisms to prevent poor entries

## 📁 Project Structure

```
src/
├── app.js                 # Main bot application and orchestration
├── config.js             # Configuration settings and parameters
├── components/           # Core trading components
│   ├── DataCollector.js  # Real-time price data collection
│   ├── TechnicalAnalyzer.js # Technical analysis calculations
│   ├── SignalGenerator.js   # Trading signal logic
│   ├── TradeExecutor.js     # Order execution and management
│   ├── RiskManager.js       # Risk assessment and position monitoring
│   ├── StateManager.js      # Bot state management
│   └── Notifier.js         # Discord notification system
├── database/             # Database management
│   ├── DatabaseManager.js # SQLite database operations
│   └── schema.js          # Database schema definitions
└── utils/               # Utility modules
    ├── ChartGenerator.js # Chart generation utilities
    ├── DatabaseStreamer.js # Database streaming utilities
    ├── helpers.js        # General helper functions
    └── logger.js         # Logging system
```

## ⚙️ Configuration

### Environment Variables
Create a `.env` file in the project root with:

```env
HYPERLIQUID_WALLET_PRIVATE_KEY=your_private_key_here
HYPERLIQUID_MAIN_ACCOUNT_ADDRESS=your_wallet_address_here
DISCORD_WEBHOOK_URL=your_discord_webhook_url_here
```

### Trading Configuration
Key settings in `config.js`:

```javascript
trading: {
    asset: "SOL",              # Asset to trade
    tradeUsdSize: 625,         # Trade size in USD
    leverage: 20,              # Trading leverage
    slippage: 0.01,            # Slippage tolerance
    cooldownMinutes: 10,       # Cooldown between trades
    tradeBlockers: {           # Safety mechanisms
        blockOn4hrStoch: true,     # Block if 4hr Stoch RSI overbought
        blockOn5minStoch: true,    # Block if 5min Stoch RSI overbought  
        blockOnPriceTrend: false   # Block on bearish trend (with oversold exception)
    }
}
```

## 🔧 Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hyper_node
   ```

2. **Install dependencies**
   ```bash
   npm install @nktkas/hyperliquid ethers dotenv luxon
   ```

3. **Configure environment variables**
   - Copy `.env.example` to `.env`
   - Add your HyperLiquid wallet private key
   - Add your Discord webhook URL (optional)

4. **Run the bot**
   ```bash
   node src/app.js
   ```

## 📈 Trading Strategy

### Entry Strategy
1. **Fibonacci Setup**: Calculates fibonacci retracement levels using highest/lowest prices over a lookback period
2. **Trigger Arming**: Price must first drop below the entry level to arm the trigger
3. **Entry Signal**: Triggered when price bounces back above the EMA-smoothed fibonacci 0% level
4. **Multi-Timeframe Confirmation**: Incorporates 4-hour trend and stochastic analysis

### Trade Blockers (Safety Mechanisms)
- **4-Hour Stoch Filter**: Prevents entries when 4hr Stochastic RSI is overbought (>80)
- **5-Minute Stoch Filter**: Blocks entries when 5min Stochastic RSI is overbought at entry point
- **Trend Filter**: Optional blocking on bearish 4hr trends (with oversold exception for reversal plays)

### Exit Strategy
- **Take Profit**: Configurable percentage-based profit taking
- **Stop Loss**: Configurable percentage-based loss protection
- **Dynamic Risk Management**: Adjusts levels based on market conditions

## 🛡️ Risk Management

- **Position Sizing**: Fixed USD amount per trade
- **Leverage Control**: Configurable leverage settings
- **Cooldown Periods**: Prevents overtrading
- **Emergency Controls**: Manual override capabilities
- **Real-time Monitoring**: Continuous position tracking

## 📊 Monitoring & Controls

### Live Files
- `live_analysis.json`: Real-time technical analysis data
- `live_risk.json`: Current position and risk metrics
- `position.json`: Active position details

### Manual Override Commands
- `manual_override.json`: Force a buy signal
- `manual_close.json`: Emergency position close

### Example override file:
```json
{
    "signal": "buy"
}
```

## 🔔 Notifications

The bot sends Discord notifications for:
- Bot startup/shutdown events
- Trade execution confirmations
- Signal generation alerts
- Risk management triggers
- Manual override activations

## 🗃️ Database

Uses SQLite for:
- Historical price data storage
- Trade execution logs
- Bot event tracking
- Performance analytics

## ⚠️ Important Notes

### Security
- Never commit your `.env` file containing private keys
- Use a dedicated trading wallet with limited funds
- Test thoroughly on testnet before live trading

### Risk Warning
- Cryptocurrency trading involves substantial risk
- This bot is for educational/experimental purposes
- Only trade with funds you can afford to lose
- Past performance doesn't guarantee future results

### Dependencies
- Node.js (v14+ recommended)
- SQLite database
- Active internet connection
- HyperLiquid exchange account

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is provided as-is for educational purposes. Use at your own risk.

---

**Disclaimer**: This software is provided for educational purposes only. Trading cryptocurrencies involves substantial risk and may not be suitable for all investors. The authors and contributors are not responsible for any financial losses incurred through the use of this software.
