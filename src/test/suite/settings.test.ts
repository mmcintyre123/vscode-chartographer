import * as assert from 'assert'
import { createGraphSettings, getFileGroupMode, showFunctionFileSubtitles, withFileGroupMode } from '../../webview/settings'

suite('Graph-specific settings', () => {
    test('new graphs use compact defaults', () => {
        assert.deepStrictEqual(createGraphSettings({}), { direction: 'DOWN', showFileGroupBox: false, showFileGroupLabel: false })
    })

    test('saved graph choices survive changed global defaults', () => {
        const saved = { direction: 'LEFT' as const, showFileGroupBox: false, showFileGroupLabel: true }
        assert.deepStrictEqual(createGraphSettings({ defaultKlayDirection: 'UP', showFileGroupBox: true, showFileGroupLabel: false }, saved), saved)
    })

    test('restores the old fork direction key', () => {
        assert.strictEqual(createGraphSettings({ defaultKlayDirection: 'DOWN' }, { klayDirection: 'UP' }).direction, 'UP')
    })

    test('preserves upstream horizontal defaults for non-Klay layouts', () => {
        assert.strictEqual(createGraphSettings({ defaultGraphLayoutAlgorithm: 'dagre', defaultDirection: 'horizontal', defaultKlayDirection: 'UP' }).direction, 'RIGHT')
    })

    test('every decoration choice preserves direction and independently controls boxes and labels', () => {
        const original = createGraphSettings({ defaultKlayDirection: 'LEFT' })
        for (const mode of ['hidden', 'boxes', 'labels', 'both'] as const) {
            const changed = withFileGroupMode(original, mode)
            assert.strictEqual(getFileGroupMode(changed), mode)
            assert.strictEqual(changed.direction, 'LEFT')
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
