// src/components/RiskManager.js
import logger from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

class RiskManager {
    constructor(config, db) {
        this.config = config;
        this.db = db;
        this.positionState = {};
    }

    async loadDynamicRiskParameters() {
        try {
            // Try to read live_risk.json
            const riskFilePath = this.config.files?.liveRisk || 'live_risk.json';
            const data = await fs.readFile(riskFilePath, 'utf8');
            const riskData = JSON.parse(data);
            
            // Return dynamic parameters if they exist
            if (riskData.liveStopLossPercentage !== undefined && riskData.liveTakeProfitPercentage !== undefined) {
                logger.info(`RiskManager: Using dynamic risk parameters - SL: ${(riskData.liveStopLossPercentage * 100).toFixed(1)}%, TP: ${(riskData.liveTakeProfitPercentage * 100).toFixed(1)}% (Strategy: ${riskData.strategy || 'N/A'})`);
                return {
                    stopLossPercentage: riskData.liveStopLossPercentage,
                    takeProfitPercentage: riskData.liveTakeProfitPercentage,
                    sizeMultiplier: riskData.sizeMultiplier || 1.0,
                    strategy: riskData.strategy || 'DYNAMIC',
                    regime: riskData.regime || 'UNKNOWN'
                };
            }
        } catch (error) {
            // File doesn't exist or can't be read, use config defaults
            logger.info('RiskManager: No dynamic risk data available, using config defaults');
        }

        // Fallback to config defaults
        return {
            stopLossPercentage: this.config.risk.stopLossPercentage,
            takeProfitPercentage: this.config.risk.takeProfitPercentage,
            sizeMultiplier: 1.0,
            strategy: 'DEFAULT',
            regime: 'CONFIG_DEFAULT'
        };
    }

    async checkPosition(position, positionInfo, currentPrice, analysis) {
        const { asset, entry_px } = position;
        
        if (!analysis || analysis.wma_fib_0 === null || analysis.fib_entry === null) {
            logger.warn(`RiskManager: Skipping check for ${asset} due to missing analysis data.`);
            return { shouldClose: false };
        }

        // Load dynamic risk parameters (regime-based or config defaults)
        const riskParams = await this.loadDynamicRiskParameters();
        const { stopLossPercentage, takeProfitPercentage } = riskParams;

        const { wma_fib_0, fib_entry } = analysis;
        const roe = parseFloat(positionInfo.returnOnEquity);

        // ... (Initialize state for a new position - no changes here)
        if (!this.positionState[asset]) {
            this.positionState[asset] = {
                fibStopActive: false,
                stopPrice: null,
                entryTime: new Date(),
            };
            logger.info(`RiskManager: New position detected for ${asset}. Entry: $${entry_px}. Monitoring...`);
            await this.db.logEvent("NEW_POSITION_MONITORING", { asset, entry_price: entry_px });
        }

        // ... (The rest of the stop-loss and fib-trail logic remains exactly the same)
        const state = this.positionState[asset];
        const now = new Date();
        const timeInTradeMs = now - state.entryTime;
        const gracePeriodMs = 60 * 1000;

        if (timeInTradeMs > gracePeriodMs) {
            if (fib_entry > entry_px) {
                if (!state.fibStopActive) {
                    state.fibStopActive = true;
                    state.stopPrice = wma_fib_0;
                    logger.info(`FIB-TRAIL ACTIVATED for ${asset}. fib_entry ($${fib_entry.toFixed(2)}) > entry ($${entry_px.toFixed(2)}).`);
                    logger.info(`   Initial Stop Price set to wma_fib_0: $${wma_fib_0.toFixed(2)}`);
                    await this.db.logEvent("FIB_STOP_ACTIVATED", { asset, trigger_value_fib_entry: fib_entry, wma_fib_0_stop_price: wma_fib_0, entry_price: entry_px });
                } else if (wma_fib_0 > state.stopPrice) {
                    const oldStop = state.stopPrice;
                    state.stopPrice = wma_fib_0;
                    logger.info(`FIB-TRAIL UPDATED for ${asset}: Stop moved up from $${oldStop.toFixed(2)} to $${wma_fib_0.toFixed(2)}`);
                }
            }
        } else {
            logger.info(`RiskManager: In grace period for ${asset}. Fib-trail activation is paused.`);
        }

        if (state.fibStopActive) {
            logger.info(`RiskManager: Checking Fib-Trail Stop for ${asset}. Price: ${currentPrice.toFixed(2)}, Stop: ${state.stopPrice.toFixed(2)}`);
            if (currentPrice <= state.stopPrice) {
                logger.warn(`FIB-STOP HIT for ${asset}! Current Price: $${currentPrice.toFixed(2)} <= Stop Price: $${state.stopPrice.toFixed(2)}`);
                await this.db.logEvent("FIB_STOP_HIT", { asset, current_price: currentPrice, stop_price: state.stopPrice, roe, entry_price: entry_px });
                return { shouldClose: true, reason: "FIB-STOP", value: state.stopPrice };
            }
        } else {
            logger.info(`RiskManager: Checking Fixed Stop for ${asset}. ROE: ${(roe * 100).toFixed(2)}%, Trigger: -${(stopLossPercentage * 100).toFixed(2)}%`);
            if (roe <= -stopLossPercentage) {
                logger.warn(`STOP-LOSS HIT for ${asset}! ROE: ${(roe * 100).toFixed(2)}% <= -${(stopLossPercentage * 100).toFixed(2)}%`);
                await this.db.logEvent("STOP-LOSS HIT", { asset, reason: "STOP-LOSS", value: `${(roe * 100).toFixed(2)}%` });
                return { shouldClose: true, reason: "STOP-LOSS", value: `${(roe * 100).toFixed(2)}%` };
            }
        }

        // 2. This check now uses the DYNAMIC takeProfitPercentage set above
        logger.info(`RiskManager: Checking Take Profit for ${asset}. ROE: ${(roe * 100).toFixed(2)}%, Trigger: ${(takeProfitPercentage * 100).toFixed(2)}% (State: ${analysis.bull_state ? 'BULL' : 'BEAR'})`);
        if (roe >= takeProfitPercentage) {
            logger.info(`TAKE-PROFIT HIT for ${asset}! ROE: ${(roe * 100).toFixed(2)}% >= ${(takeProfitPercentage * 100).toFixed(2)}%`);
            await this.db.logEvent("TAKE-PROFIT HIT", { asset, reason: "TAKE-PROFIT", value: `${(roe * 100).toFixed(2)}%` });
            return { shouldClose: true, reason: "TAKE-PROFIT", value: `${(roe * 100).toFixed(2)}%` };
        }

        return {
            shouldClose: false,
            liveTakeProfitPercentage: takeProfitPercentage,
            liveStopLossPercentage: stopLossPercentage,
            strategy: riskParams.strategy,
            regime: riskParams.regime,
            sizeMultiplier: riskParams.sizeMultiplier
        };
    }

    clearPositionState(asset) {
        if (this.positionState[asset]) {
            delete this.positionState[asset];
            logger.info(`RiskManager: Cleared state for closed position ${asset}.`);
        }
    }
}

export default RiskManager;
