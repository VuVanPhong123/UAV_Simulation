import { expect, test } from '../../fe/node_modules/@playwright/test';

test('demo dashboard smoke flow', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('dashboard-title')).toBeVisible();

  await page.getByTestId('open-order-modal').click();
  await expect(page.getByTestId('order-modal')).toBeVisible();

  await page.getByTestId('random-order-count').fill('20');
  await expect(page.getByText(/vùng bản đồ hiện tại/i)).toBeVisible();
  await page.getByTestId('generate-random-orders').click();
  await expect(page.getByTestId('draft-order-list')).toContainText('random_order');

  const startButton = page.getByTestId('start-simulation');
  await expect(startButton).toBeEnabled({ timeout: 45_000 });
  await startButton.click();
  await expect(page.getByTestId('simulation-status')).toContainText(/Đang chạy|running/i, { timeout: 45_000 });

  const closeOrderModal = page.getByTestId('close-order-modal');
  if (await closeOrderModal.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeOrderModal.click();
  }
  await expect(page.getByTestId('bottom-drone-info-panel')).toBeVisible();

  await page.getByTestId('collapse-right-panel').click();
  await expect(page.getByTestId('expand-right-panel')).toBeVisible();
  await page.getByTestId('expand-right-panel').click();
  await expect(page.getByTestId('collapse-right-panel')).toBeVisible();

  await page.getByTestId('nav-environment').click();
  await expect(page.getByText(/Hướng gió/i)).toBeVisible();
  await expect(page.getByText(/Tốc độ gió/i)).toBeVisible();
  await expect(page.getByText(/Nhiệt độ/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Áp dụng/i })).toBeVisible();

  await page.getByTestId('create-obstacle').click();
  await expect(page.getByTestId('cancel-obstacle')).toBeVisible();
  await expect(page.getByText(/Đang chọn vị trí đặt vật cản/i).first()).toBeVisible();

  await page.getByTestId('nav-map-tools').click();
  await expect(page.getByTestId('layer-toggle-panel')).toBeVisible();
  const buildingLabelToggle = page.getByTestId('toggle-building-labels');
  await expect(buildingLabelToggle).toBeVisible();
  await buildingLabelToggle.click();
  await expect(page.getByTestId('layer-toggle-panel')).toBeVisible();
});
