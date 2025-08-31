// configs/AVAX.config.js - AVAX-specific trading configuration
import baseConfig from '../src/config.js';

export default {
    ...baseConfig,
    
    // Override trading settings for AVAX
    trading: {
        ...baseConfig.trading,
        asset: 'AVAX',
        tradeUsdSize: 800,
        leverage: 3,
        
        // AVAX-specific trade blockers
        tradeBlockers: {
            ...baseConfig.trading.tradeBlockers,
            blockOn4hrStoch: true,
            blockOnPriceTrend: true,
            blockOn5minStoch: false // AVAX moves fast like SOL
        }
    },

    // AVAX-specific risk management
    risk: {
        ...baseConfig.risk,
        stopLossPercentage: 0.025, // 2.5% stop loss
        takeProfitPercentage: 0.045, // 4.5% take profit
        
        // Regime-based risk adjustments
        regimeRiskMultipliers: {
            'STRONG_UPTREND': {
                stopLoss: 1.4,
                takeProfit: 1.3
            },
            'VOLATILE_UNCERTAIN': {
                stopLoss: 0.6,
                takeProfit: 0.7
            }
        }
    },

    // AVAX-specific technical analysis  
    ta: {
        ...baseConfig.ta,
        fibLookback: 42
    },

    // File paths for AVAX
    files: {
        position: 'data/AVAX/position.json',
        liveAnalysis: 'data/AVAX/live_analysis.json',
        liveRisk: 'data/AVAX/live_risk.json',
        manualOverride: 'data/AVAX/manual_override.json',
        manualClose: 'data/AVAX/manual_close.json'
    },

    // AVAX-specific database
    database: {
        file: 'data/AVAX/AVAX_bot.db'
    },

    // Token metadata
    token: {
        symbol: 'AVAX',
        name: 'Avalanche',
        decimals: 18,
        minTradeSize: 0.1,
        tickSize: 0.001,
        avgVolatility: 0.09, // 9% average daily volatility
        liquidityRank: 'HIGH'
    }
};