# Chartographer

Initially based on [Call Graph](https://github.com/beicause/call-graph)

![chartographer](https://raw.githubusercontent.com/arpinfidel/vscode-chartographer/master/assets/call-graph.png)

vscode extension to generate call graph using [Cytoscape.js](https://js.cytoscape.org/) based on vscode call hierarchy language feature.

## Features

* works on any language with a language server
* show functions and methods grouped by file
* generate the complete incoming call graph with one command, without prompts
* change flow direction and file-group decorations immediately in each graph
* optional smaller filename subtitles beneath function names
* **Hover + `E`** to expand a node one level
* **Hover + `Shift+E`** to expand recursively
* **Hover + `Del`** to remove a node
* **Ctrl/Cmd+Click** to jump to function location
* **Right-click** context menu with remove, expand, and go to function
* ignore files by glob pattern (test files, etc)
* trim function names with user-configurable regex
* add a function to an existing graph
* search for functions by function name or filename
* configurable layout algorithm (klay, dagre, elk)
* click an edge to jump to its call site, or choose among multiple call sites
* Shift+Click a node to find a path from the last selected node
* panel state persists across VS Code restarts
* supports color themes

## Quick start

1. Move your editor cursor over a function name
2. Run `Chartographer: Show Call Graph` via `Ctrl+Shift+P` or right-click context menu
3. Pick direction (Both/Incoming/Outgoing) and enter max depth (blank = unlimited)
4. **Hover** a node + press `E` to expand, `Del` to remove, or right-click for context menu

### Direct incoming graph shortcut

Place the text cursor on a function and run **Chartographer: Show All Incoming Call Graph**. The command `Chartographer.showAllIncomingCallGraph` generates all incoming calls without direction or depth prompts. Existing shortcuts for this command continue to work. For example, this user keybinding assigns `Ctrl+Alt+C`:

```json
{
    "key": "ctrl+alt+c",
    "command": "Chartographer.showAllIncomingCallGraph"
}
```

The extension does not assign or overwrite your keyboard shortcuts.

### Controls inside each graph

- **Direction:** Top to bottom, Left to right, Right to left, or Bottom to top. The picker reruns the layout immediately and works with Klay, Dagre, and ELK.
- **File groups:** Hidden, Boxes only, Labels only, or Boxes + labels. Decorations change immediately; grouping still influences layout even when decorations are hidden.

Both choices are saved with that graph and restored when it reopens. They do not change VS Code settings or other open graphs. Settings supply defaults for new graphs.

Function names remain the primary labels. Enable `chartographer.showFunctionFileSubtitle` for smaller filename subtitles. When file-group labels are visible, repeated subtitles are hidden; hiding group labels shows the subtitles again. Search matches both function names and filenames, including when filename subtitles are hidden.

Hover shortcuts operate on nodes in the graph; hovering over source code does not generate or expand graphs. Expansion ignores held-key repeats and overlapping requests for the same node. Typing in the search field or operating a picker does not trigger graph shortcuts.

## Display settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `chartographer.defaultGraphLayoutAlgorithm` | `klay` | Layout for new graphs: Klay, Dagre, or ELK |
| `chartographer.defaultKlayDirection` | `DOWN` | Initial Klay direction: `DOWN`, `RIGHT`, `LEFT`, or `UP` |
| `chartographer.defaultDirection` | `vertical` | Initial Dagre/ELK direction: `vertical` or `horizontal` |
| `chartographer.klaySpacing` | `1` | Compact Klay node spacing |
| `chartographer.wheelSensitivity` | `0.1` | Original fork mouse-wheel/trackpad zoom response; higher is faster. Reopen the graph after changing it |
| `chartographer.showFileGroupBox` | `false` | Initial visibility of file-group boxes |
| `chartographer.showFileGroupLabel` | `false` | Initial visibility of file-group filename labels |
| `chartographer.showFunctionFileSubtitle` | `false` | Smaller filenames when group labels are hidden |
| `chartographer.nodeDisplayFormat` | `$fileName.$fileExt` | Formatting for file-group labels and function subtitles |

Existing user settings remain in effect. File formatting also supports `$path`, `$path{N}`, and `$fullPath`; `$fullPath` uses the supplied file path, which may already be workspace-relative. `chartographer.trimFunctionPattern` retains upstream's optional regex-based function-name trimming.

## Requirements

Chartographer relies on the "call hierarchy" feature of an LSP server. So, to use Chartographer for your project analysis, you must have a language server extension that supports "call hierarchy."

## Development

### Prerequisites

- Node.js 22 or newer
- npm

Use npm for dependencies and esbuild for bundling. `package-lock.json` is the authoritative dependency lock; the previous Yarn lock is removed. Do not mix npm and Yarn installs in this checkout.

### Build

```bash
npm ci
npm run build       # esbuild → out/extension.js + out/webview.js
npm run typecheck   # tsc --noEmit
npm run lint
npm run test:unit   # compiles and runs Node-compatible tests
npm test            # builds and runs VS Code integration tests
```

`npm run watch` rebuilds both bundles as source files change. The default VS Code build task waits for the initial bundles before launching the extension host. Use the **Extension Tests** launch configuration to build and compile tests before debugging them. Type checking remains a separate `npm run typecheck` step because esbuild does not check types.

Tests compile into `out-tests/`, separate from the extension bundles in `out/`, so test compilation cannot overwrite the graph's browser bundle.

### Package

```bash
npm run package     # produces chartographer-<version>.vsix
```

Packaging builds fresh bundles through the prepublish script. Local plans, handoffs, browser-test output, source files, and source maps are excluded from the VSIX.

For local VS Code Insiders verification, inspect the package contents, then replace the installed extension:

```powershell
code-insiders --uninstall-extension arpinfidel.chartographer
code-insiders --install-extension "<absolute path to chartographer-<version>.vsix>" --force
code-insiders --list-extensions --show-versions
```

Reload VS Code Insiders manually after verifying the installed version.

### Release

1. Update version in `package.json` and `package-lock.json`
2. Update `CHANGELOG.md`
3. Build: `npm run build && npm run package`
4. Install the VSIX locally and verify the graph interactions
5. When a Marketplace release is intended, publish with `npx vsce publish --no-yarn`
6. Create a GitHub release with the VSIX attached

## For more information

* [GitHub](https://github.com/arpinfidel/vscode-chartographer)

**Enjoy!**
