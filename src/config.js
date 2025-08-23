// src/config.js
import 'dotenv/config';

const config = {
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
    },

    // Data Collection
    collector: {
        intervalSeconds: 60,
    },

    // Discord Notifications
    discord: {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL,
        botName: "Hyperliquid Bot",
    },

    // Database
    database: {
        file: "trading_bot.db",
    },
};

export default config;