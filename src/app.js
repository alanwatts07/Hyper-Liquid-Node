// src/app.js
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

class TradingBot {
    constructor() {
        this.config = config;
        this.db = new DatabaseManager(this.config.database.file);
        this.state = new StateManager(this.db);
        this.notifier = new Notifier(this.config.discord);
        
        this.collector = new DataCollector(this.config);
        this.analyzer = new TechnicalAnalyzer(this.config);
        this.tradeExecutor = new TradeExecutor(this.config, this.db, this.collector);
        this.riskManager = new RiskManager(this.config, this.db);
        this.signalGenerator = new SignalGenerator(this.config, this.db, this.state, this.notifier);
        
        this.latestAnalysis = null;
        this.lastTradeTime = null; // <-- Add this to track the cooldown period
    }

    async start() {
        logger.info("========================================");
        logger.info("      STARTING HYPERLIQUID NODE BOT     ");
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

            try {
                const overrideData = JSON.parse(await fs.readFile('manual_override.json', 'utf8'));
                if (overrideData.signal === 'buy') {
                    logger.warn("MANUAL OVERRIDE DETECTED! Forcing a 'buy' signal.");
                    signal = { type: 'buy' }; // Force the signal
                    await this.notifier.send("Manual Override  déclenché!", "Forcing a buy signal for testing.", "warning");
                    await fs.unlink('manual_override.json'); // Delete file after use
                }
            } catch (error) {
                // Ignore error if file doesn't exist
                if (error.code !== 'ENOENT') {
                    logger.error(`Error reading override file: ${error.message}`);
                }
            }
            // --- ADDED COOLDOWN LOGIC ---
            if (signal.type === 'buy' && !this.state.isInPosition()) {
                const now = new Date();
                if (this.lastTradeTime) {
                    const cooldownMs = this.config.trading.cooldownMinutes * 60 * 1000;
                    const timeSinceLastTrade = now - this.lastTradeTime;
                    if (timeSinceLastTrade < cooldownMs) {
                        // logger.info(`Cooldown active. Skipping signal. Time left: ${((cooldownMs - timeSinceLastTrade) / 60000).toFixed(2)} min.`);
                        return; // Skip the trade if we are in a cooldown period
                    }
                }
                // --- END OF COOLDOWN LOGIC ---

                const tradeResult = await this.tradeExecutor.executeBuy(
                    this.config.trading.asset,
                    this.config.trading.tradeUsdSize
                );

                if (tradeResult.success) {
                    this.state.setInPosition(true);
                    this.lastTradeTime = new Date(); // <-- Set the timestamp after a successful trade
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
            // ... (Logic to get position from DB and exchange)

            const openPositionsDB = await this.db.getOpenPositions();
            if (openPositionsDB.length === 0) {
                this.state.setInPosition(false);
                this.riskManager.clearPositionState(this.config.trading.asset);
                return;
            }
            const position = openPositionsDB[0];
            const clearinghouseState = await this.tradeExecutor.getClearinghouseState();
            if (!clearinghouseState) return;

            const livePosition = clearinghouseState.assetPositions.find(p => p.position.coin === position.asset);
            if (!livePosition || Number(livePosition.position.szi) === 0) {
                await this.db.updatePosition(position.asset, "N/A", 0, 0, "CLOSED");
                this.state.setInPosition(false);
                this.riskManager.clearPositionState(position.asset);
                this.lastTradeTime = new Date(); // <-- Also start cooldown after closing a position
                return;
            }

            const currentPrice = await this.collector.getCurrentPrice(position.asset);
            const action = await this.riskManager.checkPosition(position, livePosition.position, currentPrice, this.latestAnalysis);
            const riskData = {
                asset: position.asset,
                entryPrice: position.entry_px,
                currentPrice: currentPrice,
                roe: (livePosition.position.returnOnEquity * 100).toFixed(2) + '%',
                ...this.riskManager.positionState[position.asset] // Get live state from RiskManager
            };
            await fs.writeFile('live_risk.json', JSON.stringify(riskData, null, 2));
            if (action.shouldClose) {
                await this.notifier.send(`${action.reason} Hit!`, `Closing position for ${position.asset}. Trigger Value: ${action.value}`, "warning");
                const closeResult = await this.tradeExecutor.closePosition(position.asset, Number(livePosition.position.szi));
                
                if (closeResult.success) {
                    this.state.setInPosition(false);
                    this.lastTradeTime = new Date(); // <-- Also start cooldown after closing a position
                }
            }
        } catch (error) {
            logger.error(`Error in managePositions loop: ${error.message}`);
        }
    }
}

const bot = new TradingBot();
bot.start();