// backfill_data.js
import fs from 'fs/promises';
import DatabaseManager from './src/database/DatabaseManager.js';
import logger from './src/utils/logger.js';
import config from './src/config.js';

/**
 * A standalone script to read a JSON file of historical prices and
 * load them into the bot's database.
 *
 * Usage: node backfill_data.js
 */
async function backfill() {
    logger.info("--- Database Backfill Utility ---");
    const inputFile = 'historical_prices.json';

    try {
        // 1. Read the historical data from the JSON file
        logger.info(`Reading historical data from ${inputFile}...`);
        const historicalData = JSON.parse(await fs.readFile(inputFile, 'utf8'));

        if (!Array.isArray(historicalData) || historicalData.length === 0) {
            logger.error("Input file is empty or not a valid JSON array. Aborting.");
            return;
        }

        logger.success(`Loaded ${historicalData.length} price records from file.`);

        // 2. Connect to the database
        const db = new DatabaseManager(config.database.file);
        await db.connect();

        // 3. Insert all records into the database
        logger.info("Starting database insertion... This may take a moment for large files.");
        
        let insertedCount = 0;
        // Using a transaction is much faster for bulk inserts
        await db.db.run('BEGIN TRANSACTION;');

        for (const record of historicalData) {
            if (record.timestamp && record.price) {
                try {
                    const result = await db.db.run(
                        'INSERT OR IGNORE INTO prices (timestamp, price) VALUES (?, ?)',
                        [record.timestamp, record.price]
                    );
                    if (result.changes > 0) {
                        insertedCount++;
                    }
                } catch (e) {
                    // Ignore constraint errors if a timestamp already exists, but log others
                    if (!e.message.includes('UNIQUE constraint failed')) {
                        logger.error(`Failed to insert record ${record.timestamp}: ${e.message}`);
                    }
                }
            }
        }
        
        await db.db.run('COMMIT;');

        logger.success("--- Backfill Complete! ---");
        logger.info(`Total records in file: ${historicalData.length}`);
        logger.info(`New records inserted:  ${insertedCount}`);
        logger.info("The database is now populated with historical data.");

    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.error(`Error: The file '${inputFile}' was not found in the project directory.`);
        } else {
            logger.error(`An unexpected error occurred: ${error.message}`);
        }
        await db.db.run('ROLLBACK;'); // Rollback transaction on error
    }
}

backfill();