import * as path from 'path'

import { runTests } from '@vscode/test-electron'

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '..', '..')
        const extensionTestsPath = path.resolve(__dirname, 'suite', 'index')

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            // Reuse an installed editor for offline checks while retaining the isolated test profile.
            vscodeExecutablePath: process.env.CHARTOGRAPHER_TEST_VSCODE,
            // Keep call-hierarchy fixtures inside the test workspace so workspace filtering is exercised.
            launchArgs: [path.join(extensionDevelopmentPath, 'src', 'test', 'fixtures'), '--disable-extensions'],
        })
    } catch (err) {
        console.error('Failed to run tests:', err)
        process.exit(1)
    }
}

main()
