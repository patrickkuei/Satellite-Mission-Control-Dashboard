import { createAnomalyService } from './anomaly.service.js';
import type { Telemetry } from '@orbit-ctrl/types';

function makeSample(overrides: Partial<Telemetry> = {}): Telemetry {
  return {
    satelliteId: 1,
    voltage: 28,
    temperature: 10,
    attitude: { pitch: 0, roll: 0, yaw: 0 },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Fill the 60-sample rolling window with alternating 26 V / 30 V readings
 * (mean = 28 V, stddev ≈ 2 V — well above the 0.5 V σ-floor). With a full
 * window, three subsequent spike samples only shift the mean by ~0.6 V,
 * keeping Z-scores stable and predictable.
 */
function warmUp(
  engine: ReturnType<typeof createAnomalyService>,
  satelliteId = 1,
  count = 60,
): void {
  for (let i = 0; i < count; i++) {
    engine.evaluate(makeSample({ satelliteId, voltage: i % 2 === 0 ? 26 : 30 }));
  }
}

describe('createAnomalyService', () => {
  describe('before MIN_SAMPLES', () => {
    it('returns no anomalies until 10 samples have been collected', () => {
      const engine = createAnomalyService();
      for (let i = 0; i < 9; i++) {
        expect(engine.evaluate(makeSample())).toHaveLength(0);
      }
    });
  });

  describe('σ-floor guard', () => {
    it('suppresses anomalies when all readings are identical (stddev = 0)', () => {
      const engine = createAnomalyService();
      // All identical → stddev = 0 < 0.5 V σ-floor → never fires.
      for (let i = 0; i < 15; i++) {
        expect(engine.evaluate(makeSample({ voltage: 28 }))).toHaveLength(0);
      }
    });
  });

  describe('debounce', () => {
    it('emits nothing on the first two consecutive threshold trips', () => {
      const engine = createAnomalyService();
      warmUp(engine);

      // 40 V → Z ≈ 3.5 (alert), but two trips are still under the debounce threshold.
      engine.evaluate(makeSample({ voltage: 40 }));
      expect(engine.evaluate(makeSample({ voltage: 40 }))).toHaveLength(0);
    });

    it('emits an alert on the third consecutive trip', () => {
      const engine = createAnomalyService();
      warmUp(engine);

      engine.evaluate(makeSample({ voltage: 40 }));
      engine.evaluate(makeSample({ voltage: 40 }));
      const result = engine.evaluate(makeSample({ voltage: 40 }));

      expect(result).toHaveLength(1);
      expect(result[0]!.metric).toBe('voltage');
      expect(result[0]!.severity).toBe('alert');
    });

    it('resets the debounce counter when the metric returns to nominal', () => {
      const engine = createAnomalyService();
      warmUp(engine);

      engine.evaluate(makeSample({ voltage: 40 }));
      engine.evaluate(makeSample({ voltage: 40 }));
      // Return to nominal — counter must reset.
      engine.evaluate(makeSample({ voltage: 28 }));

      // Two more trips — must NOT fire (counter started from zero).
      engine.evaluate(makeSample({ voltage: 40 }));
      expect(engine.evaluate(makeSample({ voltage: 40 }))).toHaveLength(0);
    });
  });

  describe('severity classification', () => {
    it('assigns "alert" severity for |Z| > 3 (≈ 3.5 at 40 V with 60-sample baseline)', () => {
      const engine = createAnomalyService();
      warmUp(engine);

      engine.evaluate(makeSample({ voltage: 40 }));
      engine.evaluate(makeSample({ voltage: 40 }));
      const [anomaly] = engine.evaluate(makeSample({ voltage: 40 }));

      expect(anomaly!.severity).toBe('alert');
      expect(Math.abs(anomaly!.zscore)).toBeGreaterThan(3);
    });

    it('assigns "warn" severity for 2 < |Z| ≤ 3 (≈ 2.4 at 34 V with 60-sample baseline)', () => {
      const engine = createAnomalyService();
      warmUp(engine);

      // 34 V → Z ≈ 2.4: above the warn threshold but below alert.
      engine.evaluate(makeSample({ voltage: 34 }));
      engine.evaluate(makeSample({ voltage: 34 }));
      const result = engine.evaluate(makeSample({ voltage: 34 }));

      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe('warn');
    });
  });

  describe('anomaly shape', () => {
    it('includes satelliteId, zscore, metric, description, and a valid UUID', () => {
      const engine = createAnomalyService();
      const ID = 42;
      warmUp(engine, ID);

      engine.evaluate(makeSample({ satelliteId: ID, voltage: 40 }));
      engine.evaluate(makeSample({ satelliteId: ID, voltage: 40 }));
      const [anomaly] = engine.evaluate(makeSample({ satelliteId: ID, voltage: 40 }));

      expect(anomaly!.satelliteId).toBe(ID);
      expect(anomaly!.metric).toBe('voltage');
      expect(typeof anomaly!.zscore).toBe('number');
      expect(anomaly!.description).toMatch(/voltage/i);
      expect(anomaly!.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });
});
