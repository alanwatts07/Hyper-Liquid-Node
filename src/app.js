// src/app.js
import path from 'path';

// Check if this is being run as a token-specific instance
let config;
if (process.env.TOKEN_SYMBOL && process.env.TOKEN_CONFIG_PATH) {
    console.log(`[${process.env.TOKEN_SYMBOL}] Loading token-specific configuration...`);
    const configModule = await import(path.resolve(process.env.TOKEN_CONFIG_PATH));
    config = configModule.default;
    console.log(`[${process.env.TOKEN_SYMBOL}] ✅ Configuration loaded for ${config.trading.asset}`);
} else {
    // Default single-token mode
    const configModule = await import('./config.js');
    config = configModule.default;
}
import DatabaseManager from './database/DatabaseManager.js';
import StateManager from './components/StateManager.js';
import Notifier from './components/Notifier.js';
import DataCollector from './components/DataCollector.js';
import TechnicalAnalyzer from './components/TechnicalAnalyzer.js';
import TradeExecutor from './components/TradeExecutor.js';
import RiskManager from './components/RiskManager.js';
import SignalGenerator from './components/SignalGenerator.js';
import logger from './utils/logger.js';
import fs from 'fs/promises';

// Position file path will be determined from config

class TradingBot {
    constructor() {
        this.config = config;
        this.db = new DatabaseManager(this.config.database.file, this.config);        
        this.collector = new DataCollector(this.config);
        this.tradeExecutor = new TradeExecutor(this.config, this.db, this.collector);
        this.state = new StateManager(this.db, this.tradeExecutor, this.config);
        this.notifier = new Notifier(this.config.discord);
        this.analyzer = new TechnicalAnalyzer(this.config);
        this.riskManager = new RiskManager(this.config, this.db);
        this.signalGenerator = new SignalGenerator(this.config, this.db, this.state, this.notifier, this.getAnalysisFile());
        this.latestAnalysis = null;
        this.lastTradeTime = null;
    }

    // Helper methods to get file paths from config with fallbacks
    getPositionFile() {
        return this.config.files?.position || 'position.json';
    }

    getAnalysisFile() {
        return this.config.files?.liveAnalysis || 'live_analysis.json';
    }

    getRiskFile() {
        return this.config.files?.liveRisk || 'live_risk.json';
    }

    getManualOverrideFile() {
        return this.config.files?.manualOverride || 'manual_override.json';
    }

    getManualCloseFile() {
        return this.config.files?.manualClose || 'manual_close.json';
    }

    async getDynamicTradeSize() {
        try {
            // Try to read live_risk.json for size multiplier
            const riskData = JSON.parse(await fs.readFile(this.getRiskFile(), 'utf8'));
            const sizeMultiplier = riskData.sizeMultiplier || 1.0;
            const baseSize = this.config.trading.tradeUsdSize;
            const dynamicSize = Math.round(baseSize * sizeMultiplier);
            
            logger.info(`Dynamic trade size: $${baseSize} × ${(sizeMultiplier * 100).toFixed(0)}% = $${dynamicSize} (${riskData.strategy || 'N/A'} strategy)`);
            return dynamicSize;
            
        } catch (error) {
            // Fall back to base size if no risk data available
            const baseSize = this.config.trading.tradeUsdSize;
            logger.info(`Using base trade size: $${baseSize} (no regime data available)`);
            return baseSize;
        }
    }

    async start() {
        logger.info("========================================");
        logger.info("      STARTING HYPERLIQUID NODE BOT      ");
        logger.info("========================================");
        try {
            await this.db.connect();
            await this.state.loadInitialState();
            this.collector.on('newData', (priceData) => this.processNewData(priceData));
            this.collector.start();
            setInterval(() => this.managePositions(), 15 * 1000);
            await this.notifier.send("Bot Started", "The trading bot is now running.", "info");
        } catch (error) {
            logger.error(`FATAL: Bot failed to start: ${error.message}`);
            process.exit(1);
        }
    }

