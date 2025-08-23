// src/database/DatabaseManager.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import logger from '../utils/logger.js';

class DatabaseManager {
    constructor(dbFile) {
        this.dbFile = dbFile;
        this.db = null;
    }

    /**
     * Connects to the SQLite database and creates tables if they don't exist.
     */
    async connect() {
        try {
            this.db = await open({
                filename: this.dbFile,
                driver: sqlite3.Database
            });
            logger.info(`Connected to database: ${this.dbFile}`);
            await this.createTables();
        } catch (error) {
            logger.error(`Error connecting to database: ${error.message}`);
            throw error;
        }
    }

    /**
     * Creates the necessary tables for the bot's operation.
     */
    async createTables() {
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS prices (
                timestamp TEXT PRIMARY KEY,
                price REAL NOT NULL
            );
        `);
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS positions (
                asset TEXT PRIMARY KEY,
                direction TEXT,
                size REAL,
                entry_px REAL,
                status TEXT, -- 'OPEN' or 'CLOSED'
                last_update TEXT NOT NULL
            );
        `);
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                details TEXT
            );
        `);
        logger.info("Database tables created or already exist.");
    }

    /**
     * Saves a new price record to the database.
     * @param {Object} priceData - An object with { timestamp, price }.
     */
    async savePriceData(priceData) {
        const { timestamp, price } = priceData;
        try {
            await this.db.run(
                'INSERT OR IGNORE INTO prices (timestamp, price) VALUES (?, ?)',
                [timestamp, price]
            );
        } catch (error) {
            logger.error(`Error saving price data: ${error.message}`);
        }
    }

    /**
     * Retrieves all historical price data.
     * @returns {Promise<Array<Object>>} An array of all price records.
     */
    async getHistoricalPriceData() {
        try {
            const data = await this.db.all('SELECT timestamp, price FROM prices ORDER BY timestamp ASC');
            return data;
        } catch (error) {
            logger.error(`Error getting historical price data: ${error.message}`);
            return [];
        }
    }

    /**
     * Inserts a new position or updates an existing one.
     * @param {string} asset - The asset symbol (e.g., "SOL").
     * @param {string} direction - "LONG" or "SHORT".
     * @param {number} size - The size of the position.
     * @param {number} entry_px - The average entry price.
     * @param {string} status - "OPEN" or "CLOSED".
     */
    async updatePosition(asset, direction, size, entry_px, status) {
        const timestamp = new Date().toISOString();
        try {
            await this.db.run(`
                INSERT INTO positions (asset, direction, size, entry_px, status, last_update)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset) DO UPDATE SET
                    direction = excluded.direction,
                    size = excluded.size,
                    entry_px = excluded.entry_px,
                    status = excluded.status,
                    last_update = excluded.last_update;
            `, [asset, direction, size, entry_px, status, timestamp]);
            logger.info(`Position updated for ${asset}: ${status}`);
        } catch (error) {
            logger.error(`Error updating position for ${asset}: ${error.message}`);
        }
    }

    /**
     * Retrieves all positions with a status of 'OPEN'.
     * @returns {Promise<Array<Object>>} An array of open positions.
     */
    async getOpenPositions() {
        try {
            const positions = await this.db.all("SELECT * FROM positions WHERE status = 'OPEN'");
            return positions;
        } catch (error) {
            logger.error(`Error getting open positions: ${error.message}`);
            return [];
        }
    }

    /**
     * Logs a significant event to the database.
     * @param {string} eventType - The type of event (e.g., "TRADE_EXECUTED").
     * @param {Object} details - A JSON object with relevant details.
     */
    async logEvent(eventType, details) {
        const timestamp = new Date().toISOString();
        const detailsJson = JSON.stringify(details);
        try {
            await this.db.run(
                'INSERT INTO events (timestamp, event_type, details) VALUES (?, ?, ?)',
                [timestamp, eventType, detailsJson]
            );
        } catch (error) {
            logger.error(`Error logging event ${eventType}: ${error.message}`);
        }
    }
}

export default DatabaseManager;