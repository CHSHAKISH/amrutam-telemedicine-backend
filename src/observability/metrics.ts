import client from 'prom-client';

// Initialize Prometheus Register
export const register = new client.Registry();

// Add default system metrics (CPU, Memory, Event Loop Lag, GC, File Descriptors)
client.collectDefaultMetrics({
  register,
  prefix: 'amrutam_',
});

// Custom Metrics

// 1. HTTP Request Counter
export const httpRequestCounter = new client.Counter({
  name: 'amrutam_http_requests_total',
  help: 'Total count of incoming HTTP requests processed',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// 2. HTTP Request Duration Histogram (Custom buckets matching SLAs: <200ms reads, <500ms writes)
export const httpRequestDurationHistogram = new client.Histogram({
  name: 'amrutam_http_request_duration_seconds',
  help: 'Histogram of HTTP request durations in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 2, 5],
  registers: [register],
});

// 3. Active Consultations Gauge
export const activeConsultationsGauge = new client.Gauge({
  name: 'amrutam_active_consultations',
  help: 'Current number of active/ongoing telemedicine consultations',
  registers: [register],
});

// 4. Distributed Lock Contention Counter
export const lockContentionCounter = new client.Counter({
  name: 'amrutam_lock_contentions_total',
  help: 'Total number of Redis distributed lock contentions/collisions during booking',
  labelNames: ['resource_type', 'status'],
  registers: [register],
});

// 5. Database Connection Pool Metrics
export const dbQueryDurationHistogram = new client.Histogram({
  name: 'amrutam_db_query_duration_seconds',
  help: 'Database query execution time in seconds',
  labelNames: ['operation', 'model'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

