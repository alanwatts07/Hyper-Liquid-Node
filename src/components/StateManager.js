// src/components/StateManager.js
import logger from '../utils/logger.js';
import fs from 'fs/promises';

class StateManager {
    constructor(db, tradeExecutor, config) {
        this.db = db;
        this.tradeExecutor = tradeExecutor;
        this.config = config;
        this.state = { inPosition: false, triggerArmed: false };
    }

    // Token-specific file path methods
    getPositionFile() {
        return this.config.files?.position || 'position.json';
    }

    getRiskFile() {
        return this.config.files?.liveRisk || 'live_risk.json';
    }

    async loadInitialState() {
        logger.info("StateManager: Loading initial state from Hyperliquid exchange...");
        try {
            //... logic to check for open positions is the same ...
            const clearinghouseState = await this.tradeExecutor.getClearinghouseState();
            if (!clearinghouseState || !Array.isArray(clearinghouseState.assetPositions)) {
                throw new Error("Could not fetch valid asset position data.");
            }
            const openPositions = clearinghouseState.assetPositions.filter(p => p && p.position && Number(p.position.szi) !== 0);


            if (openPositions.length > 0) {
                // ... this part remains the same ...
                const livePosition = openPositions[0].position;
                const positionFile = this.getPositionFile();
                logger.warn(`Found existing open position for ${livePosition.coin}! Creating ${positionFile}.`);
                await fs.writeFile(positionFile, JSON.stringify(livePosition, null, 2));

                await this.db.updatePosition(livePosition.coin, Number(livePosition.szi) > 0 ? "LONG" : "SHORT", Math.abs(Number(livePosition.szi)), Number(livePosition.entryPx), "OPEN");
                this.state.inPosition = true;

            } else {
                 // --- 2. THIS IS THE KEY CHANGE ---
                logger.info(`No open positions found on exchange. Ensuring local state files are deleted.`);
                await this.deleteFile(this.getPositionFile());
                await this.deleteFile(this.getRiskFile()); // <-- ADD THIS LINE
                this.state.inPosition = false;
            }
        } catch (error) {
            logger.error(`CRITICAL: Failed to load initial state: ${error.message}`);
            this.state.inPosition = false;
        }
        this.state.triggerArmed = false;
    }

    // --- 3. RENAME THIS FUNCTION FOR CLARITY ---
    async deleteFile(fileName) {
        try {
            await fs.unlink(fileName);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`Error deleting ${fileName}: ${error.message}`);
            }
        }
    }
    // ... rest of the file is the same ...
    isInPosition() { return this.state.inPosition; }
    setInPosition(status) { this.state.inPosition = status; }

 
    isTriggerArmed() { return this.state.triggerArmed; }
    setTriggerArmed(status) {
        if (this.state.triggerArmed !== status) {
            this.state.triggerArmed = status;
            logger.info(`StateManager: Trigger has been ${status ? 'ARMED' : 'DISARMED'}.`);
        }
    }
}

export default StateManager;