    async processNewData(priceData) {
        try {
            await this.db.savePriceData(priceData);
            const historicalData = await this.db.getHistoricalPriceData();
            this.latestAnalysis = this.analyzer.calculate(historicalData);
            if (!this.latestAnalysis) return;

            if(this.latestAnalysis.stoch_rsi) {
                const { k, d } = this.latestAnalysis.stoch_rsi;
                logger.info(`Stoch RSI: K=${k.toFixed(2)}, D=${d.toFixed(2)}`);
            }

            let signal = await this.signalGenerator.generate(this.latestAnalysis);
            
            if (this.config.debug.logTickAnalysis) {
                await this.db.logEvent('BOT_TICK_ANALYSIS', { analysis: this.latestAnalysis, signal: signal });
            }

            try {
                const overrideData = JSON.parse(await fs.readFile(this.getManualOverrideFile(), 'utf8'));
                if (overrideData.signal === 'buy') {
                    logger.warn("MANUAL OVERRIDE DETECTED! Forcing a 'buy' signal.");
                    signal = { type: 'buy' };
                    const stochMessage = this.latestAnalysis.stoch_rsi ? `\nStoch RSI: K=${this.latestAnalysis.stoch_rsi.k.toFixed(2)}, D=${this.latestAnalysis.stoch_rsi.d.toFixed(2)}` : '';
                    await this.notifier.send("Manual Override Triggered!", `Forcing a buy signal for testing.${stochMessage}`, "warning");
                    await fs.unlink(this.getManualOverrideFile());
                }
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.error(`Error reading override file: ${error.message}`);
                }
            }
            
            if (signal.type === 'buy' && !this.state.isInPosition()) {
                const now = new Date();
                if (this.lastTradeTime) {
                    const cooldownMs = this.config.trading.cooldownMinutes * 60 * 1000;
                    const timeSinceLastTrade = now - this.lastTradeTime;
                    if (timeSinceLastTrade < cooldownMs) {
                        logger.warn(`Cooldown active. Skipping signal. Time left: ${((cooldownMs - timeSinceLastTrade) / 60000).toFixed(2)} min.`);
                        return;
                    }
                }

                // Get dynamic trade size based on regime multiplier
                const dynamicTradeSize = await this.getDynamicTradeSize();
                
                const tradeResult = await this.tradeExecutor.executeBuy(
                    this.config.trading.asset,
                    dynamicTradeSize
                );

                if (tradeResult.success) {
                    this.state.setInPosition(true);
                    this.lastTradeTime = new Date();
                    await fs.writeFile(this.getPositionFile(), JSON.stringify(tradeResult.filledOrder, null, 2));
                    logger.info(`Created ${this.getPositionFile()} for new trade.`);
                }
            }
        } catch (error) {
            logger.error(`Error in processNewData loop: ${error.message}`);
        }
    }

     async managePositions() {
        // --- THIS SECTION IS NOW CLEANER ---
        // The old logic for resetting the risk config has been removed.
        if (!this.state.isInPosition() || !this.latestAnalysis) {
            return;
        }

        try {
            // ... (manual close logic remains the same)
            try {
                const overrideData = JSON.parse(await fs.readFile(this.getManualCloseFile(), 'utf8'));
                if (overrideData.signal === 'close') {
                    logger.warn("MANUAL CLOSE DETECTED FROM DISCORD! Closing position now.");
                    await this.notifier.send("Manual Close Triggered!", "Closing position due to !panic command from Discord.", "warning");

                    const clearinghouseState = await this.tradeExecutor.getClearinghouseState();
                    const asset = this.config.trading.asset;
                    const livePosition = clearinghouseState.assetPositions.find(p => p && p.position && p.position.coin === asset);

                    if (livePosition) {
                        const closeResult = await this.tradeExecutor.closePosition(asset, Number(livePosition.position.szi));
                        if (closeResult.success) {
                            this.state.setInPosition(false);
                            this.riskManager.clearPositionState(asset);
                            await fs.unlink(this.getPositionFile()).catch(e => { if (e.code !== 'ENOENT') logger.error(e); });
                            await fs.unlink(this.getRiskFile()).catch(e => { if (e.code !== 'ENOENT') logger.error(e); });
                            await fs.unlink(this.getManualCloseFile()); 
                            logger.info("Position closed successfully via manual override.");
                        }
                    }
                    return; 
                }
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.error(`Error reading ${this.getManualCloseFile()} file: ${error.message}`);
                }
            }

            // ... (the rest of the function remains the same)
            const clearinghouseState = await this.tradeExecutor.getClearinghouseState();
            if (!clearinghouseState || !Array.isArray(clearinghouseState.assetPositions)) {
                logger.warn("Could not get valid clearinghouse state. Skipping this check.");
                return;
            }

            const asset = this.config.trading.asset;
            const livePosition = clearinghouseState.assetPositions.find(p => p && p.position && p.position.coin === asset && Number(p.position.szi) !== 0);

            if (!livePosition) {
                logger.warn(`Could not find live position for ${asset} on the exchange. Assuming it was closed manually.`);
                this.state.setInPosition(false);
                this.riskManager.clearPositionState(asset); 
                await fs.unlink(this.getPositionFile()).catch(e => {
                    if (e.code !== 'ENOENT') logger.error(`Failed to delete stale ${this.getPositionFile()}: ${e.message}`);
                });
                await fs.unlink(this.getRiskFile()).catch(e => {
                    if (e.code !== 'ENOENT') logger.error(`Failed to delete stale ${this.getRiskFile()}: ${e.message}`);
                });
                logger.info("Successfully cleaned up stale position files.");
                return;
            }

            const livePositionData = livePosition.position;
            
            const positionForRiskCheck = { 
                asset: asset, 
                entry_px: parseFloat(livePositionData.entryPx) 
            };

            const currentPrice = await this.collector.getCurrentPrice(asset);
            if (!currentPrice) {
                logger.warn(`Could not fetch current price for ${asset}. Skipping this check.`);
                return;
            }

            const action = await this.riskManager.checkPosition(positionForRiskCheck, livePositionData, currentPrice, this.latestAnalysis);

            const riskData = {
                asset: asset,
                entryPrice: positionForRiskCheck.entry_px, 
                currentPrice: currentPrice,
                roe: (livePositionData.returnOnEquity * 100).toFixed(2) + '%',
                ...this.riskManager.positionState[asset],
                stoch_rsi: this.latestAnalysis.stoch_rsi,
                bull_state: this.latestAnalysis.bull_state,
                stoch_rsi_4hr: this.latestAnalysis.stoch_rsi_4hr,
                liveTakeProfitPercentage: action.liveTakeProfitPercentage,
                liveStopLossPercentage: action.liveStopLossPercentage,
                strategy: action.strategy,
                regime: action.regime,
                sizeMultiplier: action.sizeMultiplier,
                timestamp: new Date().toISOString()
            };
            await fs.writeFile(this.getRiskFile(), JSON.stringify(riskData, null, 2));

            if (action.shouldClose) {
                await this.notifier.send(`${action.reason} Hit!`, `Closing position for ${asset}. Trigger Value: ${action.value}`, "warning");
                const closeResult = await this.tradeExecutor.closePosition(asset, Number(livePositionData.szi));
                
                if (closeResult.success) {
                    this.state.setInPosition(false);
                    this.riskManager.clearPositionState(asset); 
                    await fs.unlink(this.getPositionFile()).catch(e => {
                        if (e.code !== 'ENOENT') logger.error(`Failed to delete ${this.getPositionFile()}: ${e.message}`);
                    });
                    await fs.unlink(this.getRiskFile()).catch(e => {
                        if (e.code !== 'ENOENT') logger.error(`Failed to delete ${this.getRiskFile()}: ${e.message}`);
                    });
                    logger.info(`Cleaned up position files after closing trade.`);
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`Error in managePositions loop: ${error.message}`);
            }
        }
    }
}

const bot = new TradingBot();
bot.start();
