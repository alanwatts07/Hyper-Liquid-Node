// src/components/RiskManager.js
import logger from '../utils/logger.js';

class RiskManager {
    constructor(config, db) {
        this.config = config;
        this.db = db;
        
        // This object will hold the dynamic state for each open position,
        // such as whether the fib trailing stop is active and its current price.
        // It's the JavaScript equivalent of the `position_data` dictionary in your Python script.
        this.positionState = {};
    }

    /**
     * Checks an open position against the current market and technical data to determine if it should be closed.
     * @param {Object} position - The position object from the database (e.g., { asset, entry_px, size }).
     * @param {Object} positionInfo - The live position info from the exchange, including ROE.
     * @param {number} currentPrice - The current market price of the asset.
     * @param {Object} analysis - The latest technical analysis data from TechnicalAnalyzer.
     * @returns {Promise<Object>} An object indicating if the position should be closed and why.
     */
    async checkPosition(position, positionInfo, currentPrice, analysis) {
        const { asset, entry_px } = position;
        const { stopLossPercentage, takeProfitPercentage } = this.config.risk;

        // Ensure analysis data is available
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
            };
            logger.info(`RiskManager: New position detected for ${asset}. Entry: $${entry_px}. Monitoring...`);
            await this.db.logEvent("NEW_POSITION_MONITORING", { asset, entry_price: entry_px });
        }

        const state = this.positionState[asset];

        // --- Main Stop Logic ---

        // 2. Check if the Fibonacci trailing stop should be activated or updated.
        // The trigger is when `fib_entry` crosses above the position's `entry_px`.
        if (fib_entry > entry_px) {
            if (!state.fibStopActive) {
                state.fibStopActive = true;
                state.stopPrice = wma_fib_0; // The stop loss is set to the wma_fib_0 value
                logger.info(`FIB-TRAIL ACTIVATED for ${asset}. fib_entry ($${fib_entry.toFixed(2)}) > entry ($${entry_px}).`);
                logger.info(`   Initial Stop Price set to wma_fib_0: $${wma_fib_0.toFixed(2)}`);
                await this.db.logEvent("FIB_STOP_ACTIVATED", { asset, trigger_value_fib_entry: fib_entry, wma_fib_0_stop_price: wma_fib_0, entry_price: entry_px });
            } 
            // If the stop is already active, only move it up, never down.
            else if (wma_fib_0 > state.stopPrice) {
                const oldStop = state.stopPrice;
                state.stopPrice = wma_fib_0;
                logger.info(`FIB-TRAIL UPDATED for ${asset}: Stop moved up from $${oldStop.toFixed(2)} to $${wma_fib_0.toFixed(2)}`);
            }
        }

        // 3. Check if any stop condition is met
        if (state.fibStopActive) {
            // Use the Fibonacci trailing stop
            if (currentPrice <= state.stopPrice) {
                logger.warn(`FIB-STOP HIT for ${asset}! Current Price: $${currentPrice.toFixed(2)} <= Stop Price: $${state.stopPrice.toFixed(2)}`);
                await this.db.logEvent("FIB_STOP_HIT", { asset, current_price: currentPrice, stop_price: state.stopPrice, roe, entry_price: entry_px });
                delete this.positionState[asset]; // Clean up state on close
                return { shouldClose: true, reason: "FIB-STOP", value: state.stopPrice };
            }
        } else {
            // Use the initial fixed percentage stop loss
            if (roe <= -stopLossPercentage) {
                logger.warn(`STOP-LOSS HIT for ${asset}! ROE: ${(roe * 100).toFixed(2)}% <= -${(stopLossPercentage * 100).toFixed(2)}%`);
                delete this.positionState[asset]; // Clean up state on close
                return { shouldClose: true, reason: "STOP-LOSS", value: `${(roe * 100).toFixed(2)}%` };
            }
        }

        // 4. Check for take profit (always active)
        if (roe >= takeProfitPercentage) {
            logger.success(`TAKE-PROFIT HIT for ${asset}! ROE: ${(roe * 100).toFixed(2)}% >= ${(takeProfitPercentage * 100).toFixed(2)}%`);
            delete this.positionState[asset]; // Clean up state on close
            return { shouldClose: true, reason: "TAKE-PROFIT", value: `${(roe * 100).toFixed(2)}%` };
        }

        // 5. If no conditions are met, do nothing
        return { shouldClose: false };
    }

    /**
     * Clears the state for a specific asset, typically called after a position is confirmed closed.
     * @param {string} asset The asset to clear from the state.
     */
    clearPositionState(asset) {
        if (this.positionState[asset]) {
            delete this.positionState[asset];
            logger.info(`RiskManager: Cleared state for closed position ${asset}.`);
        }
    }
}

export default RiskManager;