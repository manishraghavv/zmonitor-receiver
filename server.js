const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

// ---------------------------------------------------------------------------
// Configuration (env-driven, with sane fallbacks for local dev)
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 6001;
const MONITOR_DIR = path.join(__dirname, 'monitor');
const BUCKET_NAME = process.env.MONITOR_BUCKET_NAME || "mkill";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const API_KEY = process.env.MONITOR_API_KEY; // required for auth
const SAVE_LOCAL_COPY = process.env.SAVE_LOCAL_COPY !== 'false'; // default true

if (!API_KEY) {
  console.warn(
    'WARNING: MONITOR_API_KEY is not set. The /api/monitor endpoint will reject ' +
    'all requests until this env var is configured.'
  );
}

const s3 = new S3Client({
  region: AWS_REGION,
});

// ---------------------------------------------------------------------------
// Ensure the monitor directory exists on startup (only if local copy is on)
// ---------------------------------------------------------------------------

if (SAVE_LOCAL_COPY && !fs.existsSync(MONITOR_DIR)) {
  fs.mkdirSync(MONITOR_DIR, { recursive: true });
  console.log(`Created monitor directory at ${MONITOR_DIR}`);
}

// ---------------------------------------------------------------------------
// Express app setup
// ---------------------------------------------------------------------------

const app = express();

// JSON body parser – allow payloads up to 10 MB (SAP monitoring data can be
// bulky when many entries are included).
app.use(express.json({ limit: '10mb' }));

// ---------------------------------------------------------------------------
// Auth middleware — simple API key check via header
// ---------------------------------------------------------------------------

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    return res.status(503).json({
      status: 'error',
      message: 'Server is not configured with an API key. Contact the administrator.',
    });
  }

  const provided = req.get('x-api-key');
  if (!provided || provided !== API_KEY) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized. Missing or invalid x-api-key header.',
    });
  }

  next();
}

// ---------------------------------------------------------------------------
// Helper: produce a filesystem-safe timestamp string
// ---------------------------------------------------------------------------

/**
 * Returns a timestamp string that is safe to use in filenames on all major
 * operating systems (Windows, Linux, macOS).  Colons are replaced with dashes
 * because Windows does not allow colons in file names.
 *
 * @returns {string} e.g. "2026-07-21T10-30-00-000Z"
 */
function getSafeTimestamp() {
  return new Date().toISOString().replace(/[:.]+/g, '-');
}

// ---------------------------------------------------------------------------
// Helper: extract a monitor-type label from the JSON payload
// ---------------------------------------------------------------------------

/**
 * Looks for a "monitor_type" or "type" field in the payload.  Returns the
 * value uppercased and sanitised (non-alphanumeric characters replaced with
 * underscores) so it is safe for use in a file name.
 *
 * @param {object} body - The parsed JSON request body.
 * @returns {string} A safe monitor-type label, defaulting to "unknown".
 */
function extractMonitorType(body) {
  const raw = body.monitor_type || body.type || 'unknown';
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, '_').toUpperCase();
}

// ---------------------------------------------------------------------------
// S3 upload helper — now throws on failure instead of swallowing the error
// ---------------------------------------------------------------------------

async function uploadToS3(filename, content) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: filename,
    Body: content,
    ContentType: "application/json",
  });

  await s3.send(command); // let caller handle/catch errors
  console.log(`Uploaded to S3: ${filename}`);
}

// ---------------------------------------------------------------------------
// POST /api/monitor
// ---------------------------------------------------------------------------

app.post('/api/monitor', requireApiKey, async (req, res) => {
  const body = req.body;

  // Guard against completely empty requests
  if (!body || Object.keys(body).length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'Request body is empty or not valid JSON.',
    });
  }

  const monitorType = extractMonitorType(body);
  const safeTimestamp = getSafeTimestamp();
  // Short random suffix avoids filename collisions on near-simultaneous requests
  const uniqueSuffix = crypto.randomBytes(4).toString('hex');

  // Build a filename like: SM12_2026-07-21T10-30-00-000Z_a1b2c3d4.json
  const filename = `${monitorType}_${safeTimestamp}_${uniqueSuffix}.json`;
  const jsonContent = JSON.stringify(body, null, 2);

  let localSaved = false;
  let s3Saved = false;
  const errors = [];

  // Save local copy (optional, non-fatal if it fails)
  if (SAVE_LOCAL_COPY) {
    try {
      const filePath = path.join(MONITOR_DIR, filename);
      await fsp.writeFile(filePath, jsonContent, 'utf-8');
      localSaved = true;
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Local save failed:`, err.message);
      errors.push(`local_save_failed: ${err.message}`);
    }
  }

  // Upload to S3 — this is the source of truth, so failure matters
  try {
    await uploadToS3(filename, jsonContent);
    s3Saved = true;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] S3 upload failed:`, err.message);
    errors.push(`s3_upload_failed: ${err.message}`);
  }

  console.log(`[${new Date().toISOString()}] Processed: ${filename} (local=${localSaved}, s3=${s3Saved})`);

  // If S3 upload failed, report it as an error — don't lie to the client
  if (!s3Saved) {
    return res.status(502).json({
      status: 'error',
      message: 'Failed to upload monitoring data to S3.',
      filename,
      localSaved,
      errors,
    });
  }

  return res.status(200).json({
    status: 'success',
    message: 'Monitoring data saved successfully.',
    filename,
    localSaved,
    s3Saved,
  });
});

// ---------------------------------------------------------------------------
// Basic health check (no auth required)
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`zmonitor-receiver server started on port ${PORT}`);
  if (SAVE_LOCAL_COPY) {
    console.log(`Monitoring data will also be saved to: ${MONITOR_DIR}`);
  }
});