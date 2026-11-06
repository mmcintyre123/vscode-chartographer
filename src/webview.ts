import * as vscode from 'vscode'
import { CyNode, Element, getCyElems, getNode } from './graph'
import { resolveHtml } from './html'
import { CallHierarchy, getCallHierarchy as buildGraph } from './call'
import { printChannelOutput } from './logger'
import { ChartographerConfig, Direction, GraphDirection, LayoutAlgorithm, LayoutDirection, WebviewToExtensionMessage, ExtensionToWebviewMessage } from './protocol'

type State = {
    elems: Element[],
}

type Params = {
    direction: Direction,
    entryPoints: vscode.CallHierarchyItem[],
    maxDepth?: number,
}

export const buildWebview = (
    context: vscode.ExtensionContext,
	workspaceRoot: string,
    direction: Direction,
    maxDepth: number=-1,
) => {
    return async () => {
        const entries: vscode.CallHierarchyItem[] = await getSelectedFunctions()
        // Do not open an empty graph when the cursor does not resolve to a function.
        if (entries.length === 0) return

        const webviewType = `Chartographer.previewCallGraph`
        const panel = vscode.window.createWebviewPanel(
            webviewType,
            `Chartographer Call Graph`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
            }
        )

        const { handler, html } = setupCallGraph(context, workspaceRoot, panel, {direction, entryPoints: entries, maxDepth})

        panel.webview.onDidReceiveMessage(handler)
        panel.webview.html = html
    }
}

export const registerWebviewPanelSerializer = (
    context: vscode.ExtensionContext,
) => {
    vscode.window.registerWebviewPanelSerializer(`Chartographer.previewCallGraph`,
        {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: State | undefined) {
                if (!state) {
                    vscode.window.showErrorMessage(
                        'Chartographer: fail to load previous state'
                    )
                    return
                }

                const roots = vscode.workspace.workspaceFolders?.map((f) => f.uri.toString()) ?? []
                const workspaceRoot = roots.length > 0
                    ? [...roots].sort().reduce((prefix, str) => {
                        let i = 0
                        while (i < prefix.length && prefix[i] === str[i]) i++
                        return prefix.slice(0, i)
                      }, roots[0])
                    : ''

                const { handler, html } = setupCallGraph(context, workspaceRoot, webviewPanel, undefined, state)

                webviewPanel.webview.onDidReceiveMessage(handler)
                webviewPanel.webview.html = html
            }
        }
    )
}

export async function getSelectedFunctions() {
	const activeTextEditor = vscode.window.activeTextEditor
    if (!activeTextEditor) {
        vscode.window.showErrorMessage('No active editor. Open a file first.')
        return []
    }
	const entry: vscode.CallHierarchyItem[] = await vscode.commands.executeCommand(
		'vscode.prepareCallHierarchy',
		activeTextEditor.document.uri,
		activeTextEditor.selection.active
	)
	if (!entry || !entry[0]) {
		vscode.window.showErrorMessage("Can't resolve entry function")
		return []
	}

	return entry
}

