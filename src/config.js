// src/config.js
import 'dotenv/config';

const config = {
    // --- ADD THIS SECTION ---
    // General Settings
    debug: {
        enabled: true, // Master switch for all debug features
        logTickAnalysis: false, // <-- ADD THIS LINE: Set to false to disable logging every tick
    },

    // Trading Parameters
    trading: {
        asset: "SOL",
        tradeUsdSize: 625,
        leverage: 20,
        slippage: 0.01,
        cooldownMinutes: 10,
    },

    // Risk Management
    risk: {
        stopLossPercentage: 0.45,
        takeProfitPercentage: 2.15,
    },

    // Technical Analysis
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
         // ADD THIS NEW SECTION
        fourHour: {
            trendMaPeriod: 20, // Moving average period for 4hr trend
            stoch: {
                rsiPeriod: 14,
                stochPeriod: 14,
                kPeriod: 3,
                dPeriod: 3
            }
        }

    },

    // Data Collection
    collector: {
        intervalSeconds: 60,
    },

    // Discord Notifications
    discord: {
        //webhookUrl: process.env.DISCORD_WEBHOOK_URL,
        botName: "Bot 1 Hyperliquid",
    },

    // Database
    database: {
        file: "trading_bot.db",
    },
};

export default config;