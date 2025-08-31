// configs/SOL.config.js - SOL-specific trading configuration
import baseConfig from '../src/config.js';

export default {
    ...baseConfig,
    
    // Override trading settings for SOL
    trading: {
        ...baseConfig.trading,
        asset: 'SOL',
        tradeUsdSize: 360,
        leverage: 3,
        
        // SOL-specific trade blockers
        tradeBlockers: {
            ...baseConfig.trading.tradeBlockers,
            blockOn4hrStoch: true,
            blockOnPriceTrend: true,
            blockOn5minStoch: false // SOL moves fast, be less restrictive
        }
    },

    // SOL-specific risk management
    risk: {
        ...baseConfig.risk,
        stopLossPercentage: 0.02, // 2% stop loss
        takeProfitPercentage: 0.04, // 4% take profit
        
        // Regime-based risk adjustments
        regimeRiskMultipliers: {
            'STRONG_UPTREND': {
                stopLoss: 1.5,    // Wider stops in strong trends
                takeProfit: 1.2   // Higher targets
            },
            'VOLATILE_UNCERTAIN': {
                stopLoss: 0.5,    // Tighter stops in volatile markets
                takeProfit: 0.8   // Lower targets
            }
        }
    },

    // SOL-specific technical analysis
    ta: {
        ...baseConfig.ta,
        fibLookback: 42,
        
        // Adjust for SOL's volatility
        stoch: {
            ...baseConfig.ta.stoch,
            rsiPeriod: 14,
            stochPeriod: 14,
            kPeriod: 3,
            dPeriod: 3
        }
    },

    // File paths for SOL
    files: {
        position: 'data/SOL/position.json',
        liveAnalysis: 'data/SOL/live_analysis.json',
        liveRisk: 'data/SOL/live_risk.json',
        manualOverride: 'data/SOL/manual_override.json',
        manualClose: 'data/SOL/manual_close.json'
    },

    // SOL-specific database
    database: {
        file: 'data/SOL/SOL_bot.db'
    },

    // Token metadata
    token: {
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        minTradeSize: 0.1,
        tickSize: 0.001,
        
        // Market characteristics
        avgVolatility: 0.08, // 8% average daily volatility
        liquidityRank: 'HIGH',
        
        // Trading hours (UTC) - crypto trades 24/7 but can have dead zones
        activeHours: {
            start: 0,
            end: 24
        }
    }
};