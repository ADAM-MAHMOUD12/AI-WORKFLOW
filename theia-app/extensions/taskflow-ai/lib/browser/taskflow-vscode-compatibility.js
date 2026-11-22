export const THEIA_VSCODE_API_VERSION = '1.144.0';

const SUPPORTED_ACTIVATION_EVENTS = new Set([
    '*',
    'onLanguage',
    'onCommand',
    'onDebug',
    'onDebugInitialConfigurations',
    'onDebugResolve',
    'onDebugAdapterProtocolTracker',
    'onDebugDynamicConfigurations',
    'onTaskType',
    'workspaceContains',
    'onView',
    'onUri',
    'onTerminalProfile',
    'onWebviewPanel',
    'onFileSystem',
    'onCustomEditor',
    'onStartupFinished',
    'onAuthenticationRequest',
    'onNotebook',
    'onNotebookSerializer'
]);

const UNTRANSLATABLE_ACTIVATION_EVENTS = new Set([
    'onTerminalShellIntegration'
]);
const TRANSLATABLE_ACTIVATION_EVENTS = new Set([
    'onLanguageModelTool'
]);

function getMinimumVscodeVersion(range) {
    if (typeof range !== 'string' || !range.trim()) {
        return undefined;
    }
    const matches = [...range.matchAll(/(?:^|[\s<>=~^|])v?(\d+)\.(\d+)(?:\.(\d+))?/g)];
    if (!matches.length) {
        return undefined;
    }
    const [, major, minor, patch = '0'] = matches[0];
    return [Number(major), Number(minor), Number(patch)];
}

function exceedsTheiaApiVersion(version) {
    const [major, minor, patch] = version;
    const [supportedMajor, supportedMinor, supportedPatch] = THEIA_VSCODE_API_VERSION.split('.').map(Number);
    return major > supportedMajor ||
        (major === supportedMajor && minor > supportedMinor) ||
        (major === supportedMajor && minor === supportedMinor && patch > supportedPatch);
}

export function analyzeVscodeExtensionManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return { status: 'unsupported', reasons: ['invalid-manifest'], activationEvents: [] };
    }

    const reasons = [];
    const activationEvents = Array.isArray(manifest.activationEvents)
        ? manifest.activationEvents.filter(event => typeof event === 'string' && event.length > 0)
        : [];
    const minimumVersion = getMinimumVscodeVersion(manifest.engines?.vscode);

    if (!minimumVersion) {
        reasons.push('unknown-vscode-engine-range');
    } else if (exceedsTheiaApiVersion(minimumVersion)) {
        reasons.push('requires-newer-vscode-api');
    }
    if (Array.isArray(manifest.enabledApiProposals) && manifest.enabledApiProposals.length) {
        reasons.push('requires-proposed-api');
    }

    const translationEvents = [];
    for (const event of activationEvents) {
        const eventBase = event.split(':', 1)[0];
        if (SUPPORTED_ACTIVATION_EVENTS.has(eventBase)) {
            continue;
        }
        if (UNTRANSLATABLE_ACTIVATION_EVENTS.has(eventBase)) {
            reasons.push('terminal-shell-integration-not-implemented');
            continue;
        }
        if (TRANSLATABLE_ACTIVATION_EVENTS.has(eventBase)) {
            translationEvents.push(event);
        } else {
            reasons.push('unsupported-activation-event');
        }
    }

    if (reasons.length) {
        return { status: 'unsupported', reasons, activationEvents: translationEvents };
    }
    if (translationEvents.length) {
        return { status: 'translation-required', reasons: [], activationEvents: translationEvents };
    }
    return { status: 'supported', reasons: [], activationEvents: [] };
}

export function isExtensionCompatible(manifest) {
    const status = analyzeVscodeExtensionManifest(manifest).status;
    return status === 'supported' || status === 'translation-required';
}
