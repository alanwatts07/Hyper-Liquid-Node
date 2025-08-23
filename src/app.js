// src/app.js
// ... (imports and constructor are the same) ...
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
        // ... (start method is the same) ...
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
            // ... (signal generation logic is the same) ...
            await this.db.savePriceData(priceData);
            const historicalData = await this.db.getHistoricalPriceData();
            this.latestAnalysis = this.analyzer.calculate(historicalData);
            if (this.latestAnalysis) await fs.writeFile('live_analysis.json', JSON.stringify(this.latestAnalysis, null, 2));
            if (!this.latestAnalysis) return;
            let signal = this.signalGenerator.generate(this.latestAnalysis);
            // ... (override logic is the same) ...

            if (signal.type === 'buy' && !this.state.isInPosition()) {
                // ... (cooldown logic is the same) ...
                
                const tradeResult = await this.tradeExecutor.executeBuy(
                    this.config.trading.asset,
                    this.config.trading.tradeUsdSize
                );

                if (tradeResult.success) {
                    this.state.setInPosition(true);
                    this.lastTradeTime = new Date();
                    
                    // --- FIX: Write the full, rich position data to the file ---
                    const newPositionData = {
                        coin: this.config.trading.asset,
                        szi: tradeResult.filledOrder.totalSz,
                        leverage: this.config.trading.leverage, // Placeholder, will update on next managePositions cycle
                        entryPx: tradeResult.filledOrder.avgPx,
                        positionValue: parseFloat(tradeResult.filledOrder.totalSz) * parseFloat(tradeResult.filledOrder.avgPx),
                        // ... other fields will be populated from the live check
                    };
                    await fs.writeFile(POSITION_FILE, JSON.stringify(newPositionData, null, 2));
                    logger.info(`Created ${POSITION_FILE} for new trade.`);
                }
            }
        } catch (error) {
            logger.error(`Error in processNewData loop: ${error.message}`);
        }
    }

   async managePositions() {
        if (!this.state.isInPosition() || !this.latestAnalysis) {
            try {
                await fs.unlink('live_risk.json');
            } catch (error) {
                if (error.code !== 'ENOENT') logger.error(`Error clearing risk file: ${error.message}`);
            }
            return;
        }

        try {
            const openPositionsDB = await this.db.getOpenPositions();
            if (openPositionsDB.length === 0) {
                this.state.setInPosition(false);
                this.riskManager.clearPositionState(this.config.trading.asset);
                return;
            }
            const position = openPositionsDB[0];

            const clearinghouseState = await this.tradeExecutor.getClearinghouseState();
            if (!clearinghouseState || !Array.isArray(clearinghouseState.assetPositions)) {
                logger.warn("Could not get valid clearinghouse state for ROE. Skipping this check.");
                return;
            }
            const livePosition = clearinghouseState.assetPositions.find(p => p && p.position && p.position.coin === position.asset);
            if (!livePosition) {
                 logger.warn(`Could not find live position details for ${position.asset} to calculate ROE. Skipping this check.`);
                 return;
            }
            const livePositionData = livePosition.position;

            const currentPrice = await this.collector.getCurrentPrice(position.asset);
            if (!currentPrice) {
                logger.warn(`Could not fetch current price for ${position.asset}. Skipping this check.`);
                return;
            }

            const action = await this.riskManager.checkPosition(position, livePositionData, currentPrice, this.latestAnalysis);

            // ================================================================= //
            // === FINAL FIX: Calculate and add SL/TP prices to the risk data === //
            const entryPrice = position.entry_px;
            const stopLossPrice = entryPrice * (1 - this.config.risk.stopLossPercentage);
            const takeProfitPrice = entryPrice * (1 + this.config.risk.takeProfitPercentage);

            const riskData = {
                asset: position.asset,
                entryPrice: entryPrice,
                currentPrice: currentPrice,
                roe: (livePositionData.returnOnEquity * 100).toFixed(2) + '%',
                stopLossPrice: stopLossPrice, // Add calculated SL price
                takeProfitPrice: takeProfitPrice, // Add calculated TP price
                ...this.riskManager.positionState[position.asset]
            };
            await fs.writeFile('live_risk.json', JSON.stringify(riskData, null, 2));
            // ================================================================= //

            if (action.shouldClose) {
                await this.notifier.send(`${action.reason} Hit!`, `Closing position for ${position.asset}. Trigger Value: ${action.value}`, "warning");
                const closeResult = await this.tradeExecutor.closePosition(position.asset, Number(livePositionData.szi));
                
                if (closeResult.success) {
                    this.state.setInPosition(false);
                    this.lastTradeTime = new Date();
                }
            }
        } catch (error) {
            logger.error(`Error in managePositions loop: ${error.message}`);
        }
    }
}

const bot = new TradingBot();
bot.start();