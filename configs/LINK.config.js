// configs/LINK.config.js - LINK-specific trading configuration
import baseConfig from '../src/config.js';

export default {
    ...baseConfig,
    
    // Override trading settings for LINK
    trading: {
        ...baseConfig.trading,
        asset: 'LINK',
        tradeUsdSize: 750,
        leverage: 3,
        
        tradeBlockers: {
            ...baseConfig.trading.tradeBlockers,
            blockOn4hrStoch: true,
            blockOnPriceTrend: true,
            blockOn5minStoch: false // LINK can move fast
        }
    },

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

    // LINK-specific technical analysis
    ta: {
        ...baseConfig.ta,
        fibLookback: 42
    },

    files: {
        position: 'data/LINK/position.json',
        liveAnalysis: 'data/LINK/live_analysis.json',
        liveRisk: 'data/LINK/live_risk.json',
        manualOverride: 'data/LINK/manual_override.json',
        manualClose: 'data/LINK/manual_close.json'
    },

    database: {
        file: 'data/LINK/LINK_bot.db'
    },

    token: {
        symbol: 'LINK',
        name: 'Chainlink',
        decimals: 18,
        minTradeSize: 0.1,
        tickSize: 0.001,
        avgVolatility: 0.08,
        liquidityRank: 'HIGH'
    }
};