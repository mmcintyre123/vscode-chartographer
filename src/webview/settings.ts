import type { ChartographerConfig, GraphSettings, WebviewState } from '../protocol'

export type FileGroupMode = 'hidden' | 'boxes' | 'labels' | 'both'

// New graphs use configuration defaults; restored graphs keep their own choices.
export function createGraphSettings(config: ChartographerConfig, saved?: WebviewState['graphSettings']): GraphSettings {
    const defaultDirection = (config.defaultGraphLayoutAlgorithm ?? 'klay') === 'klay'
        ? config.defaultKlayDirection ?? (config.defaultDirection === 'horizontal' ? 'RIGHT' : 'DOWN')
        : config.defaultDirection === 'horizontal' ? 'RIGHT' : 'DOWN'
    return {
        direction: saved?.direction ?? saved?.klayDirection ?? defaultDirection,
        showFileGroupBox: saved?.showFileGroupBox ?? config.showFileGroupBox ?? false,
        showFileGroupLabel: saved?.showFileGroupLabel ?? config.showFileGroupLabel ?? false,
    }
}

// One picker represents the two independent decoration settings without removing groups.
export function getFileGroupMode(settings: GraphSettings): FileGroupMode {
    if (settings.showFileGroupBox) return settings.showFileGroupLabel ? 'both' : 'boxes'
    return settings.showFileGroupLabel ? 'labels' : 'hidden'
}

export function withFileGroupMode(settings: GraphSettings, mode: FileGroupMode): GraphSettings {
    return {
        ...settings,
        showFileGroupBox: mode === 'boxes' || mode === 'both',
        showFileGroupLabel: mode === 'labels' || mode === 'both',
    }
}

// Group labels already identify the file, so suppress repeated function subtitles.
export function showFunctionFileSubtitles(config: ChartographerConfig, settings: GraphSettings): boolean {
    return config.showFunctionFileSubtitle === true && !settings.showFileGroupLabel
}
