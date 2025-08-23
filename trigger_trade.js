// trigger_trade.js
import fs from 'fs/promises';
import logger from './src/utils/logger.js';

const overrideFile = 'manual_override.json';

async function manageTrigger() {
    const command = process.argv[2]; // Get command line argument (e.g., 'buy' or 'clear')

    if (command === 'buy') {
        logger.warn("Injecting a manual 'BUY' signal via override file...");
        const overrideData = { signal: "buy", timestamp: new Date().toISOString() };
        await fs.writeFile(overrideFile, JSON.stringify(overrideData, null, 2));
        logger.success(`'${overrideFile}' created. Bot will trigger a buy on the next cycle.`);
    } else if (command === 'clear') {
        logger.info("Clearing manual override file...");
        try {
            await fs.unlink(overrideFile);
            logger.success(`'${overrideFile}' deleted.`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn(`'${overrideFile}' does not exist. Nothing to clear.`);
            } else {
                logger.error(`Error clearing file: ${error.message}`);
            }
        }
    } else {
        logger.error("Invalid command. Use 'buy' or 'clear'.");
        console.log("Usage: node trigger_trade.js [buy|clear]");
    }
}

manageTrigger();