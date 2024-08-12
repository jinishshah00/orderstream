import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes as S } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const instrumentations: any[] = [];
try { const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http'); instrumentations.push(new HttpInstrumentation()); } catch {}
try { const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express'); instrumentations.push(new ExpressInstrumentation()); } catch {}
try { const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg'); instrumentations.push(new PgInstrumentation()); } catch {}
try { const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis-4'); instrumentations.push(new RedisInstrumentation()); } catch {}
try { const { KafkajsInstrumentation } = require('opentelemetry-instrumentation-kafkajs'); instrumentations.push(new KafkajsInstrumentation()); } catch {}

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
  resource: new Resource({
    [S.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'orderstream-svc',
    [S.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  }),
  instrumentations,
});

function startSdkSafe() {
  try {
    const p: any = sdk.start();              // may be void OR a Promise
    if (p && typeof p.then === 'function') { // only attach handlers if Promise-like
      p.catch((e: any) => console.error('OTel init failed', e));
    }
  } catch (e) {
    console.error('OTel init failed (sync)', e);
  }
}

startSdkSafe();


process.on('SIGTERM', async () => { try { await sdk.shutdown(); } finally { process.exit(0); } });
process.on('SIGINT',  async () => { try { await sdk.shutdown(); } finally { process.exit(0); } });
export {};
