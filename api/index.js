/**
 * Vercel Serverless Function — catch-all API handler.
 * All /api/* requests are forwarded to the Express app.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const { app, boot } = require('../backend/src/app');

// Ensure DB is seeded before the first request
let ready = false;
const readyPromise = boot().then(() => { ready = true; });

module.exports = async (req, res) => {
  if (!ready) await readyPromise;
  return app(req, res);
};
