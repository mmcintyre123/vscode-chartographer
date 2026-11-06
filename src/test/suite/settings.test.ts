import * as assert from 'assert'
import { createGraphSettings, getFileGroupMode, showFunctionFileSubtitles, withFileGroupMode } from '../../webview/settings'

suite('Graph-specific settings', () => {
    test('new graphs use compact defaults', () => {
        assert.deepStrictEqual(createGraphSettings({}), { layoutAlgorithm: 'klay', direction: 'DOWN', showFileGroupBox: false, showFileGroupLabel: false })
    })

    test('saved graph choices survive changed global defaults', () => {
        const saved = { layoutAlgorithm: 'elk' as const, direction: 'LEFT' as const, showFileGroupBox: false, showFileGroupLabel: true }
        assert.deepStrictEqual(createGraphSettings({ defaultGraphLayoutAlgorithm: 'dagre', defaultKlayDirection: 'UP', showFileGroupBox: true, showFileGroupLabel: false }, saved), saved)
    })

    test('older saved graphs retain the algorithm captured in their configuration', () => {
        const saved = { direction: 'UP' as const, showFileGroupBox: true, showFileGroupLabel: false }
        const restored = createGraphSettings({ defaultGraphLayoutAlgorithm: 'dagre' }, saved)
        assert.deepStrictEqual(restored, { ...saved, layoutAlgorithm: 'dagre' })
    })

    test('initial direction follows the chosen algorithm when no direction was saved', () => {
        const config = { defaultGraphLayoutAlgorithm: 'dagre' as const, defaultKlayDirection: 'UP' as const, defaultDirection: 'horizontal' as const }
        assert.strictEqual(createGraphSettings(config, { layoutAlgorithm: 'klay' }).direction, 'UP')
        assert.strictEqual(createGraphSettings(config, { layoutAlgorithm: 'elk' }).direction, 'RIGHT')
    })

    test('restores the old fork direction key', () => {
        assert.strictEqual(createGraphSettings({ defaultKlayDirection: 'DOWN' }, { klayDirection: 'UP' }).direction, 'UP')
    })

    test('preserves upstream horizontal defaults for non-Klay layouts', () => {
        assert.strictEqual(createGraphSettings({ defaultGraphLayoutAlgorithm: 'dagre', defaultDirection: 'horizontal', defaultKlayDirection: 'UP' }).direction, 'RIGHT')
    })

    test('every decoration choice preserves layout and direction while independently controlling boxes and labels', () => {
        const original = createGraphSettings({}, { layoutAlgorithm: 'elk', direction: 'LEFT' })
        for (const mode of ['hidden', 'boxes', 'labels', 'both'] as const) {
            const changed = withFileGroupMode(original, mode)
            assert.strictEqual(getFileGroupMode(changed), mode)
            assert.strictEqual(changed.direction, 'LEFT')
            assert.strictEqual(changed.layoutAlgorithm, 'elk')
            assert.strictEqual(changed.showFileGroupBox, mode === 'boxes' || mode === 'both')
            assert.strictEqual(changed.showFileGroupLabel, mode === 'labels' || mode === 'both')
        }
        assert.strictEqual(getFileGroupMode(original), 'hidden')
    })

    test('group labels suppress subtitles and hiding labels restores the user preference', () => {
        const config = { showFunctionFileSubtitle: true }
        const hidden = createGraphSettings(config)
        assert.strictEqual(showFunctionFileSubtitles(config, hidden), true)
        assert.strictEqual(showFunctionFileSubtitles(config, withFileGroupMode(hidden, 'labels')), false)
        assert.strictEqual(showFunctionFileSubtitles(config, withFileGroupMode(hidden, 'boxes')), true)
        assert.strictEqual(showFunctionFileSubtitles({ showFunctionFileSubtitle: false }, hidden), false)
    })
})
