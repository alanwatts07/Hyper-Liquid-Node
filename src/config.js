// src/config.js
import 'dotenv/config';

const config = {
    // --- General Settings ---
    debug: {
        enabled: true,
        logTickAnalysis: false,
    },

    // --- Trading Parameters ---
    trading: {
        asset: "SOL",
        tradeUsdSize: 625,
        leverage: 20,
        slippage: 0.01,
        cooldownMinutes: 10,
        
        // --- THIS IS THE NEW SECTION ---
        // These switches allow you to enable or disable certain trade entry conditions.
        tradeBlockers: {
            // If true, the bot will NOT enter a trade if the 4-hour Stoch RSI is overbought ( > 80).
            blockOn4hrStoch: true,
            
            // If true, the bot will NOT enter a trade if the 5-minute Stoch RSI is overbought ( > 80).
            blockOn5minStoch: true,
            
            // If true, the bot will ONLY enter a trade if the 4-hour price trend is bullish.
            // Set to 'false' to allow trades in both uptrends and downtrends.
            blockOnPriceTrend: false
        }
    },

    // --- Risk Management ---
    risk: {
        stopLossPercentage: 0.45,
        takeProfitPercentage: 2.15,
    },

    // --- Technical Analysis ---
    ta: {
        atrPeriod: 14,
        fibLookback: 42,
        wmaPeriod: 24,
        fibEntryOffsetPct: 0.005,
        resetPctAboveFib0: 0.005,
        stoch: {
            rsiPeriod: 14,
            stochPeriod: 14,
            kPeriod: 3,
            dPeriod: 3
        },
        fourHour: {
            trendMaPeriod: 20,
            stoch: {
                rsiPeriod: 14,
                stochPeriod: 14,
                kPeriod: 3,
                dPeriod: 3
            }
        }
    },

    // --- Data Collection ---
    collector: {
        intervalSeconds: 60,
    },

    // --- Discord Notifications ---
    discord: {
        //webhookUrl: process.env.DISCORD_WEBHOOK_URL,
        botName: "Bot 1 Hyperliquid",
    },

    // --- Database ---
    database: {
        file: "trading_bot.db",
    },
};

export default config;
