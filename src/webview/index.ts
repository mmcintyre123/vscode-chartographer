import cytoscape, { Core } from 'cytoscape'
import cytoscapeDagre from 'cytoscape-dagre'
import cytoscapeElk from 'cytoscape-elk'
import cytoscapeKlay from 'cytoscape-klay'
import { GraphDirection, GraphSettings, WebviewToExtensionMessage, ExtensionToWebviewMessage, WebviewState } from '../protocol'
import { createGraphSettings, FileGroupMode, getFileGroupMode, showFunctionFileSubtitles, withFileGroupMode } from './settings'
import { setupWheelZoom } from './wheel-zoom'

cytoscape.use(cytoscapeDagre)
cytoscape.use(cytoscapeElk)
cytoscape.use(cytoscapeKlay)

interface VsCodeApi {
    postMessage(message: WebviewToExtensionMessage): void
    getState(): WebviewState | null
    setState(state: WebviewState): void
}

declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
let cy: Core | null = null
let hoveredNodeId: string | null = null
let lastClickedNodeId: string | null = null

const t0 = performance.now()
let t1 = 0, t2 = 0, t3 = 0

const previousState = vscode.getState()
let state: WebviewState = previousState || {
    config: {},
    elems: [],
}
if (!state.elems) state.elems = []

// An expansion remains pending until the extension finishes or reports an error.
const pendingExpansions = new Set<string>()
let graphSettings: GraphSettings
const nodeLabelElements = new Map<string, { container: HTMLDivElement; title: HTMLDivElement; file: HTMLDivElement }>()

const layoutDebounce: Record<string, number> = {
    klay: 5,
    elk: 500,
    dagre: 5,
}

function debounce<T extends (...args: unknown[]) => void>(func: T, delay: number): T {
    let timer: number | undefined
    return ((...args: unknown[]) => {
        clearTimeout(timer)
        timer = setTimeout(() => func(...args), delay) as unknown as number
    }) as T
}

const colorSchemes: Record<string, Record<string, Record<string, string>>> = {
    default: {
        node: {
            backgroundColor: '--vscode-menu-background',
            color: '--vscode-menu-foreground',
            borderColor: '--vscode-editor-foreground',
        },
        highlightedLeafNode: {
            backgroundColor: '--vscode-editorWarning-background',
            color: '--vscode-editorWarning-foreground',
        },
        highlightedRootNode: {
            backgroundColor: '--vscode-editorError-background',
            color: '--vscode-editorError-foreground',
        },
        compound: {
            backgroundColor: '--vscode-editor-background',
        },
        edge: {
            lineColor: '--vscode-editor-foreground',
            arrowColor: '--vscode-editor-foreground',
        },
        searchHighlight: {
            backgroundColor: '--vscode-editor-selectionBackground',
            color: '--vscode-editor-selectionForeground',
            borderColor: '--vscode-focusBorder',
        },
    },
    highContrast: {
        node: {
            backgroundColor: '#000000',
            color: '#FFFFFF',
            borderColor: '#FFFFFF',
        },
        highlightedLeafNode: {
            backgroundColor: '#0000FF',
            color: '#FFFFFF',
        },
        highlightedRootNode: {
            backgroundColor: '#FF0000',
            color: '#FFFFFF',
        },
        compound: {
            backgroundColor: '#000000',
        },
        edge: {
            lineColor: '#FFFFFF',
            arrowColor: '#FFFFFF',
        },
        searchHighlight: {
            backgroundColor: '#FFFF00',
            color: '#000000',
            borderColor: '#FFFFFF',
        },
    },
}

