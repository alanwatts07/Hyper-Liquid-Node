import logger from '../utils/logger.js';

class RiskManager {
    constructor(config, db) {
        this.config = config;
        this.db = db;
        this.positionState = {};
    }

    async checkPosition(position, positionInfo, currentPrice, analysis) {
        const { asset, entry_px } = position;
        const { stopLossPercentage, takeProfitPercentage } = this.config.risk;

        if (!analysis || analysis.wma_fib_0 === null || analysis.fib_entry === null) {
            logger.warn(`RiskManager: Skipping check for ${asset} due to missing analysis data.`);
            return { shouldClose: false };
        }

        const { wma_fib_0, fib_entry } = analysis;
        const roe = parseFloat(positionInfo.returnOnEquity);

        // 1. Initialize state for a newly detected position
        if (!this.positionState[asset]) {
            this.positionState[asset] = {
                fibStopActive: false,
                stopPrice: null,
                entryTime: new Date(), // <-- Track when the position was first seen
            };
            logger.info(`RiskManager: New position detected for ${asset}. Entry: $${entry_px}. Monitoring...`);
            await this.db.logEvent("NEW_POSITION_MONITORING", { asset, entry_price: entry_px });
        }

        const state = this.positionState[asset];
        const now = new Date();
        const timeInTradeMs = now - state.entryTime;
        const gracePeriodMs = 60 * 1000; // 60-second grace period

        // --- Main Stop Logic ---

        // 2. Check if the Fibonacci trailing stop can be activated or updated.
        // It can only activate AFTER the grace period.
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


        // 3. Check if any stop condition is met
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
                return { shouldClose: true, reason: "STOP-LOSS", value: `${(roe * 100).toFixed(2)}%` };
            }
        }

        // 4. Check for take profit (always active)
        logger.info(`RiskManager: Checking Take Profit for ${asset}. ROE: ${(roe * 100).toFixed(2)}%, Trigger: ${(takeProfitPercentage * 100).toFixed(2)}%`);
        if (roe >= takeProfitPercentage) {
            logger.info(`TAKE-PROFIT HIT for ${asset}! ROE: ${(roe * 100).toFixed(2)}% >= ${(takeProfitPercentage * 100).toFixed(2)}%`);
            return { shouldClose: true, reason: "TAKE-PROFIT", value: `${(roe * 100).toFixed(2)}%` };
        }

        // 5. If no conditions are met, do nothing
        return { shouldClose: false };
    }

    clearPositionState(asset) {
        if (this.positionState[asset]) {
            delete this.positionState[asset];
            logger.info(`RiskManager: Cleared state for closed position ${asset}.`);
        }
    }
}

export default RiskManager;