// Simple Express server to serve SQLite database API endpoints
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001; // Using 3001 to avoid conflicts with existing services

// Enable CORS for frontend
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'], // Vite dev server ports
  credentials: true
}));

app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'salt_lake_county_lir_parcels.db');
let db;

try {
  db = new Database(dbPath, { readonly: true });
  console.log('Connected to SQLite database');
} catch (error) {
  console.error('Failed to connect to database:', error);
  process.exit(1);
}

// Helper function to handle database queries safely
function safeQuery(query, params = []) {
  try {
    return db.prepare(query).all(params);
  } catch (error) {
    console.error('Database query error:', error);
    throw new Error('Database query failed');
  }
}

function safeGet(query, params = []) {
  try {
    return db.prepare(query).get(params);
  } catch (error) {
    console.error('Database query error:', error);
    throw new Error('Database query failed');
  }
}

// API Endpoints

// Get owner data with pagination and search
app.get('/api/owner-data', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 items per page
    const searchTerm = req.query.search;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM owner_data';
    let countQuery = 'SELECT COUNT(*) as total FROM owner_data';
    let params = [];
    let countParams = [];

    if (searchTerm) {
      const searchClause = ' WHERE owner_name LIKE ? OR property_address LIKE ? OR parcel_id LIKE ?';
      query += searchClause;
      countQuery += searchClause;
      const searchParam = `%${searchTerm}%`;
      params = [searchParam, searchParam, searchParam];
      countParams = [searchParam, searchParam, searchParam];
    }

    query += ' ORDER BY last_updated DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const data = safeQuery(query, params);
    const totalResult = safeGet(countQuery, countParams);
    const total = totalResult.total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      data,
      total,
      page,
      totalPages,
      limit
    });
  } catch (error) {
    console.error('Error fetching owner data:', error);
    res.status(500).json({ error: 'Failed to fetch owner data' });
  }
});

// Get work queue data
app.get('/api/work-queue', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const status = req.query.status;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM work_queue';
    let countQuery = 'SELECT COUNT(*) as total FROM work_queue';
    let params = [];
    let countParams = [];

    if (status) {
      query += ' WHERE status = ?';
      countQuery += ' WHERE status = ?';
      params = [status];
      countParams = [status];
    }

    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const data = safeQuery(query, params);
    const totalResult = safeGet(countQuery, countParams);
    const total = totalResult.total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      data,
      total,
      page,
      totalPages,
      limit
    });
  } catch (error) {
    console.error('Error fetching work queue:', error);
    res.status(500).json({ error: 'Failed to fetch work queue data' });
  }
});

// Get worker status
app.get('/api/worker-status', (req, res) => {
  try {
    const data = safeQuery('SELECT * FROM worker_status ORDER BY last_seen DESC');
    res.json(data);
  } catch (error) {
    console.error('Error fetching worker status:', error);
    res.status(500).json({ error: 'Failed to fetch worker status' });
  }
});

// Get scraping progress
app.get('/api/scraping-progress', (req, res) => {
  try {
    const data = safeGet('SELECT * FROM scraping_progress');
    res.json(data || {
      total_parcels: 0,
      completed: 0,
      pending: 0,
      in_progress: 0,
      failed: 0,
      completion_percentage: 0
    });
  } catch (error) {
    console.error('Error fetching scraping progress:', error);
    res.status(500).json({ error: 'Failed to fetch scraping progress' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Database API server is running' });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Database API server running on http://localhost:${PORT}`);
  console.log(`Database path: ${dbPath}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down database API server...');
  if (db) {
    db.close();
  }
  process.exit(0);
});

module.exports = app;