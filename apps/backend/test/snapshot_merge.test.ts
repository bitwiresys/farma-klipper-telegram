import { describe, expect, it } from 'vitest';

// env.ts parses at import time, so set env BEFORE importing backend modules
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_jwt_secret_1234567890';
process.env.TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ?? '123456:TESTTOKEN';
process.env.TELEGRAM_WEBAPP_URL =
  process.env.TELEGRAM_WEBAPP_URL ?? 'https://example.com';
process.env.PRINTER_API_KEY_ENC_KEY =
  process.env.PRINTER_API_KEY_ENC_KEY ?? 'test_printer_api_key_enc_key_123456';

describe('snapshot merge telemetry', () => {
  it('fills telemetry fields from gcode_move/motion_report/fan and chamber sensor', () => {
    // Import lazily so env.ts sees the test env values
    const modPromise = import('../src/printer_runtime.js');
    return modPromise.then(({ __computeSnapshotFromStatusForTest }) => {
      const { snapshot } = __computeSnapshotFromStatusForTest({
        print_stats: {
          state: 'printing',
          filename: 'test.gcode',
          print_duration: 100,
          info: { current_layer: 1, total_layer: 10 },
        },
        virtual_sdcard: { progress: 0.5 },
        display_status: { progress: 0.5 },
        toolhead: {
          position: [1, 2, 3, 4],
          max_velocity: 300,
          max_accel: 2000,
        },
        gcode_move: {
          gcode_position: [10, 20, 30, 40],
          speed: 150,
          speed_factor: 0.8,
          extrude_factor: 0.9,
        },
        motion_report: {
          live_position: [11, 22, 33, 44],
          live_velocity: 55,
        },
        fan: {
          speed: 0.5,
          rpm: 1234,
        },
        'temperature_sensor chamber': {
          temperature: 42.5,
        },
      });

      expect(snapshot.position?.commanded).toEqual({ x: 1, y: 2, z: 3, e: 4 });
      expect(snapshot.position?.gcode).toEqual({ x: 10, y: 20, z: 30, e: 40 });
      expect(snapshot.position?.live).toEqual({ x: 11, y: 22, z: 33, e: 44 });

      expect(snapshot.speed?.liveVelocityMmS).toBe(55);
      expect(snapshot.speed?.gcodeSpeedMmS).toBe(150);
      expect(snapshot.speed?.speedFactor).toBe(0.8);
      expect(snapshot.speed?.flowFactor).toBe(0.9);

      expect(snapshot.fans?.part?.speed).toBe(0.5);
      expect(snapshot.fans?.part?.rpm).toBe(1234);

      expect(snapshot.chamberTemp).toBe(42.5);
      expect(snapshot.limits?.maxVelocity).toBe(300);
      expect(snapshot.limits?.maxAccel).toBe(2000);
    });
  });
});
