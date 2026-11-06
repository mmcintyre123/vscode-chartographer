// A real JavaScript call chain for VS Code's built-in language service.
export function targetFunction(value) {
    return value + 1
}

function callerFunction() {
    return targetFunction(1)
}

function outerFunction() {
    return callerFunction()
}

outerFunction()