function getCyStyle(): cytoscape.StylesheetStyle[] {
    const style = getComputedStyle(document.body)
    const getStyle = (name: string): string => style.getPropertyValue(name).trim()

    const selectedScheme = state.config.colorScheme || 'default'
    const colors = colorSchemes[selectedScheme]
    const overrides = state.config.colors || {}

    const getColor = (colorValue: string, overrideValue?: string): string => {
        if (overrideValue) return overrideValue
        return colorValue.startsWith('--') ? getStyle(colorValue) : colorValue
    }

    return [
        {
            selector: 'node',
            style: {
                'font-size': '12px',
                'font-family': getStyle('--vscode-font-family') || 'sans-serif',
                'background-color': getColor(colors.node.backgroundColor, overrides.nodeBackgroundColor),
                color: getColor(colors.node.color, overrides.nodeColor),
                width: 'label',
                height: showFunctionFileSubtitles(state.config, graphSettings) ? 28 : 16,
                padding: '7px',
                'border-color': getColor(colors.node.borderColor, overrides.nodeBorderColor),
                'border-width': 1,
                shape: 'roundrectangle',
                label: showFunctionFileSubtitles(state.config, graphSettings) ? 'data(displayLabel)' : 'data(label)',
                'text-opacity': 0,
                'text-wrap': 'wrap',
                'text-halign': 'center',
                'text-valign': 'center',
            },
        },
        {
            selector: '.dimmedNode',
            style: { opacity: 0.5 },
        },
        {
            selector: '.highlightedNode',
            style: { opacity: 1 },
        },
        {
            selector: '.highlightedLeafNode',
            style: {
                'background-color': getColor(colors.highlightedLeafNode.backgroundColor, overrides.highlightedLeafNodeBackgroundColor),
                color: getColor(colors.highlightedLeafNode.color, overrides.highlightedLeafNodeColor),
            },
        },
        {
            selector: '.highlightedRootNode',
            style: {
                'background-color': getColor(colors.highlightedRootNode.backgroundColor, overrides.highlightedRootNodeBackgroundColor),
                color: getColor(colors.highlightedRootNode.color, overrides.highlightedRootNodeColor),
            },
        },
        {
            selector: '.compound',
            style: {
                'font-size': '10px',
                'padding-top': graphSettings.showFileGroupLabel ? '25px' : '10px',
                'background-color': getColor(colors.compound.backgroundColor, overrides.nodeGroupBackgroundColor),
                'background-opacity': graphSettings.showFileGroupBox ? 1 : 0,
                'border-width': graphSettings.showFileGroupBox ? 1 : 0,
                'border-color': getColor(colors.node.borderColor, overrides.nodeBorderColor),
                shape: 'roundrectangle',
                label: graphSettings.showFileGroupLabel ? 'data(label)' : '',
                'text-opacity': 1,
                'text-valign': 'top',
                'text-halign': 'center',
                'text-margin-y': 15,
            },
        },
        {
            selector: 'edge',
            style: {
                'curve-style': 'unbundled-bezier',
                'target-arrow-shape': 'triangle',
                'line-color': getColor(colors.edge.lineColor, overrides.edgeLineColor),
                'target-arrow-color': getColor(colors.edge.arrowColor, overrides.edgeArrowColor),
                opacity: 0.5,
            },
        },
        {
            selector: '.dimmedEdge',
            style: { opacity: 0.2 },
        },
        {
            selector: '.highlightedEdge',
            style: { opacity: 1 },
        },
        {
            selector: '.searchHighlight',
            style: {
                'background-color': getColor(colors.searchHighlight.backgroundColor, overrides.searchHighlightBackgroundColor),
                color: getColor(colors.searchHighlight.color, overrides.searchHighlightColor),
                'border-width': 2,
                'border-color': getColor(colors.searchHighlight.borderColor, overrides.searchHighlightBorderColor),
            },
        },
    ]
}

function resetRootHighlights(): void {
    if (!cy) return
    cy.nodes().removeClass('highlightedRootNode')
    if (state.config.highlightRoots) {
        cy.nodes().roots().not(':parent').addClass('highlightedRootNode')
    }
}

function resetLeafHighlights(): void {
    if (!cy) return
    cy.nodes().removeClass('highlightedLeafNode')
    if (state.config.highlightLeaves) {
        cy.nodes().leaves().not(':parent').addClass('highlightedLeafNode')
    }
}

function resetHighlights(): void {
    if (!cy) return
    cy.nodes().removeClass(['dimmedNode', 'highlightedNode', 'searchHighlight'])
    cy.edges().removeClass(['dimmedEdge', 'highlightedEdge'])
    cy.nodes().data('isHighlighted', false)
    hidePathIndicator()
}

function computePath(sourceId: string, targetId: string): void {
    if (!cy) return
    resetHighlights()
    const source = cy.getElementById(sourceId).first() as any
    const target = cy.getElementById(targetId).first() as any
    if (source.length === 0 || target.length === 0) return

    const path = cy.elements().dijkstra({
        root: source,
        directed: false,
        weight: () => 1,
    }).pathTo(target)

    if (path.length === 0) {
        showPathIndicator(sourceId, targetId, -1)
        return
    }

    cy.nodes().not(path).not(path.parents()).addClass('dimmedNode')
    cy.edges().not(path).addClass('dimmedEdge')

    const hops = path.edges().length
    showPathIndicator(sourceId, targetId, hops)
}

