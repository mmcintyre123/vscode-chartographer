import type { Core } from 'cytoscape'

// Preserve the fork's Cytoscape 3.31 wheel response. Newer versions normalize mouse
// deltas, making the same configured sensitivity much slower on a notched wheel.
export function setupWheelZoom(area: HTMLElement, cy: Core, sensitivity: number): void {
    const onWheel = (event: WheelEvent) => {
        if (event.deltaY === 0) return
        if (!cy.zoomingEnabled() || !cy.userZoomingEnabled() || !cy.panningEnabled() || !cy.userPanningEnabled()) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (event.buttons !== 0 || cy.nodes(':grabbed').length > 0) return

        const container = cy.container()
        if (!container) return
        const bounds = container.getBoundingClientRect()
        const lineFactor = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : 1
        const exponent = -event.deltaY / 250 * sensitivity * lineFactor
        cy.zoom({
            level: cy.zoom() * Math.pow(10, exponent),
            renderedPosition: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        })
        cy.emit('scrollzoom')
    }

    // Capture on the graph's parent before Cytoscape handles the event; never zoom twice.
    area.addEventListener('wheel', onWheel, { capture: true, passive: false })
    cy.on('destroy', () => area.removeEventListener('wheel', onWheel, true))
}
