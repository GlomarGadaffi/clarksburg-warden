# bcd325-dashboard

BearSentinel dashboard for RF network telemetry. decodes, visualizes, and persists radio network traffic directly from Uniden hardware (specifically BCD325P2 scanners). two operational modes: **ANALYST** (forensic archive) and **SENTINEL** (real-time alerting).

## modes

**ANALYST**: forensic / historical review
- browse archived traffic by date range, frequency, talkgroup, unit
- export to CSV for external analysis
- correlate with GIS / timeline data

**SENTINEL**: real-time monitoring
- live stream from scanner(s)
- threshold-based alerts (activity on priority frequencies/talkgroups)
- geospatial heat maps (if GPS-tagged scanner positions)
- statistical anomaly detection (unusual activity patterns)

## architecture

**data ingest**:
- serial input from BCD325P2 (structured JSON via bcd325-splunk-addon)
- multiple scanner support (aggregated streams)

**processing**:
- frequency classification (public safety bands, commercial, amateur, other)
- talkgroup lookup from RadioReference
- unit ID tracking (persistent fleet membership)
- signal quality metrics

**display** (React/TypeScript):
- real-time activity timeline
- frequency waterfall / heatmap
- talkgroup call history
- unit detail pages (call log, associations)

## integration

consumes output from:
- **bcd325-splunk-addon** (Splunk ingest, or direct stream)
- **p25-trunk-logger** (P25 control channel logs)
- optionally: external CAD feeds, tactical maps

## notes

designed for small multi-scanner networks (police/fire dispatch centers, RF utilities).
