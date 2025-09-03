// multi.config.js - Master configuration for multi-token trading bot
import 'dotenv/config';

export default {
    // Global settings
    global: {
        hyperliquid: {
            wallet_private_key: process.env.HYPERLIQUID_WALLET_PRIVATE_KEY,
            main_account_address: process.env.HYPERLIQUID_MAIN_ACCOUNT_ADDRESS
        },
        discord: {
            enabled: true,
            webhook_url: process.env.DISCORD_WEBHOOK_URL,
            bot_token: process.env.DISCORD_BOT_TOKEN,
            channel_id: process.env.DISCORD_CHANNEL_ID,
            owner_id: process.env.DISCORD_OWNER_ID
        },
        claude: {
            api_key: process.env.CLAUDE_API_KEY
        }
    },

    // Regime-based auto management rules
    regimeRules: {
        enabled: true, // Master switch for auto regime control
        checkInterval: 900000, // 15 minutes
        rules: [
            {
                name: "STRONG_DOWNTREND_DISABLE",
                condition: (regime) => regime.regime === 'STRONG_DOWNTREND' && regime.confidence >= 8,
                action: 'DISABLE',
                description: "Disable trading during strong bearish conditions"
            },
            {
                name: "VOLATILE_REDUCE", 
                condition: (regime) => regime.regime === 'VOLATILE_UNCERTAIN' && regime.confidence >= 7,
                action: 'REDUCE_RISK',
                description: "Reduce position sizes during volatile conditions"
            },
            {
                name: "STRONG_UPTREND_ENABLE",
                condition: (regime) => regime.regime === 'STRONG_UPTREND' && regime.confidence >= 7,
                action: 'ENABLE',
                description: "Re-enable trading during strong bullish conditions"
            },
            {
                name: "EMERGENCY_SHUTDOWN",
                condition: (regime) => ['STRONG_DOWNTREND', 'VOLATILE_UNCERTAIN'].includes(regime.regime) && regime.confidence >= 9,
                action: 'PANIC_ALL',
                description: "Emergency shutdown - close all positions and disable all tokens"
            }
        ]
    },

    // Regime-specific risk parameter adjustments
    regimeRiskMultipliers: {
        'STRONG_UPTREND': {
            stopLoss: 0.25,      // 25% stop loss
            takeProfit: 4.0,     // 400% take profit
            sizeMultiplier: 1.0, // Full trade size
            strategy: 'AGGRESSIVE_TREND',
            description: 'Wide stops, massive targets for trend following'
        },
        'WEAK_UPTREND': {
            stopLoss: 0.30,      // 30% stop loss  
            takeProfit: 1.5,     // 150% take profit
            sizeMultiplier: 0.8, // 80% trade size
            strategy: 'CAUTIOUS_TREND',
            description: 'Moderate parameters for weak trends'
        },
        'RANGING': {
            stopLoss: 0.35,      // 35% stop loss
            takeProfit: 0.80,    // 80% take profit
            sizeMultiplier: 0.7, // 70% trade size
            strategy: 'RANGE_SCALPING',
            description: 'Quick profits in sideways markets'
        },
        'VOLATILE_UNCERTAIN': {
            stopLoss: 0.40,      // 40% stop loss
            takeProfit: 0.65,    // 65% take profit
            sizeMultiplier: 0.5, // 50% trade size
            strategy: 'VOLATILITY_SCALPING',
            description: 'Tight management for volatile conditions'
        },
        'WEAK_DOWNTREND': {
            stopLoss: 0.40,      // 40% stop loss
            takeProfit: 0.25,    // 25% take profit
            sizeMultiplier: 0.25,// 25% trade size
            strategy: 'MINIMAL_COUNTER',
            description: 'Minimal size counter-trend trades only'
        },
        'STRONG_DOWNTREND': {
            stopLoss: 0.50,      // 50% stop loss (if trading)
            takeProfit: 0.20,    // 20% take profit (if trading)
            sizeMultiplier: 0.0, // No trades (disabled)
            strategy: 'DISABLED',
            description: 'No trading during strong bearish conditions'
        }
    },

    // Token configurations
    tokens: {
        AVAX: {
            enabled: true,
            symbol: 'AVAX',
            configFile: 'configs/AVAX.config.js',
            dataDir: 'data/AVAX',
            logFile: 'logs/AVAX.log',
            color: 0xE84142, // Red for Discord embeds
            
            // Regime-specific overrides
            regimeOverrides: {
                enableOnRegime: ['STRONG_UPTREND', 'WEAK_UPTREND'],
                disableOnRegime: ['STRONG_DOWNTREND'],
                
                // Position size multipliers based on regime
                regimeMultipliers: {
                    'STRONG_UPTREND': 1.3,
                    'WEAK_UPTREND': 1.0,
                    'RANGING': 0.8,
                    'WEAK_DOWNTREND': 0.5,
                    'STRONG_DOWNTREND': 0.0, // Disabled
                    'VOLATILE_UNCERTAIN': 0.4
                }
            }
        },

        SOL: {
            enabled: true,
            symbol: 'SOL',
            configFile: 'configs/SOL.config.js',
            dataDir: 'data/SOL',
            logFile: 'logs/SOL.log',
            color: 0x9945FF, // Purple for Discord embeds
            
            regimeOverrides: {
                enableOnRegime: ['STRONG_UPTREND', 'WEAK_UPTREND'],
                disableOnRegime: ['STRONG_DOWNTREND'],
                regimeMultipliers: {
                    'STRONG_UPTREND': 1.2,
                    'WEAK_UPTREND': 1.0,
                    'RANGING': 0.8,
                    'WEAK_DOWNTREND': 0.5,
                    'STRONG_DOWNTREND': 0.0,
                    'VOLATILE_UNCERTAIN': 0.4
                }
            }
        },
        
        DOGE: {
            enabled: true,
            symbol: 'DOGE',
            configFile: 'configs/DOGE.config.js', 
            dataDir: 'data/DOGE',
            logFile: 'logs/DOGE.log',
            color: 0xC2A633, // Gold for Discord embeds
            
            regimeOverrides: {
                enableOnRegime: ['STRONG_UPTREND'],
                disableOnRegime: ['STRONG_DOWNTREND', 'VOLATILE_UNCERTAIN'],
                regimeMultipliers: {
                    'STRONG_UPTREND': 1.4,
                    'WEAK_UPTREND': 0.8,
                    'RANGING': 0.6,
                    'WEAK_DOWNTREND': 0.3,
                    'STRONG_DOWNTREND': 0.0,
                    'VOLATILE_UNCERTAIN': 0.2
                }
            }
        },

        LTC: {
            enabled: false,
            symbol: 'LTC',
            configFile: 'configs/LTC.config.js',
            dataDir: 'data/LTC', 
            logFile: 'logs/LTC.log',
            color: 0xBFBFBF, // Silver for Discord embeds
            
            regimeOverrides: {
                enableOnRegime: ['STRONG_UPTREND', 'WEAK_UPTREND'],
                disableOnRegime: ['STRONG_DOWNTREND'],
                regimeMultipliers: {
                    'STRONG_UPTREND': 1.1,
                    'WEAK_UPTREND': 1.0,
                    'RANGING': 0.7,
                    'WEAK_DOWNTREND': 0.4,
                    'STRONG_DOWNTREND': 0.0,
                    'VOLATILE_UNCERTAIN': 0.3
                }
            }
        },

        ADA: {
            enabled: true,
            symbol: 'ADA',
            configFile: 'configs/ADA.config.js',
            dataDir: 'data/ADA',
            logFile: 'logs/ADA.log',
            color: 0x0033AD, // Cardano blue
            
            regimeOverrides: {
                enableOnRegime: ['STRONG_UPTREND', 'WEAK_UPTREND'],
                disableOnRegime: ['STRONG_DOWNTREND'],
                regimeMultipliers: {
                    'STRONG_UPTREND': 1.1,
                    'WEAK_UPTREND': 0.9,
                    'RANGING': 0.6,
                    'WEAK_DOWNTREND': 0.3,
                    'STRONG_DOWNTREND': 0.0,
                    'VOLATILE_UNCERTAIN': 0.3
                }
            }
        },

        LINK: {
            enabled: true,
            symbol: 'LINK',
            configFile: 'configs/LINK.config.js',
            dataDir: 'data/LINK',
            logFile: 'logs/LINK.log',
            color: 0x375BD2, // Chainlink blue
            
            regimeOverrides: {
                enableOnRegime: ['STRONG_UPTREND', 'WEAK_UPTREND'],
                disableOnRegime: ['STRONG_DOWNTREND'],
                regimeMultipliers: {
                    'STRONG_UPTREND': 1.2,
                    'WEAK_UPTREND': 1.0,
                    'RANGING': 0.7,
                    'WEAK_DOWNTREND': 0.4,
                    'STRONG_DOWNTREND': 0.0,
                    'VOLATILE_UNCERTAIN': 0.3
                }
            }
        }
    },

    // Process management settings
    processManager: {
        maxRestarts: 5,
        restartDelay: 10000, // 10 seconds
        healthCheckInterval: 30000, // 30 seconds
        gracefulShutdownTimeout: 15000 // 15 seconds
    },

    // Logging settings
    logging: {
        level: 'info',
        maxFileSize: '10MB',
        maxFiles: 5,
        rotateDaily: true
    }
};