export let lastFocusedPanel: {
	panel: vscode.WebviewPanel,
	addElems: (elems: Element[]) => void,
	addEdge: (edge: CallHierarchy) => void,
} | undefined = undefined
export function setupCallGraph(
    context: vscode.ExtensionContext,
	workspaceRoot: string,
    panel: vscode.WebviewPanel,
    params?: Params,
    state?: State,
) {
    const html = resolveHtml(context, panel)

    const configs = vscode.workspace.getConfiguration('chartographer')
    const config: ChartographerConfig = {
        highlightRoots: configs.get<boolean>('highlightRoots'),
        highlightLeaves: configs.get<boolean>('highlightLeaves'),
        defaultGraphLayoutAlgorithm: configs.get<string>('defaultGraphLayoutAlgorithm') as LayoutAlgorithm | undefined,
        defaultDirection: configs.get<string>('defaultDirection') as LayoutDirection | undefined,
        defaultKlayDirection: configs.get<GraphDirection>('defaultKlayDirection'),
        klaySpacing: configs.get<number>('klaySpacing'),
        colorScheme: configs.get<string>('colorScheme'),
        nodeDisplayFormat: configs.get<string>('nodeDisplayFormat'),
        trimFunctionPattern: configs.get<string>('trimFunctionPattern'),
        wheelSensitivity: configs.get<number>('wheelSensitivity'),
        showFileGroupBox: configs.get<boolean>('showFileGroupBox'),
        showFileGroupLabel: configs.get<boolean>('showFileGroupLabel'),
        showFunctionFileSubtitle: configs.get<boolean>('showFunctionFileSubtitle'),
        colors: {
            nodeBackgroundColor: configs.get<string>('colors.nodeBackgroundColor'),
            nodeColor: configs.get<string>('colors.nodeColor'),
            nodeBorderColor: configs.get<string>('colors.nodeBorderColor'),
            highlightedLeafNodeBackgroundColor: configs.get<string>('colors.highlightedLeafNodeBackgroundColor'),
            highlightedLeafNodeColor: configs.get<string>('colors.highlightedLeafNodeColor'),
            highlightedRootNodeBackgroundColor: configs.get<string>('colors.highlightedRootNodeBackgroundColor'),
            highlightedRootNodeColor: configs.get<string>('colors.highlightedRootNodeColor'),
            nodeGroupBackgroundColor: configs.get<string>('colors.nodeGroupBackgroundColor'),
            edgeLineColor: configs.get<string>('colors.edgeLineColor'),
            edgeArrowColor: configs.get<string>('colors.edgeArrowColor'),
            searchHighlightBackgroundColor: configs.get<string>('colors.searchHighlightBackgroundColor'),
            searchHighlightColor: configs.get<string>('colors.searchHighlightColor'),
            searchHighlightBorderColor: configs.get<string>('colors.searchHighlightBorderColor')
        }
    }
    printChannelOutput("config:")
    printChannelOutput(JSON.stringify(config, null, 4))

    const nodes: { [key: string]: Element}  = {}
    const expandingNodes = new Set<string>()
    const pendingBatches = new Map<number, Extract<ExtensionToWebviewMessage, { type: 'addElems' }>>()
    let nextBatchId = 0
    let initialized = false

    // The webview restores its saved elements itself; rebuild only the host navigation lookup.
    for (const element of state?.elems ?? []) {
        if (element.group === 'nodes' && !(element.data.uri instanceof vscode.Uri)) {
            element.data.uri = vscode.Uri.from(element.data.uri)
        }
        nodes[element.data.id] = element
    }
    const addElems = (elems: Element[]) => {
        for (const node of elems) {
            if (nodes[node.data.id]) continue
            nodes[node.data.id] = node
        }
        const msg: Extract<ExtensionToWebviewMessage, { type: 'addElems' }> = {
            type: 'addElems',
            data: elems,
            batchId: ++nextBatchId,
        }
        // Hidden webviews can miss messages, so keep each batch until its saved-state acknowledgement.
        pendingBatches.set(msg.batchId, msg)
        panel.webview.postMessage(msg)
    }
    const addEdge = (edge: CallHierarchy) => {
        const elems = getCyElems(workspaceRoot, edge, config)
        addElems(elems)
    }

    const handler = async (msg: WebviewToExtensionMessage) => {
        switch (msg.type) {
            case 'state':
                switch (msg.data) {
                    case 'loaded':
                        const setParamsMsg: ExtensionToWebviewMessage = {
                            type: 'setParams',
                            data: { config },
                        }
                        panel.webview.postMessage(setParamsMsg)
                        break

                    case 'ready':
                        lastFocusedPanel = {
							panel,
							addElems,
							addEdge,
						}

                        // Retry only missed additions; acknowledged nodes may have been deliberately removed.
                        for (const batch of pendingBatches.values()) {
                            panel.webview.postMessage(batch)
                        }

                        // Revealing a panel can recreate its webview. Do not regenerate removed nodes.
                        if (initialized) break
                        initialized = true
                        if (params) {
                            try {
                                await Promise.all(params.entryPoints.map(async (entry) => {
                                    // A function with no callers still belongs in its own graph.
                                    addEdge({ item: entry, fromRanges: [] })
                                    await buildGraph(params.direction, entry, addEdge, params.maxDepth)
                                }))
                            } catch (error) {
                                vscode.window.showErrorMessage(`Unable to generate call graph: ${String(error)}`)
                            }
                        }
                        break
                }
                break

            case 'elementsReceived':
                pendingBatches.delete(msg.data.batchId)
                break

            case 'goToFunction':
                const goToNode = nodes[msg.data] as CyNode
                if (!goToNode) return

                const range = new vscode.Range(
                    goToNode.data.line,
                    goToNode.data.character,
                    goToNode.data.line,
                    goToNode.data.character,
                )
                vscode.window.showTextDocument(goToNode.data.uri, {
                    selection: range,
                    preview: true,
                    viewColumn: vscode.ViewColumn.One,
                })
                break

            case 'expandBoth': {
                const id = msg.data.id
                // Suppress overlapping requests even if several UI actions target the same node.
                if (expandingNodes.has(id)) return
                expandingNodes.add(id)
                try {
                    const node = nodes[id]
                    if (node?.group !== 'nodes' || node.classes?.includes('compound')) return
                    const position = new vscode.Position(node.data.line, node.data.character)
                    const item: vscode.CallHierarchyItem[] = await vscode.commands.executeCommand(
                        'vscode.prepareCallHierarchy', node.data.uri, position,
                    )
                    if (!item?.[0]) {
                        vscode.window.showErrorMessage("Can't resolve entry function")
                        return
                    }
                    await buildGraph('Both', item[0], addEdge, msg.data.depth)
                } catch (error) {
                    vscode.window.showErrorMessage(`Unable to expand call graph: ${String(error)}`)
                } finally {
                    // Always release the webview's pending state, including missing symbols and failures.
                    expandingNodes.delete(id)
                    const complete: ExtensionToWebviewMessage = { type: 'expansionComplete', data: { id } }
                    panel.webview.postMessage(complete)
                }
                break
            }

            case 'timing':
                const t = msg.data
                printChannelOutput(`[timing] scriptLoad=${t.scriptLoad.toFixed(0)}ms toReady=${t.toReady.toFixed(0)}ms render=${t.render.toFixed(0)}ms total=${t.total.toFixed(0)}ms`)
                break

            case 'goToCallSite':
                const csUri = vscode.Uri.from(msg.data.uri)
                const csRange = new vscode.Range(
                    msg.data.line, msg.data.character,
                    msg.data.line, msg.data.character,
                )
                vscode.window.showTextDocument(csUri, {
                    selection: csRange,
                    preview: true,
                    viewColumn: vscode.ViewColumn.One,
                })
                break

            case 'selectCallSite':
                const items = msg.data.callSites.map((cs, i) => ({
                    label: `Line ${cs.line + 1}, Column ${cs.character + 1}`,
                    description: vscode.Uri.from(cs.uri).fsPath.split('/').pop() || '',
                    detail: `#${i + 1} of ${msg.data.callSites.length}`,
                    cs,
                }))
                const pick = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select call site to navigate to',
                })
                if (pick) {
                    const uri = vscode.Uri.from(pick.cs.uri)
                    const range = new vscode.Range(
                        pick.cs.line, pick.cs.character,
                        pick.cs.line, pick.cs.character,
                    )
                    vscode.window.showTextDocument(uri, {
                        selection: range,
                        preview: true,
                        viewColumn: vscode.ViewColumn.One,
                    })
                }
                break

            case 'findPathTo':
                const findSourceNode = nodes[msg.data.sourceId] as CyNode | undefined
                if (!findSourceNode) break
                const graphItems = Object.values(nodes)
                    .filter((n): n is CyNode => n.group === 'nodes' && !n.classes?.includes('compound') && n.data.id !== msg.data.sourceId)
                    .map(n => ({
                        label: n.data.label,
                        description: n.data.id,
                        id: n.data.id,
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                graphItems.push({ label: '', description: '', id: '' })
                graphItems.push({ label: '🔍 Search workspace for function...', description: '', id: '__search__' })
                const qpPick = await vscode.window.showQuickPick(graphItems, {
                    placeHolder: `Find path from "${findSourceNode.data.label}" to...`,
                    matchOnDescription: true,
                })
                if (!qpPick) break
                if (qpPick.id === '__search__') {
                    const query = await vscode.window.showInputBox({
                        prompt: 'Enter function name to search for',
                        placeHolder: 'e.g. handleLogin',
                    })
                    if (!query) break
                    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                        'vscode.executeWorkspaceSymbolProvider', query
                    )
                    if (!symbols || symbols.length === 0) {
                        vscode.window.showInformationMessage(`No symbols found matching "${query}"`)
                        break
                    }
                    const symbolPick = await vscode.window.showQuickPick(
                        symbols.map(s => ({
                            label: s.name,
                            description: s.containerName,
                            detail: s.location.uri.fsPath.split('/').pop() + ':' + (s.location.range.start.line + 1),
                            symbol: s,
                        })),
                        { placeHolder: 'Select function', matchOnDescription: true, matchOnDetail: true }
                    )
                    if (!symbolPick) break
                    const pos = new vscode.Position(symbolPick.symbol.location.range.start.line, 0)
                    const item: vscode.CallHierarchyItem[] = await vscode.commands.executeCommand(
                        'vscode.prepareCallHierarchy',
                        symbolPick.symbol.location.uri,
                        pos,
                    )
                    if (!item || !item[0]) {
                        vscode.window.showErrorMessage('Cannot resolve call hierarchy for selected symbol')
                        break
                    }
                    const wsCallHierarchy: CallHierarchy = { item: item[0], fromRanges: [] }
                    const wsElems = getCyElems(workspaceRoot, wsCallHierarchy, config)
                    addElems(wsElems)
                    const wsNode = getNode(workspaceRoot, item[0])
                    const wsTargetId = `node:${wsNode.id}`
                    const wsHighlight: ExtensionToWebviewMessage = {
                        type: 'highlightPath',
                        data: { sourceId: msg.data.sourceId, targetId: wsTargetId },
                    }
                    panel.webview.postMessage(wsHighlight)
                } else {
                    const highlightMsg: ExtensionToWebviewMessage = {
                        type: 'highlightPath',
                        data: { sourceId: msg.data.sourceId, targetId: qpPick.id },
                    }
                    panel.webview.postMessage(highlightMsg)
                }
                break
        }
    }
    return { handler, html }
}