function showPathIndicator(sourceId: string, targetId: string, hops: number): void {
    const el = document.getElementById('path-indicator')
    if (!el) return
    const sourceLabel = cy?.getElementById(sourceId).data('label') || sourceId
    const targetLabel = cy?.getElementById(targetId).data('label') || targetId
    if (hops < 0) {
        el.innerHTML = `${sourceLabel} → ${targetLabel} · no path <span class="path-indicator-close">&times;</span>`
    } else {
        el.innerHTML = `${sourceLabel} → ${targetLabel} · ${hops} hop${hops !== 1 ? 's' : ''} <span class="path-indicator-close">&times;</span>`
    }
    el.style.display = 'block'
}

function hidePathIndicator(): void {
    const el = document.getElementById('path-indicator')
    if (el) el.style.display = 'none'
}

// Save the current graph rather than the history of incoming add messages.
function saveGraphState(): void {
    if (!cy) return
    state.elems = cy.elements().map(element => element.json() as cytoscape.ElementDefinition)
    state.graphSettings = { ...graphSettings }
    vscode.setState(state)
}

// Older upstream graphs have file names on their parents, but no function subtitle fields.
function normalizeNodeLabels(elements = cy?.nodes()): void {
    elements?.nodes().not('.compound').forEach(node => {
        const fileLabel = node.data('fileLabel') ?? node.parent().data('label') ?? ''
        node.data('fileLabel', fileLabel)
        node.data('displayLabel', fileLabel ? `${node.data('label')}\n${fileLabel}` : node.data('label'))
    })
}

// Canvas labels use one font size. These non-interactive overlays add smaller subtitles.
function syncNodeLabels(): void {
    const container = document.getElementById('node-labels')
    if (!cy || !container) return
    const activeIds = new Set<string>()
    const zoom = cy.zoom()
    const showFiles = showFunctionFileSubtitles(state.config, graphSettings)
    cy.nodes().not('.compound').forEach(node => {
        activeIds.add(node.id())
        let elements = nodeLabelElements.get(node.id())
        if (!elements) {
            elements = {
                container: document.createElement('div'),
                title: document.createElement('div'),
                file: document.createElement('div'),
            }
            elements.container.className = 'node-label'
            elements.title.className = 'node-label-title'
            elements.file.className = 'node-label-file'
            elements.container.append(elements.title, elements.file)
            container.append(elements.container)
            nodeLabelElements.set(node.id(), elements)
        }
        const position = node.renderedPosition()
        const fileLabel = node.data('fileLabel') || ''
        elements.title.textContent = node.data('label')
        elements.file.textContent = fileLabel
        elements.file.style.display = showFiles && fileLabel ? 'block' : 'none'
        Object.assign(elements.container.style, {
            left: `${position.x}px`,
            top: `${position.y}px`,
            color: node.style('color'),
            opacity: node.style('opacity'),
            display: node.visible() ? 'flex' : 'none',
        })
        elements.title.style.fontSize = `${12 * zoom}px`
        elements.file.style.fontSize = `${9 * zoom}px`
        elements.file.style.marginTop = `${2 * zoom}px`
    })
    nodeLabelElements.forEach((elements, id) => {
        if (!activeIds.has(id)) {
            elements.container.remove()
            nodeLabelElements.delete(id)
        }
    })
}

// Pickers update this graph immediately without changing VS Code configuration.
function setupGraphControls(): void {
    const direction = document.getElementById('graph-direction') as HTMLSelectElement
    const groups = document.getElementById('file-groups') as HTMLSelectElement
    direction.value = graphSettings.direction
    groups.value = getFileGroupMode(graphSettings)
    direction.addEventListener('change', () => {
        graphSettings.direction = direction.value as GraphDirection
        saveGraphState()
        cy?.layout(getLayoutOpts()).run()
    })
    groups.addEventListener('change', () => {
        graphSettings = withFileGroupMode(graphSettings, groups.value as FileGroupMode)
        cy?.style(getCyStyle())
        syncNodeLabels()
        saveGraphState()
        cy?.layout(getLayoutOpts()).run()
    })
}

function requestExpansion(id: string, depth: number): void {
    const node = cy?.getElementById(id)
    if (!node?.length || node.hasClass('compound') || pendingExpansions.has(id)) return
    pendingExpansions.add(id)
    vscode.postMessage({ type: 'expandBoth', data: { id, depth } })
}

