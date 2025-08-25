// src/components/StateManager.js
import logger from '../utils/logger.js';
import fs from 'fs/promises';

const POSITION_FILE = 'position.json';

class StateManager {
    constructor(db, tradeExecutor) {
        this.db = db;
        this.tradeExecutor = tradeExecutor;
        this.state = { inPosition: false, triggerArmed: false };
    }

    async loadInitialState() {
        logger.info("StateManager: Loading initial state from Hyperliquid exchange...");
        try {
            const clearinghouseState = await this.tradeExecutor.getClearinghouseState();
            if (!clearinghouseState || !Array.isArray(clearinghouseState.assetPositions)) {
                throw new Error("Could not fetch valid asset position data.");
            }
            const openPositions = clearinghouseState.assetPositions.filter(p => p && p.position && Number(p.position.szi) !== 0);

            if (openPositions.length > 0) {
                const livePosition = openPositions[0].position;
                logger.warn(`Found existing open position for ${livePosition.coin}! Creating ${POSITION_FILE}.`);
                await fs.writeFile(POSITION_FILE, JSON.stringify(livePosition, null, 2));

                await this.db.updatePosition(livePosition.coin, Number(livePosition.szi) > 0 ? "LONG" : "SHORT", Math.abs(Number(livePosition.szi)), Number(livePosition.entryPx), "OPEN");
                this.state.inPosition = true;

            } else {
                logger.info(`No open positions found on exchange. Ensuring ${POSITION_FILE} is deleted.`);
                await this.deletePositionFile();
                this.state.inPosition = false;
            }
        } catch (error) {
            logger.error(`CRITICAL: Failed to load initial state: ${error.message}`);
            this.state.inPosition = false;
        }
        this.state.triggerArmed = false;
    }

    async deletePositionFile() {
        try {
            await fs.unlink(POSITION_FILE);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`Error deleting ${POSITION_FILE}: ${error.message}`);
            }
        }
    }

    isInPosition() { return this.state.inPosition; }
    setInPosition(status) { this.state.inPosition = status; }

    // --- THIS IS THE CORRECTED FUNCTION ---
    isTriggerArmed() { return this.state.triggerArmed; } // FIX: Was this.state.isTriggerArmed

    setTriggerArmed(status) {
        if (this.state.triggerArmed !== status) {
            this.state.triggerArmed = status;
            logger.info(`StateManager: Trigger has been ${status ? 'ARMED' : 'DISARMED'}.`);
        }
    }
}

export default StateManager;