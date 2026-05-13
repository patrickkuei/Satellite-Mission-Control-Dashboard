/**
 * Anomaly detection contracts emitted by the Anomaly Engine.
 *
 * @packageDocumentation
 */
import { z } from 'zod';

/** Telemetry metrics monitored by the Anomaly Engine. */
export const TelemetryMetricSchema = z.enum(['voltage', 'temperature', 'attitude']);
/** Inferred type for {@link TelemetryMetricSchema}. */
export type TelemetryMetric = z.infer<typeof TelemetryMetricSchema>;

/** Anomaly severity tiers, ordered by escalation. */
export const AnomalySeveritySchema = z.enum(['warn', 'alert']);
/** Inferred type for {@link AnomalySeveritySchema}. */
export type AnomalySeverity = z.infer<typeof AnomalySeveritySchema>;

/**
 * An anomaly detected in a telemetry stream by the Anomaly Engine.
 *
 * Uses a rolling Z-score over 60 samples (1 minute at 1 Hz):
 * - `|Z| > 2` → severity `"warn"`
 * - `|Z| > 3` → severity `"alert"`
 *
 * Three consecutive anomalous samples are required before an alert is emitted
 * to avoid flapping on single-sample noise.
 */
export const AnomalySchema = z
  .object({
    /** UUID assigned at detection time. */
    id: z.string().uuid(),
    /** NORAD ID of the affected satellite. */
    satelliteId: z.number().int().positive(),
    /** Which telemetry metric tripped the threshold. */
    metric: TelemetryMetricSchema,
    /** Severity tier — UI uses this to color-code alerts. */
    severity: AnomalySeveritySchema,
    /** Signed Z-score at detection (sign indicates direction of deviation). */
    zscore: z.number(),
    /** ISO 8601 detection timestamp (matches sample timestamp). */
    timestamp: z.string().datetime(),
    /** Human-readable summary for the alert log + agent responses. */
    description: z.string().min(1),
  })
  .strict();

/** Inferred type for {@link AnomalySchema}. */
export type Anomaly = z.infer<typeof AnomalySchema>;
