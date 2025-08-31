// configs/ADA.config.js - ADA-specific trading configuration
import baseConfig from '../src/config.js';

export default {
    ...baseConfig,
    
    // Override trading settings for ADA
    trading: {
        ...baseConfig.trading,
        asset: 'ADA',
        tradeUsdSize: 600,
        leverage: 3,
        
        tradeBlockers: {
            ...baseConfig.trading.tradeBlockers,
            blockOn4hrStoch: true,
            blockOnPriceTrend: true,
            blockOn5minStoch: true
        }
    },

    risk: {
        ...baseConfig.risk,
        stopLossPercentage: 0.02, // 2% stop loss
        takeProfitPercentage: 0.035, // 3.5% take profit
        
        regimeRiskMultipliers: {
            'STRONG_UPTREND': {
                stopLoss: 1.2,
                takeProfit: 1.1
            },
            'VOLATILE_UNCERTAIN': {
                stopLoss: 0.7,
                takeProfit: 0.8
            }
        }
    },

    // ADA-specific technical analysis
    ta: {
        ...baseConfig.ta,
        fibLookback: 42
    },

    files: {
        position: 'data/ADA/position.json',
        liveAnalysis: 'data/ADA/live_analysis.json',
        liveRisk: 'data/ADA/live_risk.json',
        manualOverride: 'data/ADA/manual_override.json',
        manualClose: 'data/ADA/manual_close.json'
    },

    database: {
        file: 'data/ADA/ADA_bot.db'
    },

    token: {
        symbol: 'ADA',
        name: 'Cardano',
        decimals: 6,
        minTradeSize: 1,
        tickSize: 0.0001,
        avgVolatility: 0.08,
        liquidityRank: 'HIGH'
    }
};