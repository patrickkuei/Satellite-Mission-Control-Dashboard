/**
 * Telemetry sample contracts produced by the Telemetry Simulator at 1 Hz.
 *
 * @packageDocumentation
 */
import { z } from 'zod';

/**
 * Body-frame attitude (pitch / roll / yaw) of a satellite in degrees.
 *
 * Zero attitude means the body frame is aligned with the local orbital frame.
 * Real satellites maintain attitude within ~0.1° for science payloads.
 */
export const AttitudeSchema = z
  .object({
    /** Rotation about the body Y-axis (nose up/down), degrees. */
    pitch: z.number(),
    /** Rotation about the body X-axis (wing up/down), degrees. */
    roll: z.number(),
    /** Rotation about the body Z-axis (nose left/right), degrees. */
    yaw: z.number(),
  })
  .strict();

/** Inferred type for {@link AttitudeSchema}. */
export type Attitude = z.infer<typeof AttitudeSchema>;

/**
 * Simulated telemetry sample for a single satellite at one instant.
 *
 * Values are realistic synthetic data — voltage drops in eclipse, temperature
 * cycles with orbital phase, and attitude rates random-walk around zero. The
 * simulator injects anomalies in ~2% of samples.
 */
export const TelemetrySchema = z
  .object({
    /** NORAD ID of the satellite this telemetry belongs to. */
    satelliteId: z.number().int().positive(),
    /** Bus voltage in volts. Nominal 24–32 V; drops during eclipse passes. */
    voltage: z.number(),
    /** Internal temperature in degrees Celsius. Cycles -20 °C to +50 °C with orbit. */
    temperature: z.number(),
    /** Body-frame attitude angles. Small random walk around zero. */
    attitude: AttitudeSchema,
    /** ISO 8601 timestamp the sample was generated. */
    timestamp: z.string().datetime(),
  })
  .strict();

/** Inferred type for {@link TelemetrySchema}. */
export type Telemetry = z.infer<typeof TelemetrySchema>;
