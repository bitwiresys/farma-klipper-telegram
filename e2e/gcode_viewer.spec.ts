import { expect, test } from '@playwright/test';

test.describe('GCode viewer', () => {
  test('renders without NaN BufferGeometry warnings', async ({ page }) => {
    const consoleLines: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      consoleLines.push(text);
    });

    await page.addInitScript(() => {
      try {
        localStorage.setItem('farma_token_v1', 'e2e_token');
      } catch {
        // ignore
      }
    });

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    const gcode = [
      'G90',
      'G21',
      'G92 E0',
      // Speed-only and extrusion-only moves must not create NaN geometry.
      'G1 F3600',
      'G1 E0.5 F2400',
      // A real move with XYZ.
      'G1 X10 Y10 Z0.24 F3600',
      'G1 X20 Y10 E0.2',
    ].join('\n');

    await page.route('**/api/gcode/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: gcode,
      });
    });

    await page.goto('/printers/e2e_printer/3d?filename=e2e.gcode&e2e=1');

    // Wait for viewer canvas to appear (renderer inserts its own element).
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });

    // Give it a moment to compute geometry / bounding spheres.
    await page.waitForTimeout(1000);

    const hasNaNWarning = consoleLines.some(
      (l) =>
        l.includes('THREE.BufferGeometry.computeBoundingSphere()') &&
        l.includes('NaN'),
    );

    expect(hasNaNWarning).toBe(false);
  });
});
