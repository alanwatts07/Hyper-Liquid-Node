import config from './config.js';
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

const POSITION_FILE = 'position.json';

class TradingBot {
    constructor() {
        this.config = config;
        this.db = new DatabaseManager(this.config.database.file);
        this.collector = new DataCollector(this.config);
        this.tradeExecutor = new TradeExecutor(this.config, this.db, this.collector);
        this.state = new StateManager(this.db, this.tradeExecutor);
        this.notifier = new Notifier(this.config.discord);
        this.analyzer = new TechnicalAnalyzer(this.config);
        this.riskManager = new RiskManager(this.config, this.db);
        this.signalGenerator = new SignalGenerator(this.config, this.db, this.state, this.notifier);
        this.latestAnalysis = null;
        this.lastTradeTime = null;
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
            if (this.latestAnalysis) {
                await fs.writeFile('live_analysis.json', JSON.stringify(this.latestAnalysis, null, 2));
            }
            if (!this.latestAnalysis) return;

            let signal = this.signalGenerator.generate(this.latestAnalysis);
            await this.db.logEvent('BOT_TICK_ANALYSIS', { analysis: this.latestAnalysis, signal: signal });

            try {
                const overrideData = JSON.parse(await fs.readFile('manual_override.json', 'utf8'));
                if (overrideData.signal === 'buy') {
                    logger.warn("MANUAL OVERRIDE DETECTED! Forcing a 'buy' signal.");
                    signal = { type: 'buy' };
                    await this.notifier.send("Manual Override Triggered!", "Forcing a buy signal for testing.", "warning");
                    await fs.unlink('manual_override.json');
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

                const tradeResult = await this.tradeExecutor.executeBuy(
                    this.config.trading.asset,
                    this.config.trading.tradeUsdSize
                );

                if (tradeResult.success) {
                    this.state.setInPosition(true);
                    this.lastTradeTime = new Date();
                    
                    // We still write the file, but we won't rely on it for the entry price anymore.
                    await fs.writeFile(POSITION_FILE, JSON.stringify(tradeResult.filledOrder, null, 2));
                    logger.info(`Created ${POSITION_FILE} for new trade.`);
                }
            }
        } catch (error) {
            logger.error(`Error in processNewData loop: ${error.message}`);
        }
    }

    async managePositions() {
        if (!this.state.isInPosition() || !this.latestAnalysis) {
            return;
        }

        try {
            // Fetch live data FIRST. This is now our source of truth.
            const clearinghouseState = await this.tradeExecutor.getClearinghouseState();
            if (!clearinghouseState || !Array.isArray(clearinghouseState.assetPositions)) {
                logger.warn("Could not get valid clearinghouse state. Skipping this check.");
                return;
            }

            const asset = this.config.trading.asset;
            const livePosition = clearinghouseState.assetPositions.find(p => p && p.position && p.position.coin === asset);
            
            if (!livePosition) {
                logger.warn(`Could not find live position for ${asset} on the exchange. Assuming it was closed manually.`);
                this.state.setInPosition(false);
                this.riskManager.clearPositionState(asset);
                await fs.unlink(POSITION_FILE).catch(e => { if (e.code !== 'ENOENT') logger.error(e); });
                return;
            }

            const livePositionData = livePosition.position;
            
            // --- THIS IS THE FIX ---
            // Create the position object for the risk check using the LIVE entry price from the exchange.
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
                entryPrice: positionForRiskCheck.entry_px, // Now reflects the true entry price
                currentPrice: currentPrice,
                roe: (livePositionData.returnOnEquity * 100).toFixed(2) + '%',
                ...this.riskManager.positionState[asset]
            };
            await fs.writeFile('live_risk.json', JSON.stringify(riskData, null, 2));

            if (action.shouldClose) {
                await this.notifier.send(`${action.reason} Hit!`, `Closing position for ${asset}. Trigger Value: ${action.value}`, "warning");
                const closeResult = await this.tradeExecutor.closePosition(asset, Number(livePositionData.szi));
                
                if (closeResult.success) {
                    this.state.setInPosition(false);
                    this.riskManager.clearPositionState(asset); // Explicitly clear the risk manager's state
                    await fs.unlink(POSITION_FILE);
                    logger.info(`Deleted ${POSITION_FILE} after closing trade.`);
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