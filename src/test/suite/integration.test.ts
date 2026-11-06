import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'
import { Element, getCyElems, getCyNodes, getNode } from '../../graph'
import { lastFocusedPanel, setupCallGraph } from '../../webview'
import { ExtensionToWebviewMessage } from '../../protocol'
import { CallHierarchy, getCallHierarchy } from '../../call'

suite('Incoming command and graph host', () => {
    const extensionPath = path.resolve(__dirname, '..', '..', '..')
    const fixtureUri = vscode.Uri.file(path.join(extensionPath, 'src', 'test', 'fixtures', 'call-graph.chartographer-test'))
    const names = ['targetFunction', 'callerFunction', 'outerFunction']
    let provider: vscode.Disposable
    let prepareCalls = 0
    let incomingLines: number[] = []
    let outgoingCalls = 0
    let prepareGate: Promise<void> | undefined
    let missingSymbol = false

    // A tiny provider lets the real extension command and traversal run without another extension.
    function itemAt(line: number): vscode.CallHierarchyItem {
        const range = new vscode.Range(line, 0, line, names[line].length)
        return new vscode.CallHierarchyItem(vscode.SymbolKind.Function, names[line], '', fixtureUri, range, range)
    }

    async function waitUntil(predicate: () => boolean): Promise<void> {
        const deadline = Date.now() + 15000
        while (!predicate()) {
            if (Date.now() >= deadline) assert.fail('Timed out waiting for the call hierarchy')
            await new Promise(resolve => setTimeout(resolve, 20))
        }
    }

    function createHost(elems: Element[]) {
        const messages: ExtensionToWebviewMessage[] = []
        let visible = true
        // Only VS Code transport is replaced; setupCallGraph, node conversion, and traversal are production code.
        const panel = {
            webview: {
                asWebviewUri: (uri: vscode.Uri) => uri,
                postMessage: async (message: ExtensionToWebviewMessage) => {
                    messages.push(message)
                    return visible
                },
            },
        } as unknown as vscode.WebviewPanel
        const context = { extensionPath } as vscode.ExtensionContext
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(fixtureUri)!.uri.toString()
        const graph = setupCallGraph(context, workspaceRoot, panel, undefined, { elems })
        return { ...graph, messages, setVisible: (value: boolean) => { visible = value } }
    }

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension('ArpinFidel.Chartographer')
        assert.ok(extension)
        await extension.activate()
        provider = vscode.languages.registerCallHierarchyProvider(
            { scheme: 'file', pattern: '**/call-graph.chartographer-test' },
            {
                async prepareCallHierarchy(_document, position) {
                    prepareCalls++
                    if (prepareGate) await prepareGate
                    return missingSymbol ? [] : [itemAt(position.line)]
                },
                provideCallHierarchyIncomingCalls(item) {
                    const line = item.selectionRange.start.line
                    incomingLines.push(line)
                    return line < 2
                        ? [new vscode.CallHierarchyIncomingCall(itemAt(line + 1), [new vscode.Range(line + 1, 0, line + 1, 1)])]
                        : []
                },
                provideCallHierarchyOutgoingCalls() {
                    outgoingCalls++
                    return []
                },
            }
        )
    })

    setup(() => {
        prepareCalls = 0
        incomingLines = []
        outgoingCalls = 0
        prepareGate = undefined
        missingSymbol = false
    })

    suiteTeardown(async () => {
        provider.dispose()
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    })

    test('direct command uses the cursor and traverses only incoming calls without a depth prompt', async function () {
        this.timeout(20000)
        const document = await vscode.workspace.openTextDocument(fixtureUri)
        const editor = await vscode.window.showTextDocument(document)
        editor.selection = new vscode.Selection(0, 2, 0, 2)

        await vscode.commands.executeCommand('Chartographer.showAllIncomingCallGraph')
        await waitUntil(() => incomingLines.includes(2))
        assert.deepStrictEqual(incomingLines, [0, 1, 2])
        assert.strictEqual(outgoingCalls, 0)
        assert.strictEqual(prepareCalls, 1)
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    })

    test('function labels retain identity, filename subtitles and call-site navigation data', () => {
        const root = itemAt(0)
        const node = getNode('', root)
        const [functionNode, fileNode] = getCyNodes(node, { nodeDisplayFormat: '$fileName.$fileExt' })
        assert.strictEqual(functionNode.data.label, 'targetFunction')
        assert.strictEqual(functionNode.data.fileLabel, 'call-graph.chartographer-test')
        assert.strictEqual(functionNode.data.displayLabel, 'targetFunction\ncall-graph.chartographer-test')
        assert.strictEqual(functionNode.data.id, `node:${node.id}`)
        assert.strictEqual(functionNode.data.parent, fileNode.data.id)
        assert.strictEqual(functionNode.classes, 'hasFileSubtitle')

        const elems = getCyElems('', {
            item: root, from: itemAt(1), fromRanges: [new vscode.Range(1, 3, 1, 5)],
        })
        const edge = elems.find(element => element.group === 'edges')
        assert.ok(edge?.group === 'edges')
        assert.strictEqual(edge.data.callSites?.[0].line, 1)
        assert.strictEqual(edge.data.callSites?.[0].character, 3)
        assert.strictEqual(edge.data.callSites?.[0].uri.path, fixtureUri.path)
    })

    test('incoming traversal works with the built-in JavaScript language service', async function () {
        this.timeout(30000)
        const languageService = vscode.extensions.getExtension('vscode.typescript-language-features')
        assert.ok(languageService, 'built-in JavaScript language service is unavailable')
        await languageService.activate()
        const uri = vscode.Uri.file(path.join(extensionPath, 'src', 'test', 'fixtures', 'incoming-workflow.js'))
        const document = await vscode.workspace.openTextDocument(uri)
        await vscode.window.showTextDocument(document)
        const entries = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
            'vscode.prepareCallHierarchy', uri, new vscode.Position(1, 20),
        )
        assert.ok(entries?.[0], 'JavaScript provider did not resolve targetFunction')
        const edges: CallHierarchy[] = []
        await getCallHierarchy('Incoming', entries[0], edge => edges.push(edge), -1)
        assert.ok(edges.some(edge => edge.from?.name === 'callerFunction' && edge.item.name === 'targetFunction'))
        assert.ok(edges.some(edge => edge.from?.name === 'outerFunction' && edge.item.name === 'callerFunction'))
        assert.ok(edges.every(edge => edge.from && !edge.to), 'incoming traversal included outgoing edges')
        assert.ok(edges.every(edge => edge.fromRanges.length > 0), 'call-site ranges were not preserved')
    })

    test('restored host suppresses overlapping expansion, releases pending state, and allows retry', async () => {
        const elems = getCyNodes(getNode('', itemAt(0)))
        // A saved panel contains plain URI data, not live Uri instances.
        const restored = JSON.parse(JSON.stringify(elems)) as Element[]
        const { handler, messages } = createHost(restored)
        await handler({ type: 'state', data: 'ready' })
        await handler({ type: 'state', data: 'ready' })
        assert.strictEqual(messages.filter(message => message.type === 'addElems').length, 0)

        let releasePrepare!: () => void
        prepareGate = new Promise(resolve => { releasePrepare = resolve })
        const request = { type: 'expandBoth' as const, data: { id: elems[0].data.id, depth: 1 } }
        const first = handler(request)
        await waitUntil(() => prepareCalls === 1)
        await handler(request)
        assert.strictEqual(prepareCalls, 1)
        assert.strictEqual(messages.filter(message => message.type === 'expansionComplete').length, 0)

        releasePrepare()
        await first
        assert.deepStrictEqual(incomingLines, [0])
        assert.strictEqual(outgoingCalls, 1)
        assert.strictEqual(messages.filter(message => message.type === 'expansionComplete').length, 1)

        await handler(request)
        assert.strictEqual(prepareCalls, 2)
        assert.strictEqual(messages.filter(message => message.type === 'expansionComplete').length, 2)
    })

    test('missing symbols and invalid node IDs always finish expansion', async () => {
        const elems = getCyNodes(getNode('', itemAt(0)))
        const { handler, messages } = createHost(elems)
        missingSymbol = true
        await handler({ type: 'expandBoth', data: { id: elems[0].data.id, depth: 1 } })
        await handler({ type: 'expandBoth', data: { id: 'missing-node', depth: 1 } })
        assert.deepStrictEqual(messages.filter(message => message.type === 'expansionComplete').map(message => message.data), [
            { id: elems[0].data.id }, { id: 'missing-node' },
        ])
        assert.strictEqual(incomingLines.length, 0)
    })

    test('replays only unacknowledged batches after a hidden panel is ready', async () => {
        const { handler, messages, setVisible } = createHost([])
        const batches = () => messages.filter((message): message is Extract<ExtensionToWebviewMessage, { type: 'addElems' }> => message.type === 'addElems')
        await handler({ type: 'state', data: 'ready' })
        assert.ok(lastFocusedPanel)
        lastFocusedPanel.addElems(getCyNodes(getNode('', itemAt(0))))
        const delivered = batches()[0]
        await handler({ type: 'elementsReceived', data: { batchId: delivered.batchId } })

        // A saved-and-acknowledged node may subsequently be removed by the user.
        // Revealing the panel must not resend that node from the host navigation lookup.
        messages.length = 0
        await handler({ type: 'state', data: 'ready' })
        assert.strictEqual(batches().length, 0)

        setVisible(false)
        lastFocusedPanel.addElems(getCyNodes(getNode('', itemAt(1))))
        lastFocusedPanel.addElems(getCyNodes(getNode('', itemAt(2))))
        const pending = batches()
        assert.strictEqual(pending.length, 2)
        assert.ok(pending[0].batchId > delivered.batchId)
        assert.ok(pending[1].batchId > pending[0].batchId)

        messages.length = 0
        setVisible(true)
        await handler({ type: 'state', data: 'ready' })
        assert.deepStrictEqual(batches().map(batch => batch.batchId), pending.map(batch => batch.batchId))
        assert.deepStrictEqual(batches().map(batch => batch.data), pending.map(batch => batch.data))

        await handler({ type: 'elementsReceived', data: { batchId: pending[0].batchId } })
        messages.length = 0
        await handler({ type: 'state', data: 'ready' })
        assert.deepStrictEqual(batches().map(batch => batch.batchId), [pending[1].batchId])

        await handler({ type: 'elementsReceived', data: { batchId: pending[1].batchId } })
        messages.length = 0
        await handler({ type: 'state', data: 'ready' })
        assert.strictEqual(batches().length, 0)
        assert.strictEqual(prepareCalls, 0)
    })
})
