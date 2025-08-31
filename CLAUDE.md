# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a sophisticated automated cryptocurrency trading bot for HyperLiquid exchange. The bot implements Fibonacci-based entry strategies combined with multi-timeframe Stochastic RSI analysis and comprehensive risk management.

**Core Architecture:**
- **Main App** (`src/app.js`): Orchestrates all components, handles data processing and position management
- **Components** (`src/components/`): Modular trading system with clear separation of concerns
- **Database** (`src/database/`): SQLite-based data persistence and logging
- **Utilities** (`src/utils/`): Helper functions, logging, and chart generation
- **Root Scripts**: Standalone maintenance and utility scripts

## Common Development Commands

### Running the Bot
```bash
npm start                    # Start the main trading bot
node src/app.js             # Alternative way to start the bot
```

### Database Operations
```bash
node monitor_db.js          # Monitor real-time database events
node clean_trades.js        # Clean up trade history
node clear_prices.js        # Clear price data
node backfill_data.js       # Backfill historical data
node dump_events.js         # Export event logs
```

### Position Management
```bash
node pos_check.js           # Check current positions
node trigger_trade.js       # Manually trigger a trade for testing
```

### Discord Bot
```bash
node discord_bot.js         # Start Discord bot for remote control
```

### Data Maintenance
```bash
node clean_tick.js          # Clean up tick data
```

## Key Architecture Components

### Core Data Flow
1. **DataCollector** fetches real-time price data from HyperLiquid
2. **TechnicalAnalyzer** calculates indicators (Fibonacci levels, Stochastic RSI, moving averages)
3. **SignalGenerator** evaluates entry conditions with configurable trade blockers
4. **TradeExecutor** handles order placement and position management
5. **RiskManager** monitors positions and triggers exits based on stop-loss/take-profit
6. **StateManager** tracks bot state and position status
7. **DatabaseManager** persists all data and events

### Trading Strategy Logic
- **Fibonacci Entry**: Uses 42-period lookback to calculate Fibonacci retracement levels
- **Trigger Arming**: Price must drop below entry level first, then bounce above EMA-smoothed Fib 0% level
- **Multi-timeframe Analysis**: Combines 5-minute and 4-hour Stochastic RSI analysis
- **Trade Blockers**: Configurable safety mechanisms in `config.js` to prevent poor entries

### Configuration System
All trading parameters are centralized in `src/config.js`:
- Trading parameters (asset, size, leverage, cooldown)
- Risk management settings (stop-loss, take-profit percentages)
- Technical analysis periods and thresholds
- Trade blocker switches for different entry conditions

### State Management
The bot maintains state through several files:
- `position.json`: Current active position details
- `live_analysis.json`: Real-time technical analysis data
- `live_risk.json`: Current risk metrics and position monitoring
- `manual_override.json`: Manual buy signal trigger
- `manual_close.json`: Manual position close trigger

### Database Schema
SQLite database with tables for:
- `price_data`: OHLCV price history
- `trades`: Executed trade records
- `events`: Bot event logs and analysis history

### Discord Integration
The Discord bot (`discord_bot.js`) provides remote monitoring and control:
- Real-time notifications for trades and signals
- Commands for position checking, strategy analysis, and emergency controls
- **Owner-only `!buy` command**: Executes manual buy orders that the main bot recognizes as its own
- Chart generation and screenshot capabilities
- AI-powered strategy analysis using Claude/Gemini APIs

#### Discord Bot Commands
- `!status` - Instant status report
- `!monitor` - Comprehensive live monitoring dashboard
- `!panic` - Emergency position close
- `!buy` - **Owner-only** manual buy command using current bot settings
- `!logs [count]` - Recent bot events
- `!strategy` - Current trading strategy analysis
- `!config` - Bot configuration display
- `!chart` - Generate live price chart
- `!ask [question]` - AI-powered bot consultation

## Development Notes

### Environment Setup
Required environment variables:
```env
HYPERLIQUID_WALLET_PRIVATE_KEY=your_private_key
HYPERLIQUID_MAIN_ACCOUNT_ADDRESS=your_wallet_address
DISCORD_WEBHOOK_URL=your_webhook_url
DISCORD_BOT_TOKEN=your_bot_token (for Discord bot)
DISCORD_CHANNEL_ID=your_channel_id (for Discord bot)
DISCORD_OWNER_ID=your_discord_user_id (for owner-only commands like !buy)
CLAUDE_API_KEY=your_claude_key (optional, for AI features)
```

### Code Patterns
- Uses ES6 modules (`import/export`)
- Event-driven architecture with EventEmitter for data flow
- Async/await throughout for database and API operations
- Centralized logging via `src/utils/logger.js`
- File-based manual controls for testing and emergency situations

### Risk Management Philosophy
The bot implements multiple layers of safety:
- Configurable trade blockers to prevent entries during unfavorable conditions
- Dynamic stop-loss and take-profit management
- Position monitoring with automatic cleanup of stale state
- Emergency manual override capabilities
- Comprehensive logging and audit trails

### Testing and Debug Features
- Manual override files for triggering specific actions
- Debug configuration options for enhanced logging
- Standalone utility scripts for testing individual components
- Discord commands for real-time strategy analysis and position monitoring