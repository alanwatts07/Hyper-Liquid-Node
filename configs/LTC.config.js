// configs/LTC.config.js - LTC-specific trading configuration
import baseConfig from '../src/config.js';

export default {
    ...baseConfig,
    
    // Override trading settings for LTC
    trading: {
        ...baseConfig.trading,
        asset: 'LTC',
        tradeUsdSize: 700,
        leverage: 2,
        
        // LTC-specific trade blockers
        tradeBlockers: {
            ...baseConfig.trading.tradeBlockers,
            blockOn4hrStoch: true,
            blockOnPriceTrend: true,
            blockOn5minStoch: true
        }
    },

    // LTC-specific risk management
    risk: {
        ...baseConfig.risk,
        stopLossPercentage: 0.025, // 2.5% stop loss
        takeProfitPercentage: 0.04, // 4% take profit
        
        regimeRiskMultipliers: {
            'STRONG_UPTREND': {
                stopLoss: 1.3,
                takeProfit: 1.2
            },
            'VOLATILE_UNCERTAIN': {
                stopLoss: 0.6,
                takeProfit: 0.7
            }
        }
    },

    // LTC-specific technical analysis
    ta: {
        ...baseConfig.ta,
        fibLookback: 42
    },

    // File paths for LTC
    files: {
        position: 'data/LTC/position.json',
        liveAnalysis: 'data/LTC/live_analysis.json',
        liveRisk: 'data/LTC/live_risk.json',
        manualOverride: 'data/LTC/manual_override.json',
        manualClose: 'data/LTC/manual_close.json'
    },

    database: {
        file: 'data/LTC/LTC_bot.db'
    },

    token: {
        symbol: 'LTC',
        name: 'Litecoin',
        decimals: 8,
        minTradeSize: 0.01,
        tickSize: 0.01,
        avgVolatility: 0.07,
        liquidityRank: 'HIGH'
    }
};