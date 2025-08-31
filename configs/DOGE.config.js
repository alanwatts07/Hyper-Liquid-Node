// configs/DOGE.config.js - DOGE-specific trading configuration
import baseConfig from '../src/config.js';

export default {
    ...baseConfig,
    
    // Override trading settings for DOGE
    trading: {
        ...baseConfig.trading,
        asset: 'DOGE',
        tradeUsdSize: 500, // Smaller size for meme coin
        leverage: 10, // Conservative leverage for volatile asset
        
        // DOGE-specific trade blockers - very conservative
        tradeBlockers: {
            ...baseConfig.trading.tradeBlockers,
            blockOn4hrStoch: true,
            blockOnPriceTrend: false,
            blockOn5minStoch: true // Use all blockers for DOGE
        }
    },

    // DOGE-specific risk management
    risk: {
        ...baseConfig.risk,
        stopLossPercentage: 0.03, // 3% stop loss - wider for volatility
        takeProfitPercentage: 0.06, // 6% take profit - higher targets
        
        // Regime-based risk adjustments
        regimeRiskMultipliers: {
            'STRONG_UPTREND': {
                stopLoss: 1.5,
                takeProfit: 1.4
            },
            'VOLATILE_UNCERTAIN': {
                stopLoss: 0.4, // Very tight stops for DOGE volatility
                takeProfit: 0.5
            }
        }
    },

    // DOGE-specific technical analysis
    ta: {
        ...baseConfig.ta,
        fibLookback: 42
    },

    // File paths for DOGE
    files: {
        position: 'data/DOGE/position.json',
        liveAnalysis: 'data/DOGE/live_analysis.json',
        liveRisk: 'data/DOGE/live_risk.json',
        manualOverride: 'data/DOGE/manual_override.json',
        manualClose: 'data/DOGE/manual_close.json'
    },

    // DOGE-specific database
    database: {
        file: 'data/DOGE/DOGE_bot.db'
    },

    // Token metadata
    token: {
        symbol: 'DOGE',
        name: 'Dogecoin',
        decimals: 8,
        minTradeSize: 1,
        tickSize: 0.0001,
        avgVolatility: 0.12, // 12% average daily volatility - very high
        liquidityRank: 'MEDIUM'
    }
};