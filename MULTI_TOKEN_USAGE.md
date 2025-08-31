# Multi-Token Trading Bot Usage

## 🚀 Quick Start

### 1. Start Multi-Token System
```bash
npm run start:multi
```
This starts all enabled tokens (AVAX, SOL, DOGE by default).

### 2. Start Multi-Token Discord Bot
```bash
npm run start:discord-multi
```
This starts the Discord bot that can control all tokens.

## 🎯 Available Tokens

**Currently Enabled:**
- **AVAX** - Avalanche (aggressive settings)
- **SOL** - Solana (balanced aggressive) 
- **DOGE** - Dogecoin (conservative, uptrend-only)

**Available to Enable:**
- **LTC** - Litecoin
- **ADA** - Cardano  
- **LINK** - Chainlink

## 🤖 Discord Commands

### Basic Control
- `!tokens` - Show all token statuses
- `!status [TOKEN]` - Detailed status for specific token or all
- `!start TOKEN` - Start trading bot for token (owner only)
- `!stop TOKEN` - Stop trading bot for token (owner only)

### Regime Analysis
- `!regime [TOKEN]` - AI regime analysis for token or all tokens
- `!regime-rules` - View regime-based auto-control rules

### Emergency Controls
- `!panic TOKEN` - Emergency stop specific token (owner only)
- `!panic ALL` - Emergency stop all tokens (owner only)

### Token Management
- `!enable TOKEN` - Enable token in config (owner only)
- `!disable TOKEN` - Disable and stop token (owner only)

## 🧠 Regime-Based Auto Control

The system automatically monitors market regimes and will:

### Auto-Disable Tokens When:
- **Strong Downtrend** detected with high confidence (≥8/10)
- **Volatile/Uncertain** markets with high confidence (≥7/10)
- **Emergency conditions** with very high confidence (≥9/10)

### Auto-Enable Tokens When:
- **Strong Uptrend** detected with high confidence (≥7/10)
- Previous disable conditions clear

### Token-Specific Behavior:
- **DOGE**: Only trades during STRONG_UPTREND (most conservative)
- **AVAX/SOL**: Trade during STRONG & WEAK uptrends
- **All others**: Balanced approach with regime-based sizing

## 📁 File Structure

```
├── multi.config.js              # Master configuration
├── multi-launcher.js            # Main launcher
├── discord_bot_multi.js         # Multi-token Discord bot
├── configs/                     # Token-specific configs
│   ├── AVAX.config.js
│   ├── SOL.config.js
│   ├── DOGE.config.js
│   ├── LTC.config.js
│   ├── ADA.config.js
│   └── LINK.config.js
├── data/                        # Token-specific data
│   ├── AVAX/
│   │   ├── AVAX_bot.db
│   │   ├── position.json
│   │   └── live_analysis.json
│   └── [other tokens...]
└── logs/                        # Token-specific logs
    ├── AVAX.log
    └── [other tokens...]
```

## ⚙️ Customization

### Adding New Tokens
1. Add token config to `multi.config.js`
2. Create `configs/TOKEN.config.js`
3. Set enabled: true
4. Restart system

### Adjusting Regime Rules
Edit `regimeRules` section in `multi.config.js`:
- Modify confidence thresholds
- Add new regime-based actions
- Change position size multipliers

### Token-Specific Settings
Each token config can override:
- Position sizes
- Leverage
- Risk management
- Technical analysis periods
- Trade blockers

## 🔧 Environment Variables

Make sure these are set in your `.env` file:
```env
HYPERLIQUID_WALLET_PRIVATE_KEY=your_key
HYPERLIQUID_MAIN_ACCOUNT_ADDRESS=your_address
DISCORD_WEBHOOK_URL=your_webhook
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CHANNEL_ID=your_channel_id
DISCORD_OWNER_ID=your_discord_user_id
CLAUDE_API_KEY=your_claude_key
```

## 📊 Monitoring

### Real-time Monitoring
- Discord notifications for all trade actions
- Regime change alerts
- Auto-enable/disable notifications
- Process crash/restart alerts

### Manual Monitoring  
- `!tokens` for quick overview
- `!status` for detailed info
- `!regime` for market analysis
- Individual token status checks

## 🚨 Safety Features

### Process Isolation
- Each token runs as separate process
- One crash doesn't affect others
- Auto-restart on failure (max 5 attempts)

### Regime Protection
- Auto-disable during bear markets
- Emergency shutdown capability
- Position size reduction in volatile conditions

### Manual Overrides
- Owner-only emergency controls
- Individual token control
- Global panic button

## 🎉 Benefits

✅ **Scale Easily** - Add tokens without touching existing ones  
✅ **Risk Isolation** - Losses in one token don't affect others  
✅ **Smart Automation** - AI decides when to trade each token  
✅ **Fault Tolerant** - System keeps running if one bot fails  
✅ **Regime Aware** - Automatically adapts to market conditions  
✅ **Full Control** - Override everything manually via Discord