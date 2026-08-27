import { randomBytes } from 'node:crypto';

const MAX_ATTRS = 24;
const MAX_TEXT = 160;
const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').replace(/\/$/, '');
const serviceName = String(process.env.OTEL_SERVICE_NAME || 'startrades-neon-royale').slice(0, 80);
const enabled = Boolean(endpoint);

const parseHeaders = (value = '') => Object.fromEntries(String(value).split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
  const index = part.indexOf('=');
  return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : [part, ''];
}));
const headers = { 'content-type': 'application/json', ...parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS) };
const traceId = () => randomBytes(16).toString('hex');
const spanId = () => randomBytes(8).toString('hex');
const toNano = (ms) => `${BigInt(Math.max(0, Math.trunc(ms))) * 1_000_000n}`;
const nowNano = () => toNano(Date.now());

function safeAttributes(input = {}) {
  const attributes = [];
  for (const [key, raw] of Object.entries(input).slice(0, MAX_ATTRS)) {
    if (/token|cookie|secret|authorization|service[_-]?role|payload|comment|nickname/i.test(key)) continue;
    const name = String(key).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
    if (!name) continue;
    let value;
    if (typeof raw === 'boolean') value = { boolValue: raw };
    else if (typeof raw === 'number' && Number.isFinite(raw)) value = Number.isInteger(raw) ? { intValue: String(raw) } : { doubleValue: raw };
    else if (raw !== null && raw !== undefined && ['string', 'bigint'].includes(typeof raw)) value = { stringValue: String(raw).slice(0, MAX_TEXT) };
    else continue;
    attributes.push({ key: name, value });
  }
  return attributes;
}

async function post(path, body) {
  if (!enabled) return false;
  try {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

function resourceAttributes() {
  return [
    { key: 'service.name', value: { stringValue: serviceName } },
    { key: 'deployment.environment.name', value: { stringValue: String(process.env.NODE_ENV || 'production').slice(0, 48) } },
  ];
}

export function createTelemetry() {
  const event = (name, attrs = {}) => {
    if (!enabled) return false;
    const start = nowNano();
    const payload = {
      resourceSpans: [{
        resource: { attributes: resourceAttributes() },
        scopeSpans: [{ scope: { name: 'startrades.telemetry', version: '1.0.0' }, spans: [{ traceId: traceId(), spanId: spanId(), name: String(name).slice(0, 120), kind: 1, startTimeUnixNano: start, endTimeUnixNano: start, attributes: safeAttributes(attrs), status: { code: 1 } }] }],
      }],
    };
    void post('/v1/traces', payload);
    return true;
  };

  const timing = (metricName, valueMs, attrs = {}) => {
    if (!enabled) return false;
    const timeUnixNano = nowNano();
    const payload = {
      resourceMetrics: [{
        resource: { attributes: resourceAttributes() },
        scopeMetrics: [{
          scope: { name: 'startrades.metrics', version: '1.0.0' },
          metrics: [{ name: String(metricName).slice(0, 120), unit: 'ms', gauge: { dataPoints: [{ timeUnixNano, asDouble: Math.max(0, Number(valueMs) || 0), attributes: safeAttributes(attrs) }] } }],
        }],
      }],
    };
    void post('/v1/metrics', payload);
    return true;
  };

  const gauge = (metricName, value, attrs = {}) => {
    if (!enabled) return false;
    const timeUnixNano = nowNano();
    const payload = { resourceMetrics: [{ resource: { attributes: resourceAttributes() }, scopeMetrics: [{ scope: { name: 'startrades.metrics', version: '1.0.0' }, metrics: [{ name: String(metricName).slice(0, 120), gauge: { dataPoints: [{ timeUnixNano, asDouble: Number(value) || 0, attributes: safeAttributes(attrs) }] } }] }] }] };
    void post('/v1/metrics', payload);
    return true;
  };

  return Object.freeze({ enabled, event, timing, gauge, status: () => ({ enabled, serviceName, endpointConfigured: Boolean(endpoint) }) });
}

export const telemetry = createTelemetry();
