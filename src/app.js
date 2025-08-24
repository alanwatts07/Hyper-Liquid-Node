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
            // VVVVVV --- ADD THE LOGGING CALL RIGHT HERE --- VVVVVV
            await this.db.logEvent('BOT_TICK_ANALYSIS', { analysis: this.latestAnalysis, signal: signal }); // <-- ADD THIS LINE
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
            // Trust the position.json file as the source of truth for the position's existence and entry data.
            const positionFromFile = JSON.parse(await fs.readFile(POSITION_FILE, 'utf8'));
            const positionForRiskCheck = { asset: positionFromFile.coin, entry_px: parseFloat(positionFromFile.entryPx) };

            // Fetch live data ONLY for ROE and live size.
            const clearinghouseState = await this.tradeExecutor.getClearinghouseState();
            if (!clearinghouseState || !Array.isArray(clearinghouseState.assetPositions)) {
                logger.warn("Could not get valid clearinghouse state for ROE. Skipping this check.");
                return;
            }

            const livePosition = clearinghouseState.assetPositions.find(p => p && p.position && p.position.coin === positionForRiskCheck.asset);
            if (!livePosition) {
                 logger.warn(`Could not find live position details for ${positionForRiskCheck.asset} to calculate ROE. Skipping this check.`);
                 return;
            }
            const livePositionData = livePosition.position;

            const currentPrice = await this.collector.getCurrentPrice(positionForRiskCheck.asset);
            if (!currentPrice) {
                logger.warn(`Could not fetch current price for ${positionForRiskCheck.asset}. Skipping this check.`);
                return;
            }

            const action = await this.riskManager.checkPosition(positionForRiskCheck, livePositionData, currentPrice, this.latestAnalysis);

            const riskData = {
                asset: positionForRiskCheck.asset,
                entryPrice: positionForRiskCheck.entry_px,
                currentPrice: currentPrice,
                roe: (livePositionData.returnOnEquity * 100).toFixed(2) + '%',
                ...this.riskManager.positionState[positionForRiskCheck.asset]
            };
            await fs.writeFile('live_risk.json', JSON.stringify(riskData, null, 2));

            if (action.shouldClose) {
                await this.notifier.send(`${action.reason} Hit!`, `Closing position for ${positionForRiskCheck.asset}. Trigger Value: ${action.value}`, "warning");
                const closeResult = await this.tradeExecutor.closePosition(positionForRiskCheck.asset, Number(livePositionData.szi));
                
                if (closeResult.success) {
                    this.state.setInPosition(false);
                    // Cooldown is NOT set on close
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