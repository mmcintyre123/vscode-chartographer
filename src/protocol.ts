import type cytoscape from 'cytoscape'

export type Direction = 'Incoming' | 'Outgoing' | 'Both'
export type LayoutAlgorithm = 'klay' | 'elk' | 'dagre'

export type LayoutDirection = 'horizontal' | 'vertical'
export type GraphDirection = 'DOWN' | 'RIGHT' | 'LEFT' | 'UP'

// Graph-local controls override the defaults without changing VS Code settings.
export interface GraphSettings {
    direction: GraphDirection
    showFileGroupBox: boolean
    showFileGroupLabel: boolean
}

export type CallSite = {
    uri: { scheme: string; authority: string; path: string; query: string; fragment: string }
    line: number
    character: number
}

export interface ChartographerConfig {
    highlightRoots?: boolean
    highlightLeaves?: boolean
    defaultGraphLayoutAlgorithm?: LayoutAlgorithm
    defaultDirection?: LayoutDirection
    defaultKlayDirection?: GraphDirection
    klaySpacing?: number
    colorScheme?: string
    nodeDisplayFormat?: string
    trimFunctionPattern?: string
    wheelSensitivity?: number
    showFileGroupBox?: boolean
    showFileGroupLabel?: boolean
    showFunctionFileSubtitle?: boolean
    colors?: {
        nodeBackgroundColor?: string
        nodeColor?: string
        nodeBorderColor?: string
        highlightedLeafNodeBackgroundColor?: string
        highlightedLeafNodeColor?: string
        highlightedRootNodeBackgroundColor?: string
        highlightedRootNodeColor?: string
        nodeGroupBackgroundColor?: string
        edgeLineColor?: string
        edgeArrowColor?: string
        searchHighlightBackgroundColor?: string
        searchHighlightColor?: string
        searchHighlightBorderColor?: string
    }
}

export interface WebviewState {
    config: ChartographerConfig
    elems: cytoscape.ElementDefinition[]
    // Older fork panels saved klayDirection; older upstream panels saved no local settings.
    graphSettings?: Partial<GraphSettings> & { klayDirection?: GraphDirection }
}

export type WebviewToExtensionMessage =
    | { type: 'state'; data: 'loaded' | 'ready' }
    | { type: 'elementsReceived'; data: { batchId: number } }
    | { type: 'goToFunction'; data: string }
    | { type: 'expandBoth'; data: { id: string; depth: number } }
    | { type: 'goToCallSite'; data: { uri: { scheme: string; authority: string; path: string; query: string; fragment: string }; line: number; character: number } }
    | { type: 'selectCallSite'; data: { edgeId: string; callSites: CallSite[] } }
    | { type: 'findPathTo'; data: { sourceId: string } }
    | { type: 'timing'; data: { scriptLoad: number; toReady: number; render: number; total: number } }

export type ExtensionToWebviewMessage =
    | { type: 'setParams'; data: { config: ChartographerConfig } }
    | { type: 'addElems'; data: cytoscape.ElementDefinition[]; batchId: number }
    | { type: 'highlightPath'; data: { sourceId: string; targetId: string } }
    | { type: 'expansionComplete'; data: { id: string } }
