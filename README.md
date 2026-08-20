# zmonitor-receiver

A lightweight **Node.js + Express** HTTP server that receives SAP ABAP monitoring data (SM12, AL08, SM50 statistics, etc.) as JSON payloads sent via `POST` requests and persists each payload as a timestamped file on disk.

---

## Purpose

In an SAP ABAP environment, you may want to periodically capture system-monitoring snapshots — such as lock entries (SM12), current users (AL08), or process overviews (SM50) — and push them to an external store for historical analysis, dashboards, or alerting.

This receiver:

- Listens for `POST` requests containing the monitoring JSON payload
- Automatically extracts a monitor type from the payload (fields `monitor_type` or `type`)
- Saves each payload as a pretty-printed JSON file in the `monitor/` directory
- Names files so they never collide (e.g., `SM12_2026-07-21T10-30-00-000Z.json`)
- Returns a confirmation response to the caller (the ABAP program)

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or later (tested with v18 / v20 / v22)

---

## Installation

```bash
cd zmonitor-receiver
npm install
```

This installs the single runtime dependency: [Express](https://expressjs.com/).

---

## Usage

Start the server:

```bash
npm start
```

The server will log:

```
zmonitor-receiver server started on port 5000
Monitoring data will be saved to: /path/to/zmonitor-receiver/monitor
```

---

## Endpoint

### `POST http://<server-ip>:5000/api/monitor`

| Property   | Value                     |
|------------|---------------------------|
| Method     | `POST`                    |
| URL        | `http://<server-ip>:5000/api/monitor` |
| Content-Type | `application/json`       |
| Body limit | 10 MB                     |

#### Example request payload

```json
{
  "monitor_type": "SM12",
  "host": "sap-prod-01",
  "timestamp": "2026-07-21T10:30:00Z",
  "entries": [
    {
      "user": "JDOE",
      "client": "100",
      "table": "USR01",
      "lock_type": "E",
      "created_at": "2026-07-21T10:25:00Z"
    }
  ]
}
```

If your ABAP program uses a different field name (e.g. `"type"` instead of `"monitor_type"`), the server will pick that up automatically. If neither field is present, the type defaults to `"UNKNOWN"`.

#### Success response (HTTP 200)

```json
{
  "status": "success",
  "message": "Monitoring data saved successfully.",
  "filename": "SM12_2026-07-21T10-30-00-000Z.json"
}
```

#### Error response (HTTP 400 / 500)

```json
{
  "status": "error",
  "message": "Request body is empty or not valid JSON."
}
```

---

## Stored Files

All received payloads are saved as individual JSON files inside the `monitor/` directory:

```
monitor/
├── SM12_2026-07-21T10-30-00-000Z.json
├── AL08_2026-07-21T10-31-00-000Z.json
├── SM50_2026-07-21T10-32-00-000Z.json
└── .gitkeep
```

Each file is pretty-printed with 2-space indentation for easy manual inspection.

> **Note:** The `monitor/` folder contents are gitignored (see `.gitignore`) so that payload files are not committed to version control. The `.gitkeep` file ensures the folder itself is tracked.

---

## Project Structure

```
zmonitor-receiver/
├── server.js          # Express server & POST handler
├── package.json       # Project metadata & dependencies
├── .gitignore         # Git exclusion rules
├── README.md          # This file
└── monitor/
    └── .gitkeep       # Ensures the folder is tracked by git
```

---

## License

MIT
