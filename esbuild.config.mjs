import * as esbuild from 'esbuild'

async function main() {
    // Emit file/line errors in the format consumed by the VS Code task matcher.
    const reportErrors = {
        name: 'report-errors',
        setup(build) {
            build.onEnd(result => {
                for (const error of result.errors) {
                    const location = error.location
                    if (location) {
                        console.error(`${location.file}:${location.line}:${location.column + 1}: error: ${error.text}`)
                    }
                }
            })
        },
    }
    const options = [
        {
            entryPoints: ['src/extension.ts'],
            bundle: true,
            outfile: 'out/extension.js',
            platform: 'node',
            format: 'cjs',
            external: ['vscode'],
            sourcemap: true,
            minify: true,
            plugins: [reportErrors],
        },
        {
            entryPoints: ['src/webview/index.ts'],
            bundle: true,
            outfile: 'out/webview.js',
            platform: 'browser',
            format: 'iife',
            globalName: 'ChartographerWebview',
            sourcemap: true,
            minify: true,
            plugins: [reportErrors],
        },
    ]

    if (process.argv.includes('--watch')) {
        // Build both bundles before telling the debugger that it can launch.
        console.log('[watch] starting')
        const contexts = await Promise.all(options.map(option => esbuild.context(option)))
        await Promise.all(contexts.map(context => context.rebuild()))
        await Promise.all(contexts.map(context => context.watch()))
        console.log('[watch] ready')
    } else {
        await Promise.all(options.map(option => esbuild.build(option)))
    }
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
