import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeVscodeExtensionManifest, isExtensionCompatible } from './taskflow-vscode-compatibility.js';

test('accepts a manifest using supported VS Code activation events', () => {
    const result = analyzeVscodeExtensionManifest({
        engines: { vscode: '^1.80.0' },
        activationEvents: ['onLanguage:python']
    });

    assert.equal(result.status, 'supported');
    assert.deepEqual(result.reasons, []);
});

test('marks unrecognized activation events as requiring translation', () => {
    const result = analyzeVscodeExtensionManifest({
        engines: { vscode: '^1.80.0' },
        activationEvents: ['onLanguageModelTool:taskflow.example']
    });

    assert.equal(result.status, 'translation-required');
    assert.deepEqual(result.activationEvents, ['onLanguageModelTool:taskflow.example']);
    assert.equal(isExtensionCompatible({
        engines: { vscode: '^1.80.0' },
        activationEvents: ['onLanguageModelTool:taskflow.example']
    }), true);
    assert.equal(analyzeVscodeExtensionManifest({
        engines: { vscode: '^1.80.0' },
        activationEvents: ['onFutureHostFeature']
    }).status, 'unsupported');
});

test('rejects terminal shell integration and proposed APIs', () => {
    const shellIntegration = analyzeVscodeExtensionManifest({
        engines: { vscode: '^1.80.0' },
        activationEvents: ['onTerminalShellIntegration:python']
    });
    const proposedApi = analyzeVscodeExtensionManifest({
        engines: { vscode: '^1.80.0' },
        enabledApiProposals: ['languageModel']
    });

    assert.equal(shellIntegration.status, 'unsupported');
    assert.ok(shellIntegration.reasons.includes('terminal-shell-integration-not-implemented'));
    assert.equal(proposedApi.status, 'unsupported');
    assert.equal(isExtensionCompatible({ engines: { vscode: '^1.150.0' } }), false);
});
