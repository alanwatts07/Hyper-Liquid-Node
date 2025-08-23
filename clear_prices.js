// clear_prices.js
import DatabaseManager from './src/database/DatabaseManager.js';
import logger from './src/utils/logger.js';
import config from './src/config.js';

/**
 * A utility to delete all records from the 'prices' table.
 * Run this before backfilling to ensure a clean slate.
 *
 * Usage: node clear_prices.js
 */
async function clearPrices() {
    logger.info("--- Price Data Clearing Utility ---");

    const db = new DatabaseManager(config.database.file);
    await db.connect();

    logger.warn("This will delete ALL entries from the 'prices' table.");
    
    try {
        const result = await db.db.run('DELETE FROM prices');
        logger.success(`Successfully deleted ${result.changes} price records.`);
        logger.info("The database is now ready for a clean backfill.");
    } catch (error) {
        logger.error(`Failed to clear prices: ${error.message}`);
    }
}

clearPrices();