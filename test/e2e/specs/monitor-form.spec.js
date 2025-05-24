import { expect, test } from "@playwright/test";
import { login, restoreSqliteSnapshot, screenshot } from "../util-test";

/**
 * Selects the monitor type from the dropdown.
 * @param {import('@playwright/test').Page} page - The Playwright page instance.
 * @param {string} monitorType - The monitor type to select (default is "dns").
 * @returns {Promise<void>} - A promise that resolves when the monitor type is selected.
 */
async function selectMonitorType(page, monitorType = "dns") {
    const monitorTypeSelect = page.getByTestId("monitor-type-select");
    await expect(monitorTypeSelect).toBeVisible();
    await monitorTypeSelect.selectOption(monitorType);

    const selectedValue = await monitorTypeSelect.evaluate((select) => select.value);
    expect(selectedValue).toBe(monitorType);
}

test.describe("Monitor Form", () => {
    test.beforeEach(async ({ page }) => {
        await restoreSqliteSnapshot(page);
    });

    test("condition ui", async ({ page }, testInfo) => {
        await page.goto("./add");
        await login(page);
        await screenshot(testInfo, page);
        await selectMonitorType(page);

        await page.getByTestId("add-condition-button").click();
        expect(await page.getByTestId("condition").count()).toEqual(1); // 1 explicitly added

        await page.getByTestId("add-group-button").click();
        expect(await page.getByTestId("condition-group").count()).toEqual(1);
        expect(await page.getByTestId("condition").count()).toEqual(2); // 1 solo conditions + 1 condition in group

        await screenshot(testInfo, page);

        await page.getByTestId("remove-condition").first().click();
        expect(await page.getByTestId("condition").count()).toEqual(1); // 0 solo condition + 1 condition in group

        await page.getByTestId("remove-condition-group").first().click();
        expect(await page.getByTestId("condition-group").count()).toEqual(0);

        await screenshot(testInfo, page);
    });

    test("successful condition", async ({ page }, testInfo) => {
        await page.goto("./add");
        await login(page);
        await screenshot(testInfo, page);
        await selectMonitorType(page);

        const friendlyName = "Example DNS NS";
        await page.getByTestId("friendly-name-input").fill(friendlyName);
        await page.getByTestId("hostname-input").fill("example.com");

        const resolveTypeSelect = page.getByTestId("resolve-type-select");
        await resolveTypeSelect.click();
        await resolveTypeSelect.getByRole("option", { name: "NS" }).click();

        await page.getByTestId("add-condition-button").click();
        expect(await page.getByTestId("condition").count()).toEqual(1); // 1 explicitly added

        await page.getByTestId("add-condition-button").click();
        expect(await page.getByTestId("condition").count()).toEqual(2); // 2 explicitly added

        await page.getByTestId("condition-value").nth(0).fill("a.iana-servers.net");
        await page.getByTestId("condition-and-or").nth(0).selectOption("or");
        await page.getByTestId("condition-value").nth(1).fill("b.iana-servers.net");

        await screenshot(testInfo, page);
        await page.getByTestId("save-button").click();
        await page.waitForURL("/dashboard/*");

        expect(page.getByTestId("monitor-status")).toHaveText("up", { ignoreCase: true });

        await screenshot(testInfo, page);
    });

    test("failing condition", async ({ page }, testInfo) => {
        await page.goto("./add");
        await login(page);
        await screenshot(testInfo, page);
        await selectMonitorType(page);

        const friendlyName = "Example DNS NS";
        await page.getByTestId("friendly-name-input").fill(friendlyName);
        await page.getByTestId("hostname-input").fill("example.com");

        const resolveTypeSelect = page.getByTestId("resolve-type-select");
        await resolveTypeSelect.click();
        await resolveTypeSelect.getByRole("option", { name: "NS" }).click();

        await page.getByTestId("add-condition-button").click();
        expect(await page.getByTestId("condition").count()).toEqual(1); // 1 explicitly added

        await page.getByTestId("condition-value").nth(0).fill("definitely-not.net");

        await screenshot(testInfo, page);
        await page.getByTestId("save-button").click();
        await page.waitForURL("/dashboard/*");

        expect(page.getByTestId("monitor-status")).toHaveText("down", { ignoreCase: true });

        await screenshot(testInfo, page);
    });

    test("GlobalPing monitor creation", async ({ page }, testInfo) => {
        await page.goto("./add");
        await login(page);
        await screenshot(testInfo, page, "initial-page");

        // Select GlobalPing monitor type
        const monitorTypeSelect = page.getByTestId("monitor-type-select");
        await expect(monitorTypeSelect).toBeVisible();
        await screenshot(testInfo, page, "before-type-select");

        // Check if GlobalPing option exists
        const globalpingOption = monitorTypeSelect.locator("option[value=\"globalping\"]");
        await expect(globalpingOption).toBeAttached();

        await monitorTypeSelect.selectOption("globalping");
        await screenshot(testInfo, page, "after-type-select");

        // Wait a moment after type selection to ensure page is stable
        await page.waitForTimeout(2000);
        await screenshot(testInfo, page, "after-wait");

        // Check if the page is still responsive
        const friendlyNameInput = page.getByTestId("friendly-name-input");
        await expect(friendlyNameInput).toBeVisible();
        await screenshot(testInfo, page, "friendly-name-visible");

        // Check if GlobalPing target input exists
        const targetInput = page.getByTestId("globalping-target-input");
        await expect(targetInput).toBeVisible();
        await screenshot(testInfo, page, "target-input-visible");

        // Just fill the friendly name and target, skip interval for now
        await friendlyNameInput.fill("GlobalPing Test");
        await targetInput.fill("google.com");
        await screenshot(testInfo, page, "basic-fields-filled");

        // Try to save without setting interval to see what happens
        await page.getByTestId("save-button").click();
        await screenshot(testInfo, page, "after-save-attempt");

        // The test should at least get this far without the page crashing
    });
});