function toggleInstructions(): void {
    const instructions = document.getElementById('instructions')
    if (!instructions) return
    if (instructions.style.display === 'none' || instructions.style.display === '') {
        instructions.style.display = 'block'
    } else {
        instructions.style.display = 'none'
    }
}

function setupSearch(): void {
    const searchInput = document.getElementById('search-input') as HTMLInputElement | null
    const searchResults = document.getElementById('search-results')
    if (!searchInput || !searchResults) return

    const debouncedSearch = debounce(() => {
        const query = searchInput.value.toLowerCase().trim()
        if (query.length < 2) {
            searchResults.style.display = 'none'
            resetHighlights()
            return
        }

        const matchingNodes = cy!.nodes().not('.compound').filter(node => {
            const label = node.data('label') || ''
            const fileLabel = node.data('fileLabel') || ''
            return label.toLowerCase().includes(query) || fileLabel.toLowerCase().includes(query)
        })

        searchResults.innerHTML = ''
        if (matchingNodes.length > 0) {
            searchResults.style.display = 'block'
            matchingNodes.forEach(node => {
                const resultItem = document.createElement('button')
                resultItem.type = 'button'
                resultItem.className = 'search-result-item'
                const name = document.createElement('div')
                name.textContent = node.data('label')
                const file = document.createElement('small')
                file.textContent = node.data('fileLabel') || ''
                resultItem.append(name, file)
                resultItem.addEventListener('click', () => {
                    resetHighlights()
                    node.addClass('searchHighlight')
                    cy?.animate({
                        fit: { eles: node, padding: 50 },
                        zoom: 1.5,
                        duration: 200,
                    } as cytoscape.AnimationOptions)
                    searchResults.style.display = 'none'
                })
                searchResults.appendChild(resultItem)
            })
        } else {
            searchResults.style.display = 'none'
        }
    }, 300)

    searchInput.addEventListener('input', debouncedSearch)

    document.addEventListener('click', event => {
        if (!searchResults.contains(event.target as Node) && event.target !== searchInput) {
            searchResults.style.display = 'none'
        }
    })
}

function getLayoutOpts(): cytoscape.LayoutOptions {
    const algo = state.config.defaultGraphLayoutAlgorithm || 'klay'
    const dir = graphSettings.direction
    const dagreDirections = { DOWN: 'TB', RIGHT: 'LR', LEFT: 'RL', UP: 'BT' }

    const base: Record<string, unknown> = {
        name: algo,
        animate: true,
        animationDuration: 250,
        klay: {
            addUnnecessaryBendpoints: false,
            direction: dir,
            layoutHierarchy: true,
            spacing: state.config.klaySpacing ?? 1,
            borderSpacing: 10,
            compactComponents: true,
            thoroughness: 10,
            edgeSpacingFactor: 0.5,
            inLayerSpacingFactor: 2,
        },
        elk: {
            algorithm: 'layered',
            'elk.direction': dir,
        },
        // ELK lays out file groups separately; each group needs the selected direction too.
        nodeLayoutOptions: () => ({ 'elk.direction': dir }),
        rankDir: dagreDirections[dir],
        rankSep: 15,
        nodeSep: 15,
        edgeSep: 15,
        ranker: 'network-simplex',
    }
    return base as unknown as cytoscape.LayoutOptions
}

const debouncedLayout = debounce(() => {
    if (!cy) return
    cy.layout(getLayoutOpts()).run()
    vscode.setState(state)
}, layoutDebounce[state.config.defaultGraphLayoutAlgorithm || 'dagre'])

const methods: {
    [K in ExtensionToWebviewMessage['type']]: (msg: Extract<ExtensionToWebviewMessage, { type: K }>) => void
} = {
    setParams(msg) {
        t1 = performance.now()
        graphSettings = createGraphSettings(previousState?.config ?? msg.data.config, state.graphSettings)
        state = { ...state, config: msg.data.config }
        start()
        vscode.postMessage({ type: 'state', data: 'ready' })
    },
    addElems(msg) {
        t2 = performance.now()
        // Hierarchy results repeat shared nodes; keep one copy in the graph and saved state.
        const seen = new Set<string>()
        const additions = msg.data.filter(element => {
            const id = element.data.id
            if (!id || seen.has(id) || cy?.getElementById(id).length) return false
            seen.add(id)
            return true
        })
        const added = cy?.add(additions)
        normalizeNodeLabels(added)
        resetRootHighlights()
        resetLeafHighlights()
        resetHighlights()
        saveGraphState()
        // Acknowledge only after saving, so results missed while hidden can be replayed safely.
        vscode.postMessage({ type: 'elementsReceived', data: { batchId: msg.batchId } })
        debouncedLayout()
        t3 = performance.now()
        vscode.postMessage({
            type: 'timing',
            data: {
                scriptLoad: t1 - t0,
                toReady: t2 - t1,
                render: t3 - t2,
                total: t3 - t0,
            },
        })
    },
    highlightPath(msg) {
        resetHighlights()
        computePath(msg.data.sourceId, msg.data.targetId)
    },
    expansionComplete(msg) {
        pendingExpansions.delete(msg.data.id)
    },
}

