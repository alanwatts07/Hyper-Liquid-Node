// cleanup_database.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import config from './src/config.js';
import logger from './src/utils/logger.js';
import path from 'path';

const DB_FILE = path.resolve(process.cwd(), config.database.file);

/**
 * Main function to clean the database
 */
async function cleanupDatabase() {
    logger.info(`Connecting to database at: ${DB_FILE}`);
    let db;
    try {
        db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    } catch (error) {
        logger.error(`Could not open the database file at "${DB_FILE}".`);
        return;
    }

    try {
        logger.warn("Attempting to delete all 'BOT_TICK_ANALYSIS' events...");
        
        const result = await db.run("DELETE FROM events WHERE event_type = 'BOT_TICK_ANALYSIS'");
        
        if (result.changes > 0) {
            logger.success(`Successfully deleted ${result.changes} 'BOT_TICK_ANALYSIS' event(s).`);
        } else {
            logger.info("No 'BOT_TICK_ANALYSIS' events found to delete.");
        }

    } catch (error) {
        logger.error(`An error occurred during cleanup: ${error.message}`);
    } finally {
        await db.close();
        logger.info("Database connection closed.");
    }
}

// --- Run the cleanup script ---
cleanupDatabase();