window.addEventListener('message', event => {
    const message = event.data as ExtensionToWebviewMessage
    const handler = methods[message.type]
    if (handler) {
        handler(message as any)
    }
})

function isCtrlClick(evt: cytoscape.EventObject): boolean {
    const e = evt.originalEvent as MouseEvent | undefined
    if (!e) return false
    if (isMac) return e.metaKey
    return e.ctrlKey
}

function isShiftClick(evt: cytoscape.EventObject): boolean {
    const e = evt.originalEvent as MouseEvent | undefined
    return e?.shiftKey || false
}

function removeNode(id: string): void {
    if (!cy) return
    const node = cy.getElementById(id)
    if (node.length === 0) return
    cy.remove(node)
    syncNodeLabels()
    resetRootHighlights()
    resetLeafHighlights()
    saveGraphState()
}

function removeSubtree(id: string, direction: 'descendants' | 'ancestors'): void {
    if (!cy) return
    const node = cy.getElementById(id)
    if (node.length === 0) return

    const nodes = direction === 'descendants'
        ? node.successors()
        : node.predecessors()
    const all = nodes as cytoscape.CollectionReturnValue
    cy.remove(all)
    resetRootHighlights()
    resetLeafHighlights()
    saveGraphState()
    syncNodeLabels()
    debouncedLayout()
}

function showContextMenu(x: number, y: number, nodeId: string): void {
    const menu = document.getElementById('context-menu')
    if (!menu) return

    const label = cy?.getElementById(nodeId).data('label') || nodeId

    menu.innerHTML = `
        <div class="context-menu-item" data-action="remove">Remove "${label}" <span class="shortcut">Del</span></div>
        <div class="context-menu-item" data-action="removeDescendants">Remove descendants</div>
        <div class="context-menu-item" data-action="removeAncestors">Remove ancestors</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="expand">Expand one level <span class="shortcut">E</span></div>
        <div class="context-menu-item" data-action="expandAll">Expand recursively <span class="shortcut">Shift+E</span></div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="findPathTo">Find path to... <span class="shortcut">Shift+Click</span></div>
        <div class="context-menu-item" data-action="goTo">Go to function <span class="shortcut">Ctrl+Click</span></div>
    `

    menu.style.display = 'block'
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
    menu.dataset.nodeId = nodeId

    const close = () => {
        menu.style.display = 'none'
        document.removeEventListener('click', closeOutside)
    }
    const closeOutside = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node)) {
            close()
        }
    }
    setTimeout(() => document.addEventListener('click', closeOutside), 0)
}

function handleContextAction(action: string, nodeId: string): void {
    switch (action) {
        case 'remove':
            removeNode(nodeId)
            break
        case 'removeDescendants':
            removeSubtree(nodeId, 'descendants')
            break
        case 'removeAncestors':
            removeSubtree(nodeId, 'ancestors')
            break
        case 'expand':
            requestExpansion(nodeId, 1)
            break
        case 'expandAll':
            requestExpansion(nodeId, -1)
            break
        case 'findPathTo':
            vscode.postMessage({ type: 'findPathTo', data: { sourceId: nodeId } })
            break
        case 'goTo':
            vscode.postMessage({ type: 'goToFunction', data: nodeId })
            break
    }
}

function start(): void {
    const container = document.getElementById('cy')
    if (!container) return

    container.addEventListener('contextmenu', e => e.preventDefault())
    container.addEventListener('mousedown', () => {
        document.body.focus()
    })

    cy = cytoscape({
        container,
        style: getCyStyle(),
        elements: state.elems,
        wheelSensitivity: state.config.wheelSensitivity ?? 0.1,
        minZoom: 0.075,
        maxZoom: 7.5,
    })
    const graphArea = document.getElementById('graph-area')
    if (graphArea) setupWheelZoom(graphArea, cy, state.config.wheelSensitivity ?? 0.1)

    normalizeNodeLabels()
    resetRootHighlights()
    resetLeafHighlights()
    resetHighlights()
    cy.on('render', syncNodeLabels)
    cy!.layout(getLayoutOpts()).run()
    saveGraphState()

    setupSearch()
    setupGraphControls()
    syncNodeLabels()

    document.getElementById('reset-zoom')?.addEventListener('click', () => cy?.fit())
    document.getElementById('question-mark')?.addEventListener('click', toggleInstructions)
    document.getElementById('hide-text')?.addEventListener('click', toggleInstructions)

    cy!.on('mouseover', 'node', function (e) {
        hoveredNodeId = e.target.id()
    })
    cy!.on('mouseout', 'node', function () {
        hoveredNodeId = null
    })

    document.addEventListener('keydown', function (e) {
        // Typing/searching and operating a select must never expand or remove graph nodes.
        const target = e.target as HTMLElement | null
        if (target?.closest('input, select, textarea, button, [contenteditable="true"]')) return
        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return
        if (!hoveredNodeId) return
        const node = cy?.getElementById(hoveredNodeId)
        if (!node || node.length === 0) return

        if (e.key.toLowerCase() === 'e') {
            e.preventDefault()
            requestExpansion(hoveredNodeId, e.shiftKey ? -1 : 1)
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            removeNode(hoveredNodeId)
        }
    })

    cy!.on('tap', function (e) {
        if (e.target === cy) {
            resetHighlights()
        }
    })

    cy!.on('tap', 'node', function (e) {
        const node = e.target
        const nodeId = node.id()

        if (isCtrlClick(e)) {
            vscode.postMessage({
                type: 'goToFunction',
                data: nodeId,
            })
            return
        }

        if (isShiftClick(e) && lastClickedNodeId && lastClickedNodeId !== nodeId) {
            computePath(lastClickedNodeId, nodeId)
            return
        }

        if (!node.data('isHighlighted')) {
            resetHighlights()

            node.data('isHighlighted', true)
            node.parent().data('isHighlighted', true)
            if (node.children().size() === 1) {
                node.children().data('isHighlighted', true)
            }

            let neighborhood: cytoscape.CollectionReturnValue = node
            neighborhood = neighborhood.add(node.children())
            neighborhood = neighborhood.add(neighborhood.neighborhood())
            neighborhood = neighborhood.add(neighborhood.parent())

            neighborhood.nodes().addClass('highlightedNode')
            neighborhood.edges().addClass('highlightedEdge')

            cy!.nodes().not('.highlightedNode').addClass('dimmedNode')
            cy!.edges().not('.highlightedEdge').addClass('dimmedEdge')

            lastClickedNodeId = nodeId
        } else {
            node.data('isHighlighted', false)
            node.parent().data('isHighlighted', false)
            node.children().data('isHighlighted', false)
            cy!.nodes().removeClass(['highlightedNode', 'dimmedNode'])
            cy!.edges().removeClass(['highlightedEdge', 'dimmedEdge'])
            lastClickedNodeId = null
        }
    })

    cy!.on('tap', 'edge', function (e) {
        const edge = e.target
        const callSites: { uri: { scheme: string; authority: string; path: string; query: string; fragment: string }; line: number; character: number }[] | undefined = edge.data('callSites')
        if (!callSites || callSites.length === 0) return

        if (callSites.length === 1) {
            vscode.postMessage({ type: 'goToCallSite', data: callSites[0] })
        } else {
            vscode.postMessage({ type: 'selectCallSite', data: { edgeId: edge.id(), callSites } })
        }
    })

    cy!.on('cxttap', 'node', function (e) {
        const rendered = e.target.renderedPosition()
        const bounds = container.getBoundingClientRect()
        showContextMenu(bounds.left + rendered.x, bounds.top + rendered.y, e.target.id())
    })

    document.getElementById('context-menu')?.addEventListener('click', function (e) {
        const item = (e.target as HTMLElement).closest('.context-menu-item') as HTMLElement | null
        if (!item) return
        const action = item.dataset.action
        const nodeId = this.dataset.nodeId
        if (!action || !nodeId) return
        this.style.display = 'none'
        handleContextAction(action, nodeId)
    })

    document.getElementById('path-indicator')?.addEventListener('click', function (e) {
        if ((e.target as HTMLElement).classList.contains('path-indicator-close')) {
            resetHighlights()
        }
    })
}

document.addEventListener('DOMContentLoaded', function () {
    document.body.setAttribute('tabindex', '0')
    document.body.focus()
    vscode.postMessage({ type: 'state', data: 'loaded' })
})
