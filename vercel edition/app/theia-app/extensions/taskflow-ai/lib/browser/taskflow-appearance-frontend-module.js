import React from '@theia/core/shared/react';
import { ContainerModule, inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { CommandRegistry, PreferenceScope, PreferenceService } from '@theia/core';
import { FrontendApplicationContribution, ViewContainer, WidgetFactory, WidgetManager } from '@theia/core/lib/browser';
import { AboutDialog, AboutDialogProps } from '@theia/core/lib/browser/about-dialog';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { bindViewContribution, AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { PluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { analyzeVscodeExtensionManifest, isExtensionCompatible } from './taskflow-vscode-compatibility.js';
import './taskflow-appearance.css';

const CATALOG_URL = 'https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLOW-CODE-THEMES-EXTENSIONS/main/catalog.json';
const RAW_ASSET_PREFIX = 'https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLOW-CODE-THEMES-EXTENSIONS/main/';
const EXTENSION_SOURCE_OPEN_VSX = 'openvsx';
const EXTENSION_SOURCE_TASKFLOW = 'taskflow';
const EXTENSION_SOURCE_KEY = 'taskflow.theia.extension-source.v1';
const LEGACY_EXTENSION_REPOSITORY_KEY = 'taskflow.theia.extension-repository.v1';
const TASKFLOW_EXTENSION_REPOSITORY = Object.freeze({
    catalogUrl: 'https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLOW-CODE-EXTENSIONS/main/catalog.json',
    assetPrefix: 'https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLOW-CODE-EXTENSIONS/main/'
});
const TASKFLOW_SKILL_REPOSITORY = Object.freeze({
    catalogUrl: 'https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLO-SKILLS/main/catalog.json',
    assetPrefix: 'https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLO-SKILLS/main/'
});
const TASKFLOW_SKILLS_API_URL = '/api/skills/library';
const TASKFLOW_APP_DATA_URL = '/api/data';
const APPEARANCE_KEY = 'taskflow.theia.appearance.v1';
const INSTALLED_THEMES_KEY = 'taskflow.theia.installed-themes.v1';
const GLASS_WALLPAPER_KEY = 'taskflow.theia.glass-wallpaper.v1';
let activeExtensionSource = EXTENSION_SOURCE_OPEN_VSX;

function getSavedExtensionSource() {
    const saved = localStorage.getItem(EXTENSION_SOURCE_KEY);
    if (saved === EXTENSION_SOURCE_TASKFLOW) {
        return EXTENSION_SOURCE_TASKFLOW;
    }
    const legacy = localStorage.getItem(LEGACY_EXTENSION_REPOSITORY_KEY);
    return saved === 'dedicated' || (!saved && legacy === 'dedicated')
        ? EXTENSION_SOURCE_TASKFLOW
        : EXTENSION_SOURCE_OPEN_VSX;
}
const EDITOR_FONT_SIZE_KEY = 'taskflow.theia.theme-editor-font-size.v1';
const EDITOR_FONT_FAMILY_KEY = 'taskflow.theia.theme-editor-font-family.v1';
const THEME_FONTS = Object.freeze({
    ui: Object.freeze({
        system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        inter: 'Inter, system-ui, sans-serif',
        cairo: 'Cairo, "Segoe UI", sans-serif',
        segoe: '"Segoe UI", system-ui, sans-serif',
        arial: 'Arial, sans-serif'
    }),
    editor: Object.freeze({
        monospace: 'monospace',
        'cascadia-code': '"Cascadia Code", Consolas, monospace',
        'jetbrains-mono': '"JetBrains Mono", Consolas, monospace',
        'fira-code': '"Fira Code", Consolas, monospace',
        consolas: 'Consolas, monospace'
    })
});
const THEME_SETTING_CONTROLS = Object.freeze([
    'glassEffect', 'glassBlur', 'glassOpacity', 'glassSaturation', 'glassTint', 'glassWallpaper',
    'uiFontFamily', 'editorFontFamily', 'uiFontSize', 'editorFontSize',
    'cornerRadius', 'accent', 'buttonHoverBackground', 'listHoverBackground',
    'listActiveSelectionBackground', 'listActiveSelectionForeground', 'toolbarHoverBackground',
    'tabHoverBackground', 'focusBorder', 'buttonRadius', 'buttonHeight', 'buttonStyle',
    'motionPreset', 'motionDuration', 'hoverLift'
]);
const THEME_BUTTON_STYLES = Object.freeze(['solid', 'soft', 'outline', 'glass']);
const THEME_MOTION_PRESETS = Object.freeze(['none', 'subtle', 'smooth', 'snappy']);
const THEME_VARIABLES = Object.freeze({
    editorBackground: '--theia-editor-background',
    editorLineNumberForeground: '--theia-editorLineNumber-foreground',
    editorCursorForeground: '--theia-editorCursor-foreground',
    editorSelectionBackground: '--theia-editor-selectionBackground',
    editorLineHighlightBackground: '--theia-editor-lineHighlightBackground',
    editorWhitespaceForeground: '--theia-editorWhitespace-foreground',
    sidebarBackground: '--theia-sideBar-background',
    sidebarForeground: '--theia-sideBar-foreground',
    activityBarBackground: '--theia-activityBar-background',
    activityBarForeground: '--theia-activityBar-foreground',
    tabBarBackground: '--theia-tabBar-background',
    tabActiveBackground: '--theia-tab-activeBackground',
    tabActiveForeground: '--theia-tab-activeForeground',
    tabInactiveBackground: '--theia-tab-inactiveBackground',
    tabInactiveForeground: '--theia-tab-inactiveForeground',
    panelBackground: '--theia-panel-background',
    statusBarBackground: '--theia-statusBar-background',
    statusBarForeground: '--theia-statusBar-foreground',
    foreground: '--theia-ui-foreground',
    accent: '--theia-textLink-foreground',
    focusBorder: '--theia-focusBorder',
    inputBackground: '--theia-input-background',
    inputForeground: '--theia-input-foreground',
    buttonBackground: '--theia-button-background',
    buttonForeground: '--theia-button-foreground',
    buttonHoverBackground: '--theia-button-hoverBackground',
    listHoverBackground: '--theia-list-hoverBackground',
    listActiveSelectionBackground: '--theia-list-activeSelectionBackground',
    listActiveSelectionForeground: '--theia-list-activeSelectionForeground',
    toolbarHoverBackground: '--theia-toolbar-hoverBackground',
    tabHoverBackground: '--theia-tab-hoverBackground'
});
const THEME_SIZE_VARIABLES = Object.freeze({
    uiFontSize: '--theia-ui-font-size',
    cornerRadius: '--taskflow-theme-corner-radius'
});
const THEME_GLASS_VARIABLES = Object.freeze({
    blur: '--taskflow-theme-glass-blur',
    opacity: '--taskflow-theme-glass-opacity',
    saturation: '--taskflow-theme-glass-saturation',
    tint: '--taskflow-theme-glass-tint'
});
const THEME_BUTTON_VARIABLES = Object.freeze({
    radius: '--taskflow-theme-button-radius',
    height: '--taskflow-theme-button-height',
    duration: '--taskflow-theme-motion-duration',
    hoverLift: '--taskflow-theme-hover-lift'
});
const previousThemeVariableValues = new Map();
const DEFAULT_CATALOG = Object.freeze({ themes: [], extensions: [], skills: [] });

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSlug(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function safeAssetUrl(path, assetPrefix = RAW_ASSET_PREFIX) {
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('\\') ||
        path.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error('مسار عنصر المتجر غير صالح.');
    }
    return `${assetPrefix}${path.split('/').map(encodeURIComponent).join('/')}`;
}

function safeReadmeUrl(value, baseUrl) {
    if (typeof value !== 'string') {
        return '';
    }
    let url;
    try {
        url = new URL(value, baseUrl);
    } catch (error) {
        if (error instanceof TypeError) {
            return '';
        }
        throw error;
    }
    const trustedPrefixes = [
        new URL(RAW_ASSET_PREFIX),
        new URL(TASKFLOW_EXTENSION_REPOSITORY.assetPrefix)
    ];
    const isTrustedAsset = trustedPrefixes.some(prefix =>
        url.origin === prefix.origin && url.pathname.startsWith(prefix.pathname)
    );
    const isExternalLink = !value.startsWith('.');
    return url.protocol === 'https:' && (isTrustedAsset || isExternalLink) ? url.href : '';
}

function isSafeGlassWallpaper(value) {
    return typeof value === 'string' && value.length <= 1_400_000 &&
        /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function renderReadmeInline(text, baseUrl) {
    const tokenPattern = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;
    const nodes = [];
    let lastIndex = 0;
    let match;
    while ((match = tokenPattern.exec(text))) {
        if (match.index > lastIndex) {
            nodes.push(text.slice(lastIndex, match.index));
        }
        const key = `inline-${match.index}`;
        if (match[1]) {
            const src = safeReadmeUrl(match[3], baseUrl);
            nodes.push(src
                ? React.createElement('img', {
                    key,
                    className: 'taskflow-readme-image',
                    src,
                    alt: match[2],
                    title: match[4],
                    loading: 'lazy',
                    referrerPolicy: 'no-referrer'
                })
                : match[0]);
        } else if (match[2] !== undefined) {
            const href = safeReadmeUrl(match[3], baseUrl);
            nodes.push(href
                ? React.createElement('a', {
                    key,
                    href,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    title: match[4]
                }, match[2])
                : match[0]);
        } else if (match[5] !== undefined) {
            nodes.push(React.createElement('code', { key }, match[5]));
        } else if (match[6] !== undefined || match[7] !== undefined) {
            nodes.push(React.createElement('strong', { key }, match[6] ?? match[7]));
        } else {
            nodes.push(React.createElement('em', { key }, match[8] ?? match[9]));
        }
        lastIndex = tokenPattern.lastIndex;
    }
    if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex));
    }
    return nodes;
}

function renderReadmeMarkdown(markdown, baseUrl) {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
            index += 1;
            continue;
        }
        const fence = /^\s*```([\w+-]*)\s*$/.exec(line);
        if (fence) {
            const code = [];
            index += 1;
            while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
                code.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            blocks.push(React.createElement('pre', { key: `block-${index}` },
                React.createElement('code', { className: fence[1] ? `language-${fence[1]}` : undefined }, code.join('\n'))
            ));
            continue;
        }
        const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading) {
            const level = heading[1].length;
            blocks.push(React.createElement(`h${level}`, { key: `block-${index}` }, renderReadmeInline(heading[2], baseUrl)));
            index += 1;
            continue;
        }
        if (/^\s*(?:(?:-{3,})|(?:_{3,})|(?:\*{3,}))\s*$/.test(line)) {
            blocks.push(React.createElement('hr', { key: `block-${index}` }));
            index += 1;
            continue;
        }
        if (/^\s*>\s?/.test(line)) {
            const quote = [];
            while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
                quote.push(lines[index].replace(/^\s*>\s?/, ''));
                index += 1;
            }
            blocks.push(React.createElement('blockquote', { key: `block-${index}` },
                React.createElement('p', null, renderReadmeInline(quote.join(' '), baseUrl))
            ));
            continue;
        }
        const listMatch = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(line);
        if (listMatch) {
            const ordered = /^\d/.test(listMatch[1]);
            const items = [];
            while (index < lines.length) {
                const item = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(lines[index]);
                if (!item || /^\d/.test(item[1]) !== ordered) break;
                items.push(React.createElement('li', { key: `item-${index}` }, renderReadmeInline(item[2], baseUrl)));
                index += 1;
            }
            blocks.push(React.createElement(ordered ? 'ol' : 'ul', { key: `block-${index}` }, items));
            continue;
        }
        const paragraph = [line.trim()];
        index += 1;
        while (index < lines.length && lines[index].trim() &&
            !/^\s*```/.test(lines[index]) &&
            !/^(#{1,6})\s+/.test(lines[index]) &&
            !/^\s*(>|[-*+]\s+|\d+\.\s+)/.test(lines[index]) &&
            !/^\s*(?:(?:-{3,})|(?:_{3,})|(?:\*{3,}))\s*$/.test(lines[index])) {
            paragraph.push(lines[index].trim());
            index += 1;
        }
        blocks.push(React.createElement('p', { key: `block-${index}` },
            paragraph.flatMap((part, partIndex) => partIndex
                ? [React.createElement('br', { key: `break-${partIndex}` }), ...renderReadmeInline(part, baseUrl)]
                : renderReadmeInline(part, baseUrl))
        ));
    }
    return blocks;
}

const OPEN_VSX_API_URL = 'https://open-vsx.org/api';

function isOpenVsxApiUrl(value, expectedExtension) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'open-vsx.org' &&
            url.pathname.startsWith('/api/') && url.pathname.toLowerCase().endsWith(expectedExtension);
    } catch (error) {
        if (error instanceof TypeError) {
            return false;
        }
        throw error;
    }
}

async function fetchCompatibleOpenVsxExtensions(searchText, offset, signal) {
    const pageSize = 24;
    const params = new URLSearchParams({
        size: String(pageSize),
        offset: String(offset),
        sortBy: 'downloadCount',
        sortOrder: 'desc'
    });
    if (searchText.trim()) {
        params.set('query', searchText.trim().slice(0, 100));
    }
    const response = await fetch(`${OPEN_VSX_API_URL}/-/search?${params}`, {
        signal,
        headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
        throw new Error(`تعذّر البحث في Open VSX (HTTP ${response.status}).`);
    }
    const result = await response.json();
    if (!Array.isArray(result.extensions) || !Number.isFinite(result.totalSize)) {
        throw new Error('أعاد Open VSX نتائج غير صالحة.');
    }
    const checks = await Promise.all(result.extensions.map(async entry => {
        if (!entry || typeof entry.namespace !== 'string' || typeof entry.name !== 'string' ||
            typeof entry.version !== 'string' ||
            !/^[a-z0-9._-]+$/i.test(entry.namespace) ||
            !/^[a-z0-9._-]+$/i.test(entry.name) ||
            !/^[a-z0-9.+_-]+$/i.test(entry.version)) {
            return null;
        }
        const metadataResponse = await fetch(
            `${OPEN_VSX_API_URL}/${encodeURIComponent(entry.namespace)}/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`,
            { signal, headers: { Accept: 'application/json' } }
        );
        if (!metadataResponse.ok) {
            return null;
        }
        const metadata = await metadataResponse.json();
        if (!metadata || !isOpenVsxApiUrl(metadata.files?.manifest, '.json') ||
            !isOpenVsxApiUrl(metadata.files?.download, '.vsix')) {
            return null;
        }
        const manifestResponse = await fetch(metadata.files.manifest, {
            signal,
            headers: { Accept: 'application/json' }
        });
        if (!manifestResponse.ok) {
            return null;
        }
        const manifest = await manifestResponse.json();
        const compatibility = analyzeVscodeExtensionManifest(manifest);
        if (!isExtensionCompatible(manifest)) {
            return null;
        }
        return {
            id: `${entry.namespace}.${entry.name}`,
            name: typeof metadata.displayName === 'string' ? metadata.displayName : entry.name,
            description: typeof metadata.description === 'string' ? metadata.description : '',
            namespace: entry.namespace,
            version: entry.version,
            downloadUrl: metadata.files.download,
            openVsxUrl: `https://open-vsx.org/extension/${encodeURIComponent(entry.namespace)}/${encodeURIComponent(entry.name)}`,
            downloads: Number.isFinite(metadata.downloadCount) ? metadata.downloadCount : 0,
            compatibility
        };
    }));
    return {
        extensions: checks.filter(Boolean),
        totalSize: result.totalSize,
        hasMore: offset + result.extensions.length < result.totalSize
    };
}

function OpenVsxThemeLibrary({ pluginServer }) {
    const [themes, setThemes] = React.useState([]);
    const [query, setQuery] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [busyId, setBusyId] = React.useState('');
    const [offset, setOffset] = React.useState(0);
    const [totalSize, setTotalSize] = React.useState(0);
    const pageSize = 16;

    const searchThemes = async (nextOffset = 0, append = false, searchText = query) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({
                category: 'Themes',
                size: String(pageSize),
                offset: String(nextOffset),
                sortBy: 'timestamp',
                sortOrder: 'desc'
            });
            if (searchText.trim()) {
                params.set('query', searchText.trim().slice(0, 100));
            }
            const response = await fetch(`${OPEN_VSX_API_URL}/-/search?${params}`, {
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) {
                throw new Error(`تعذّر البحث في Open VSX (HTTP ${response.status}).`);
            }
            const result = await response.json();
            if (!Array.isArray(result.extensions) || !Number.isFinite(result.totalSize)) {
                throw new Error('أعاد Open VSX نتائج غير صالحة.');
            }
            const verifiedThemes = await Promise.all(result.extensions.map(async entry => {
                if (!entry || typeof entry.namespace !== 'string' || typeof entry.name !== 'string' ||
                    typeof entry.version !== 'string' ||
                    !/^[a-z0-9._-]+$/i.test(entry.namespace) ||
                    !/^[a-z0-9._-]+$/i.test(entry.name) ||
                    !/^[a-z0-9.+_-]+$/i.test(entry.version)) {
                    return null;
                }
                const metadataResponse = await fetch(
                    `${OPEN_VSX_API_URL}/${encodeURIComponent(entry.namespace)}/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`,
                    { headers: { Accept: 'application/json' } }
                );
                if (!metadataResponse.ok) {
                    return null;
                }
                const metadata = await metadataResponse.json();
                if (!metadata || !Array.isArray(metadata.categories) ||
                    !metadata.categories.includes('Themes') ||
                    !isOpenVsxApiUrl(metadata.files?.manifest, '.json') ||
                    !isOpenVsxApiUrl(metadata.files?.download, '.vsix')) {
                    return null;
                }
                const manifestResponse = await fetch(metadata.files.manifest, {
                    headers: { Accept: 'application/json' }
                });
                if (!manifestResponse.ok) {
                    return null;
                }
                const manifest = await manifestResponse.json();
                if (!Array.isArray(manifest.contributes?.themes) || !manifest.contributes.themes.length) {
                    return null;
                }
                return {
                    id: `${entry.namespace}.${entry.name}`,
                    name: typeof metadata.displayName === 'string' ? metadata.displayName : entry.name,
                    description: typeof metadata.description === 'string' ? metadata.description : '',
                    namespace: entry.namespace,
                    version: entry.version,
                    downloadUrl: metadata.files.download,
                    openVsxUrl: `https://open-vsx.org/extension/${encodeURIComponent(entry.namespace)}/${encodeURIComponent(entry.name)}`,
                    downloads: Number.isFinite(metadata.downloadCount) ? metadata.downloadCount : 0
                };
            }));
            const found = verifiedThemes.filter(Boolean);
            setThemes(current => append ? [...current, ...found] : found);
            setOffset(nextOffset);
            setTotalSize(result.totalSize);
            setNotice('');
        } catch (searchError) {
            setError(searchError instanceof Error ? searchError.message : 'تعذّر تحميل ثيمات Open VSX.');
            if (!append) {
                setThemes([]);
            }
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => {
        void searchThemes(0, false, '');
    }, []);

    const installThemeExtension = async theme => {
        if (!window.confirm(`تثبيت ثيم ${theme.name} من Open VSX؟ سيُضاف كملحق للمحرر.`)) {
            return;
        }
        setBusyId(theme.id);
        setNotice('');
        try {
            await pluginServer.install(theme.downloadUrl);
            setNotice(`تم تثبيت ${theme.name}. لاختياره، افتح قائمة الأوامر واختر Preferences: Color Theme.`);
        } catch (installError) {
            setNotice(installError instanceof Error ? installError.message : 'تعذّر تثبيت الثيم.');
        } finally {
            setBusyId('');
        }
    };

    return React.createElement(
        'section',
        { className: 'taskflow-store-section taskflow-open-vsx-themes', 'aria-label': 'ثيمات Open VSX' },
        React.createElement('h3', null, 'ثيمات Open VSX'),
        React.createElement('p', { className: 'taskflow-appearance-description' },
            'تصفّح ثيمات الألوان المنشورة في Open VSX. التثبيت يضيف الإضافة، ثم اختر الثيم من قائمة الأوامر.'
        ),
        React.createElement('form', {
            className: 'taskflow-open-vsx-search',
            onSubmit: event => {
                event.preventDefault();
                void searchThemes(0, false, query);
            }
        },
        React.createElement('input', {
            type: 'search',
            value: query,
            maxLength: 100,
            onChange: event => setQuery(event.currentTarget.value),
            placeholder: 'ابحث عن اسم الثيم أو وصفه',
            'aria-label': 'البحث عن ثيمات Open VSX'
        }),
        React.createElement('button', { type: 'submit', disabled: loading },
            loading ? 'جارٍ البحث...' : 'بحث'
        )),
        error && React.createElement('p', { className: 'taskflow-store-warning', role: 'alert' }, error),
        notice && React.createElement('p', { className: 'taskflow-store-notice', role: 'status' }, notice),
        loading && themes.length === 0
            ? React.createElement('p', { role: 'status' }, 'جارٍ تحميل أحدث الثيمات...')
            : themes.length
                ? React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'taskflow-open-vsx-theme-list' },
                        themes.map(theme => React.createElement('article', {
                            className: 'taskflow-store-card',
                            key: theme.id
                        },
                        React.createElement('strong', null, theme.name),
                        React.createElement('p', null, theme.description || 'ثيم ألوان للمحرر.'),
                        React.createElement('small', { className: 'taskflow-store-author' },
                            `${theme.namespace} · ${theme.version} · ${theme.downloads.toLocaleString()} تنزيل`
                        ),
                        React.createElement('a', {
                            className: 'taskflow-open-vsx-link',
                            href: theme.openVsxUrl,
                            target: '_blank',
                            rel: 'noopener noreferrer'
                        }, 'تفاصيل الثيم في Open VSX'),
                        React.createElement('button', {
                            type: 'button',
                            disabled: Boolean(busyId),
                            onClick: () => void installThemeExtension(theme)
                        }, busyId === theme.id ? 'جارٍ التثبيت...' : 'تثبيت الثيم')
                        ))
                    ),
                    offset + pageSize < totalSize && React.createElement('button', {
                        type: 'button',
                        disabled: loading,
                        onClick: () => void searchThemes(offset + pageSize, true)
                    }, loading ? 'جارٍ تحميل المزيد...' : 'تحميل المزيد')
                )
                : !loading && React.createElement('p', { className: 'taskflow-store-empty' },
                    query.trim() ? 'لم يُعثر على ثيمات تطابق البحث.' : 'لا توجد ثيمات متاحة حاليًا.'
                )
    );
}

function validateCatalog(value, assetPrefix = RAW_ASSET_PREFIX) {
    if (!isRecord(value) || value.version !== 1) {
        throw new Error('صيغة فهرس المتجر غير مدعومة.');
    }
    const catalog = {};
    for (const kind of ['themes', 'extensions', 'skills']) {
        if (!Array.isArray(value[kind])) {
            throw new Error(`قائمة ${kind} غير صالحة في فهرس المتجر.`);
        }
        if (!value[kind].every(item =>
            isRecord(item) && isSlug(item.id) &&
            typeof item.name === 'string' && item.name.length <= 80 &&
            typeof item.description === 'string' && item.description.length <= 500 &&
            typeof item.asset === 'string' &&
            (item.manifest === undefined || isRecord(item.manifest)) &&
            (item.author === undefined || (typeof item.author === 'string' && item.author.length <= 80)) &&
            (item.readme === undefined || (
                typeof item.readme === 'string' && item.readme.startsWith(`${kind}/`) &&
                item.readme.toLowerCase().endsWith('.md') && safeAssetUrl(item.readme, assetPrefix)
            )) &&
            (item.preview === undefined || (
                typeof item.preview === 'string' && item.preview.startsWith(`${kind}/`) &&
                /\.(?:png|jpe?g|webp)$/i.test(item.preview) && safeAssetUrl(item.preview, assetPrefix)
            )))) {
            throw new Error(`يوجد عنصر غير صالح في قائمة ${kind}.`);
        }
        const ids = value[kind].map(item => item.id);
        if (new Set(ids).size !== ids.length) {
            throw new Error(`تحتوي قائمة ${kind} على معرّفات مكررة.`);
        }
        catalog[kind] = value[kind];
    }
    return catalog;
}

function validateTheme(value) {
    if (!isRecord(value) || typeof value.name !== 'string' || value.name.trim() !== value.name ||
        value.name.length < 1 || value.name.length > 80 || !isRecord(value.colors)) {
        throw new Error('ملف السمة لا يطابق صيغة TaskFlow Theme.');
    }
    if (Object.keys(value).some(key => ![
        'name', 'glass', 'colors', 'sizes', 'fonts', 'glassSettings', 'controls', 'buttonSettings', 'motion'
    ].includes(key))) {
        throw new Error('ملف السمة يحتوي على حقول غير مدعومة في Theme Coding v3.');
    }
    const colors = {};
    for (const [key, cssVariable] of Object.entries(THEME_VARIABLES)) {
        const color = value.colors[key];
        if (color !== undefined) {
            if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
                throw new Error(`قيمة اللون ${key} غير صالحة.`);
            }
            colors[cssVariable] = color;
        }
    }
    if (Object.keys(value.colors).some(key => !Object.prototype.hasOwnProperty.call(THEME_VARIABLES, key))) {
        throw new Error('ملف السمة يحتوي على مفاتيح ألوان غير مدعومة في Theme Coding v3.');
    }
    const sizes = {};
    if (value.sizes !== undefined) {
        if (!isRecord(value.sizes)) {
            throw new Error('إعدادات أحجام السمة غير صالحة.');
        }
        const limits = {
            uiFontSize: [11, 18],
            cornerRadius: [0, 18],
            editorFontSize: [10, 24]
        };
        for (const [key, size] of Object.entries(value.sizes)) {
            if (!Object.prototype.hasOwnProperty.call(limits, key)) {
                throw new Error(`إعداد الحجم ${key} غير مدعوم في Theme Coding v3.`);
            }
            const [minimum, maximum] = limits[key];
            if (typeof size !== 'number' || !Number.isFinite(size) || size < minimum || size > maximum) {
                throw new Error(`إعداد الحجم ${key} يجب أن يكون بين ${minimum} و${maximum}.`);
            }
            sizes[key] = size;
        }
    }
    const fonts = {};
    if (value.fonts !== undefined) {
        if (!isRecord(value.fonts) || Object.keys(value.fonts).some(key => !['ui', 'editor'].includes(key))) {
            throw new Error('إعدادات الخطوط غير صالحة.');
        }
        for (const [key, font] of Object.entries(value.fonts)) {
            if (typeof font !== 'string' || !Object.prototype.hasOwnProperty.call(THEME_FONTS[key], font)) {
                throw new Error(`عائلة الخط ${key} غير مدعومة.`);
            }
            fonts[key] = font;
        }
    }
    const glassSettings = {};
    if (value.glassSettings !== undefined) {
        if (!isRecord(value.glassSettings)) {
            throw new Error('إعدادات الزجاج غير صالحة.');
        }
        const limits = { blur: [0, 36], opacity: [10, 92], saturation: [60, 180] };
        for (const [key, setting] of Object.entries(value.glassSettings)) {
            if (key === 'tint') {
                if (typeof setting !== 'string' || !/^#[0-9a-f]{6}$/i.test(setting)) {
                    throw new Error('لون الزجاج غير صالح.');
                }
            } else if (!Object.prototype.hasOwnProperty.call(limits, key) ||
                typeof setting !== 'number' || !Number.isFinite(setting) ||
                setting < limits[key][0] || setting > limits[key][1]) {
                throw new Error(`إعداد الزجاج ${key} خارج النطاق المسموح.`);
            }
            glassSettings[key] = setting;
        }
    }
    const controls = value.controls ?? [...THEME_SETTING_CONTROLS];
    if (!Array.isArray(controls) || controls.length > THEME_SETTING_CONTROLS.length ||
        controls.some(control => typeof control !== 'string' || !THEME_SETTING_CONTROLS.includes(control)) ||
        new Set(controls).size !== controls.length) {
        throw new Error('قائمة إعدادات الثيم تحتوي على عناصر غير مدعومة أو مكررة.');
    }
    const buttonSettings = {};
    if (value.buttonSettings !== undefined) {
        if (!isRecord(value.buttonSettings)) {
            throw new Error('إعدادات الأزرار غير صالحة.');
        }
        for (const [key, setting] of Object.entries(value.buttonSettings)) {
            if (key === 'style') {
                if (!THEME_BUTTON_STYLES.includes(setting)) throw new Error('نمط الأزرار غير مدعوم.');
            } else if (key === 'radius') {
                if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 0 || setting > 24) {
                    throw new Error('استدارة الأزرار يجب أن تكون بين 0 و24 بكسل.');
                }
            } else if (key === 'height') {
                if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 28 || setting > 52) {
                    throw new Error('ارتفاع الأزرار يجب أن يكون بين 28 و52 بكسل.');
                }
            } else {
                throw new Error(`إعداد الزر ${key} غير مدعوم.`);
            }
            buttonSettings[key] = setting;
        }
    }
    const motion = {};
    if (value.motion !== undefined) {
        if (!isRecord(value.motion)) {
            throw new Error('إعدادات الحركة غير صالحة.');
        }
        for (const [key, setting] of Object.entries(value.motion)) {
            if (key === 'preset') {
                if (!THEME_MOTION_PRESETS.includes(setting)) throw new Error('نمط الحركة غير مدعوم.');
            } else if (key === 'duration') {
                if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 80 || setting > 500) {
                    throw new Error('مدة الحركة يجب أن تكون بين 80 و500 مللي ثانية.');
                }
            } else if (key === 'hoverLift') {
                if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 0 || setting > 4) {
                    throw new Error('ارتفاع الأزرار عند المرور يجب أن يكون بين 0 و4 بكسل.');
                }
            } else {
                throw new Error(`إعداد الحركة ${key} غير مدعوم.`);
            }
            motion[key] = setting;
        }
    }
    return {
        name: value.name,
        glass: value.glass === true,
        colors,
        sizes,
        fonts,
        glassSettings,
        controls,
        buttonSettings,
        motion
    };
}

function applyAppearance(appearance) {
    const root = document.documentElement;
    for (const [variable, original] of previousThemeVariableValues) {
        if (original.value) {
            root.style.setProperty(variable, original.value, original.priority);
        } else {
            root.style.removeProperty(variable);
        }
    }
    previousThemeVariableValues.clear();
    root.removeAttribute('data-taskflow-glass');
    root.removeAttribute('data-taskflow-motion');
    root.removeAttribute('data-taskflow-button-style');
    if (appearance) {
        for (const [variable, color] of Object.entries(appearance.colors ?? {})) {
            if (Object.values(THEME_VARIABLES).includes(variable) &&
                typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
                previousThemeVariableValues.set(variable, {
                    value: root.style.getPropertyValue(variable),
                    priority: root.style.getPropertyPriority(variable)
                });
                root.style.setProperty(variable, color);
            }
        }
        for (const [key, variable] of Object.entries(THEME_SIZE_VARIABLES)) {
            const size = appearance.sizes?.[key];
            if (typeof size === 'number' && Number.isFinite(size)) {
                previousThemeVariableValues.set(variable, {
                    value: root.style.getPropertyValue(variable),
                    priority: root.style.getPropertyPriority(variable)
                });
                root.style.setProperty(variable, `${size}px`);
            }
        }
        for (const [key, variable] of Object.entries(THEME_GLASS_VARIABLES)) {
            const setting = appearance.glassSettings?.[key];
            const defaultValue = key === 'tint' ? '#9b87ef' : { blur: 20, opacity: 68, saturation: 125 }[key];
            const value = setting ?? defaultValue;
            previousThemeVariableValues.set(variable, {
                value: root.style.getPropertyValue(variable),
                priority: root.style.getPropertyPriority(variable)
            });
            root.style.setProperty(variable, key === 'tint' ? value : `${value}${key === 'blur' ? 'px' : '%'}`);
        }
        const buttonValues = {
            radius: appearance.buttonSettings?.radius,
            height: appearance.buttonSettings?.height,
            duration: appearance.motion?.duration,
            hoverLift: appearance.motion?.hoverLift
        };
        for (const [key, variable] of Object.entries(THEME_BUTTON_VARIABLES)) {
            const setting = buttonValues[key];
            if (typeof setting === 'number') {
                previousThemeVariableValues.set(variable, {
                    value: root.style.getPropertyValue(variable),
                    priority: root.style.getPropertyPriority(variable)
                });
                root.style.setProperty(variable, `${setting}${key === 'duration' ? 'ms' : 'px'}`);
            }
        }
        if (THEME_MOTION_PRESETS.includes(appearance.motion?.preset)) {
            root.setAttribute('data-taskflow-motion', appearance.motion.preset);
        }
        if (THEME_BUTTON_STYLES.includes(appearance.buttonSettings?.style)) {
            root.setAttribute('data-taskflow-button-style', appearance.buttonSettings.style);
        }
        const wallpaper = localStorage.getItem(GLASS_WALLPAPER_KEY);
        if (isSafeGlassWallpaper(wallpaper)) {
            previousThemeVariableValues.set('--taskflow-theme-glass-wallpaper', {
                value: root.style.getPropertyValue('--taskflow-theme-glass-wallpaper'),
                priority: root.style.getPropertyPriority('--taskflow-theme-glass-wallpaper')
            });
            root.style.setProperty('--taskflow-theme-glass-wallpaper', `url("${wallpaper}")`);
        }
        for (const [key, variable] of [['ui', '--theia-ui-font-family'], ['editor', '--theia-editor-font-family']]) {
            const font = appearance.fonts?.[key];
            if (font) {
                previousThemeVariableValues.set(variable, {
                    value: root.style.getPropertyValue(variable),
                    priority: root.style.getPropertyPriority(variable)
                });
                root.style.setProperty(variable, THEME_FONTS[key][font]);
            }
        }
        if (appearance.glass) {
            root.setAttribute('data-taskflow-glass', 'true');
        }
    }
}

function assetPath(item, kind, assetPrefix = RAW_ASSET_PREFIX) {
    if (!isSlug(item.id)) {
        throw new Error('معرّف عنصر المتجر غير صالح.');
    }
    const path = item.asset;
    if (!path.startsWith(`${kind}/`)) {
        throw new Error('مسار عنصر المتجر خارج مجلده المخصص.');
    }
    if (kind === 'extensions' && !path.toLowerCase().endsWith('.vsix')) {
        throw new Error('حزمة الإضافة يجب أن تكون ملف VSIX.');
    }
    if (kind === 'skills' && !path.endsWith('/SKILL.md')) {
        throw new Error('المهارة يجب أن تشير إلى ملف SKILL.md.');
    }
    if (kind === 'themes' && !path.toLowerCase().endsWith('.json')) {
        throw new Error('السمة يجب أن تكون ملف JSON آمنًا.');
    }
    return safeAssetUrl(path, assetPrefix);
}

function taskflowSessionHeaders() {
    const token = window.taskflowSessionToken;
    if (typeof token !== 'string' || !token) {
        throw new Error('سجّل الدخول إلى منصة TaskFlow لربط المهارات بحسابك.');
    }
    const headers = new Headers();
    headers.set('Authorization', ['Bearer', token].join(' '));
    return Object.fromEntries(headers.entries());
}

function parseSkillInstructions(content, id, label, description, source) {
    if (typeof content !== 'string' || !content.trim().startsWith('---') ||
        content.length > 1_000_000 || content.includes('\0')) {
        throw new Error('ملف المهارة فارغ أو لا يحتوي على ترويسة SKILL.md صالحة.');
    }
    const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(content);
    if (!frontmatter) {
        throw new Error('ترويسة SKILL.md غير مكتملة.');
    }
    const readField = (field, fallback) => {
        const value = new RegExp(`^${field}:\\s*(.*?)\\s*$`, 'im').exec(frontmatter[1])?.[1];
        return value?.replace(/^(["'])(.*)\1$/, '$2').trim() || fallback;
    };
    const skillName = readField('name', id);
    const normalizedName = skillName.toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(normalizedName)) {
        throw new Error('اسم المهارة داخل SKILL.md غير صالح.');
    }
    const template = content.slice(frontmatter[0].length).trim();
    if (!template) {
        throw new Error('ملف المهارة لا يحتوي على تعليمات.');
    }
    return {
        id: source === 'TaskFlow Skills' ? `taskflow-${id}` : `skills-sh:${id}`,
        label: label || skillName,
        shortcut: `/${normalizedName}`,
        description: description || readField('description', 'مهارة مشتركة'),
        template,
        accent: '#10b981',
        kind: 'custom',
        source
    };
}

async function syncSkillToTaskflowAccount(skill, apiBase) {
    const base = typeof apiBase === 'string' && apiBase ? apiBase.replace(/\/+$/, '') : '';
    if (!base) {
        throw new Error('لا يوجد اتصال بمنصة TaskFlow لمزامنة المهارة مع محادثة AI.');
    }
    const headers = { ...taskflowSessionHeaders(), Accept: 'application/json' };
    const response = await fetch(`${base}${TASKFLOW_APP_DATA_URL}`, { headers });
    if (!response.ok) {
        throw new Error(`تعذّر تحميل مهارات حساب TaskFlow (${response.status}).`);
    }
    const payload = await response.json();
    const records = payload?.records;
    const currentSkills = records?.skills?.value ?? [];
    if (!Array.isArray(currentSkills)) {
        throw new Error('قائمة مهارات حساب TaskFlow غير صالحة.');
    }
    if (currentSkills.some(item => item && item.id === skill.id)) {
        return;
    }
    const nextSkills = [{
        ...skill,
        source: skill.source
    }, ...currentSkills];
    const saveResponse = await fetch(`${base}${TASKFLOW_APP_DATA_URL}/skills`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: nextSkills })
    });
    if (!saveResponse.ok) {
        throw new Error(`تعذّرت مزامنة المهارة مع محادثات AI (${saveResponse.status}).`);
    }
}

async function installSkillToWorkspace(fileService, workspaceService, skillId, content) {
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(skillId)) {
        throw new Error('معرّف المهارة غير صالح لمساحة العمل.');
    }
    const roots = await workspaceService.roots;
    const workspace = roots[0]?.resource;
    if (!workspace) {
        throw new Error('افتح مساحة عمل قبل تثبيت مهارة.');
    }
    const directory = workspace.resolve(`.agents/skills/${skillId.toLowerCase()}`);
    const skillFile = directory.resolve('SKILL.md');
    if (await fileService.exists(skillFile)) {
        throw new Error('المهارة مثبتة بالفعل في مساحة العمل.');
    }
    await fileService.createFolder(directory);
    await fileService.write(skillFile, content);
}

function TaskflowSkillLibraries({ fileService, workspaceService }) {
    const [taskflowSkills, setTaskflowSkills] = React.useState([]);
    const [popularSkills, setPopularSkills] = React.useState([]);
    const [accountSkills, setAccountSkills] = React.useState([]);
    const [query, setQuery] = React.useState('');
    const [loadingTaskflow, setLoadingTaskflow] = React.useState(true);
    const [loadingPopular, setLoadingPopular] = React.useState(true);
    const [busyId, setBusyId] = React.useState('');
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [apiBase, setApiBase] = React.useState('');

    React.useEffect(() => {
        let active = true;
        let platformRequestController;
        const loadPlatformLibraries = () => {
            const base = typeof window.taskflowApiBase === 'string' ? window.taskflowApiBase : '';
            if (!base) {
                return;
            }
            setApiBase(base);
            setError('');
            setLoadingPopular(true);
            platformRequestController?.abort();
            const controller = new AbortController();
            platformRequestController = controller;
            const requestHeaders = { ...taskflowSessionHeaders(), Accept: 'application/json' };

            void fetch(`${base.replace(/\/+$/, '')}${TASKFLOW_APP_DATA_URL}`, {
                signal: controller.signal,
                headers: requestHeaders
            }).then(async response => {
                if (!response.ok) {
                    throw new Error(`تعذّر تحميل مهارات حساب TaskFlow (${response.status}).`);
                }
                const result = await response.json();
                const saved = result?.records?.skills?.value ?? [];
                if (!Array.isArray(saved)) {
                    throw new Error('قائمة مهارات حساب TaskFlow غير صالحة.');
                }
                if (active) setAccountSkills(saved.filter(item =>
                    item && typeof item.id === 'string' &&
                    typeof item.label === 'string' &&
                    typeof item.description === 'string' &&
                    typeof item.template === 'string'
                ));
            }).catch(fetchError => {
                if (active && fetchError?.name !== 'AbortError') {
                    setError(fetchError instanceof Error ? fetchError.message : 'تعذّر تحميل مهارات الحساب.');
                }
            });

            void fetch(`${base.replace(/\/+$/, '')}${TASKFLOW_SKILLS_API_URL}/popular`, {
                signal: controller.signal,
                headers: requestHeaders
            }).then(async response => {
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(typeof result?.detail === 'string'
                        ? result.detail
                        : `تعذّر تحميل skills.sh (HTTP ${response.status}).`);
                }
                if (!Array.isArray(result?.skills)) {
                    throw new Error('استجابة مكتبة skills.sh غير صالحة.');
                }
                if (active) setPopularSkills(result.skills);
            }).catch(fetchError => {
                if (active && fetchError?.name !== 'AbortError') {
                    setPopularSkills([]);
                    setError(fetchError instanceof Error ? fetchError.message : 'تعذّر الاتصال بمكتبة skills.sh.');
                }
            }).finally(() => {
                if (active && !controller.signal.aborted) setLoadingPopular(false);
            });
        };
        const onPlatformInitialized = () => loadPlatformLibraries();
        window.addEventListener('taskflow:platform-initialized', onPlatformInitialized);
        void fetch(TASKFLOW_SKILL_REPOSITORY.catalogUrl, {
            headers: { Accept: 'application/json' }
        }).then(async response => {
            if (!response.ok) {
                throw new Error(`تعذّر تحميل مكتبة TaskFlow Skills (HTTP ${response.status}).`);
            }
            return validateCatalog(await response.json(), TASKFLOW_SKILL_REPOSITORY.assetPrefix);
        }).then(catalog => {
            if (active) setTaskflowSkills(catalog.skills);
        }).catch(fetchError => {
            if (active) setError(fetchError instanceof Error ? fetchError.message : 'تعذّر تحميل مكتبة TaskFlow Skills.');
        }).finally(() => {
            if (active) setLoadingTaskflow(false);
        });

        if (typeof window.taskflowApiBase !== 'string' || !window.taskflowApiBase) {
            setError('اتصل بمنصة TaskFlow لعرض مكتبة المهارات المشتركة.');
            setLoadingPopular(false);
        } else {
            loadPlatformLibraries();
        }
        return () => {
            active = false;
            platformRequestController?.abort();
            window.removeEventListener('taskflow:platform-initialized', onPlatformInitialized);
        };
    }, []);

    const searchPopular = async event => {
        event.preventDefault();
        const searchTerm = query.trim();
        if (searchTerm.length < 2) {
            setError('اكتب حرفين على الأقل للبحث في skills.sh.');
            return;
        }
        if (!apiBase) {
            setError('اتصل بمنصة TaskFlow وسجّل الدخول للبحث في skills.sh.');
            return;
        }
        setLoadingPopular(true);
        setError('');
        try {
            const params = new URLSearchParams({ q: searchTerm.slice(0, 100) });
            const response = await fetch(
                `${apiBase.replace(/\/+$/, '')}${TASKFLOW_SKILLS_API_URL}/search?${params}`,
                { headers: { ...taskflowSessionHeaders(), Accept: 'application/json' } }
            );
            const result = await response.json();
            if (!response.ok) {
                throw new Error(typeof result?.detail === 'string'
                    ? result.detail
                    : `تعذّر البحث في skills.sh (HTTP ${response.status}).`);
            }
            if (!Array.isArray(result?.skills)) {
                throw new Error('استجابة البحث في skills.sh غير صالحة.');
            }
            setPopularSkills(result.skills);
        } catch (searchError) {
            setError(searchError instanceof Error ? searchError.message : 'تعذّر البحث في skills.sh.');
        } finally {
            setLoadingPopular(false);
        }
    };

    const installSharedSkill = async (item, publicSkill = false) => {
        const identity = publicSkill ? `${item.source}/${item.skill_id}` : item.id;
        const installId = publicSkill
            ? `skills-sh:${identity}`
            : `taskflow-${item.id}`;
        if (!window.confirm(`إضافة ${item.name} إلى مساحة العمل وحساب TaskFlow؟ ستُرسل تعليماتها إلى مزوّد AI عند استخدام المهارة.`)) {
            return;
        }
        setBusyId(installId);
        setError('');
        setNotice('');
        try {
            let content;
            let description;
            let source;
            let workspaceId;
            if (publicSkill) {
                if (typeof item.source !== 'string' || typeof item.skill_id !== 'string') {
                    throw new Error('بيانات المهارة من skills.sh غير صالحة.');
                }
                const params = new URLSearchParams({ source: item.source, skill_id: item.skill_id });
                const response = await fetch(
                    `${apiBase.replace(/\/+$/, '')}${TASKFLOW_SKILLS_API_URL}/content?${params}`,
                    { headers: { ...taskflowSessionHeaders(), Accept: 'application/json' } }
                );
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(typeof result?.detail === 'string' ? result.detail : `تعذّر تحميل المهارة (${response.status}).`);
                }
                if (typeof result?.content !== 'string') {
                    throw new Error('استجابة ملف المهارة من skills.sh غير صالحة.');
                }
                content = result.content;
                description = '';
                source = `skills.sh:${item.source}`;
                workspaceId = `${item.source.replace(/[/.]/g, '-')}-${item.skill_id}`;
            } else {
                const asset = assetPath(item, 'skills', TASKFLOW_SKILL_REPOSITORY.assetPrefix);
                const response = await fetch(asset, { headers: { Accept: 'text/markdown' } });
                if (!response.ok) {
                    throw new Error(`تعذّر تحميل مهارة TaskFlow (HTTP ${response.status}).`);
                }
                content = await response.text();
                description = item.description;
                source = 'TaskFlow Skills';
                workspaceId = item.id;
            }
            const skill = parseSkillInstructions(content, identity, item.name, description, source);
            await installSkillToWorkspace(fileService, workspaceService, workspaceId, content);
            try {
                await syncSkillToTaskflowAccount(skill, apiBase);
            } catch (syncError) {
                throw new Error(
                    `ثُبّتت المهارة في مساحة العمل، لكن تعذّرت مزامنتها مع حساب TaskFlow: ${
                        syncError instanceof Error ? syncError.message : 'خطأ غير معروف.'
                    }`
                );
            }
            setNotice(`أُضيفت ${item.name} إلى مساحة العمل وحسابك؛ ستظهر الآن في محادثات AI لهذا الحساب.`);
        } catch (installError) {
            setError(installError instanceof Error ? installError.message : 'تعذّر إضافة المهارة.');
        } finally {
            setBusyId('');
        }
    };

    const installAccountSkill = async skill => {
        const directoryId = `account-${String(skill.id).replace(/[^a-z0-9._-]/gi, '-')}`.slice(0, 100);
        const frontmatterName = skill.shortcut?.replace(/^\//, '') ||
            skill.label.toLowerCase().replace(/[^a-z0-9._-]+/g, '-') ||
            directoryId;
        const content = `---\nname: ${JSON.stringify(frontmatterName)}\ndescription: ${JSON.stringify(skill.description.slice(0, 500))}\n---\n\n${skill.template}`;
        setBusyId(directoryId);
        setError('');
        setNotice('');
        try {
            await installSkillToWorkspace(fileService, workspaceService, directoryId, content);
            setNotice(`أُضيفت مهارة حسابك ${skill.label} إلى مساحة العمل المفتوحة.`);
        } catch (installError) {
            setError(installError instanceof Error ? installError.message : 'تعذّر إضافة مهارة الحساب إلى مساحة العمل.');
        } finally {
            setBusyId('');
        }
    };

    const renderSkillCard = (item, publicSkill = false) => {
        const identity = publicSkill ? `${item.source}/${item.skill_id}` : item.id;
        const installId = publicSkill ? `skills-sh:${identity}` : `taskflow-${item.id}`;
        return React.createElement('article', { className: 'taskflow-store-card', key: item.id },
            React.createElement('strong', null, item.name),
            React.createElement('p', null, item.description || 'مهارة عامة لمساعدي AI.'),
            React.createElement('small', { className: 'taskflow-store-author' },
                publicSkill
                    ? `${item.source} · ${Number(item.installs || 0).toLocaleString()} تثبيت${item.official ? ' · رسمية' : ''}`
                    : 'AI TaskFlow'
            ),
            publicSkill && React.createElement('a', {
                className: 'taskflow-open-vsx-link',
                href: `https://skills.sh/${item.source.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(item.skill_id)}`,
                target: '_blank',
                rel: 'noopener noreferrer'
            }, 'تفاصيل المهارة ومصدرها'),
            React.createElement('button', {
                type: 'button',
                disabled: Boolean(busyId),
                onClick: () => void installSharedSkill(item, publicSkill)
            }, busyId === installId ? 'جارٍ الإضافة...' : 'إضافة إلى الحساب ومكان العمل')
        );
    };

    return React.createElement('section', {
        className: 'taskflow-store-section taskflow-shared-skill-library',
        'aria-label': 'مكتبات المهارات المشتركة'
    },
    React.createElement('h3', null, 'مكتبات المهارات المشتركة'),
    React.createElement('p', { className: 'taskflow-appearance-description' },
        'المهارة التي تضيفها تُحفظ في مساحة العمل المفتوحة وحساب TaskFlow، لتستخدمها في المنصة ومحادثات AI عبر المزوّد المحدد.'
    ),
    error && React.createElement('p', { className: 'taskflow-store-warning', role: 'alert' }, error),
    notice && React.createElement('p', { className: 'taskflow-store-notice', role: 'status' }, notice),
    React.createElement('div', { className: 'taskflow-shared-skill-columns' },
        React.createElement('section', { className: 'taskflow-shared-skill-source', 'aria-label': 'مهارات حساب TaskFlow' },
            React.createElement('strong', null, 'مهارات حسابك'),
            React.createElement('p', { className: 'taskflow-appearance-description' },
                'المهارات التي أضفتها إلى حسابك في المنصة متاحة هنا لإضافتها إلى مساحة العمل.'
            ),
            accountSkills.length
                ? React.createElement('div', { className: 'taskflow-shared-skill-list' },
                    accountSkills.map(skill => React.createElement('article', {
                        className: 'taskflow-store-card',
                        key: skill.id
                    },
                    React.createElement('strong', null, skill.label),
                    React.createElement('p', null, skill.description),
                    React.createElement('button', {
                        type: 'button',
                        disabled: Boolean(busyId),
                        onClick: () => void installAccountSkill(skill)
                    }, busyId === `account-${String(skill.id).replace(/[^a-z0-9._-]/gi, '-')}`.slice(0, 100)
                        ? 'جارٍ الإضافة...'
                        : 'إضافة إلى مساحة العمل')
                    ))
                )
                : !loadingPopular && React.createElement('p', { className: 'taskflow-store-empty' },
                    'لا توجد مهارات مضافة إلى هذا الحساب بعد.'
                )
        ),
        React.createElement('section', { className: 'taskflow-shared-skill-source', 'aria-label': 'مكتبة TaskFlow' },
            React.createElement('strong', null, 'AI TaskFlow Skills'),
            React.createElement('a', {
                href: 'https://github.com/ADAM-MAHMOUD12/AI-TASKFLO-SKILLS',
                target: '_blank',
                rel: 'noopener noreferrer'
            }, 'المكتبة الرسمية'),
            loadingTaskflow
                ? React.createElement('p', { role: 'status' }, 'جارٍ تحميل مهارات TaskFlow...')
                : taskflowSkills.length
                    ? React.createElement('div', { className: 'taskflow-shared-skill-list' },
                        taskflowSkills.map(item => renderSkillCard(item))
                    )
                    : React.createElement('p', { className: 'taskflow-store-empty' }, 'لا توجد مهارات في المكتبة حاليًا.')
        ),
        React.createElement('section', { className: 'taskflow-shared-skill-source', 'aria-label': 'مكتبة skills.sh' },
            React.createElement('strong', null, 'skills.sh'),
            React.createElement('a', {
                href: 'https://skills.sh/',
                target: '_blank',
                rel: 'noopener noreferrer'
            }, 'المكتبة العامة'),
            React.createElement('form', {
                className: 'taskflow-open-vsx-search',
                onSubmit: event => void searchPopular(event)
            },
            React.createElement('input', {
                type: 'search',
                value: query,
                minLength: 2,
                maxLength: 100,
                onChange: event => setQuery(event.currentTarget.value),
                placeholder: 'ابحث عن مهارة عامة',
                'aria-label': 'البحث في مكتبة skills.sh'
            }),
            React.createElement('button', { type: 'submit', disabled: loadingPopular }, 'بحث')),
            loadingPopular
                ? React.createElement('p', { role: 'status' }, 'جارٍ تحميل المهارات الشائعة...')
                : popularSkills.length
                    ? React.createElement('div', { className: 'taskflow-shared-skill-list' },
                        popularSkills.map(item => renderSkillCard(item, true))
                    )
                    : React.createElement('p', { className: 'taskflow-store-empty' },
                        query ? 'لم يُعثر على مهارات تطابق البحث.' : 'لا توجد نتائج متاحة حاليًا.'
                    )
        )
    ));
}

function TaskflowAppearancePanel({ pluginServer, fileService, workspaceService, commandRegistry, preferenceService }) {
    const [catalog, setCatalog] = React.useState(DEFAULT_CATALOG);
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [catalogError, setCatalogError] = React.useState('');
    const [installedAppearance, setInstalledAppearance] = React.useState(null);
    const [installedThemes, setInstalledThemes] = React.useState([]);
    const [glassWallpaper, setGlassWallpaper] = React.useState(() => {
        const saved = localStorage.getItem(GLASS_WALLPAPER_KEY);
        return isSafeGlassWallpaper(saved) ? saved : '';
    });
    const [themeSettingsOpen, setThemeSettingsOpen] = React.useState(false);
    const [themeSettingsDraft, setThemeSettingsDraft] = React.useState(null);
    const [readmePreviews, setReadmePreviews] = React.useState({});
    const themeSettingsSnapshot = React.useRef(null);
    const themeFileInput = React.useRef(null);
    const extensionFileInput = React.useRef(null);

    React.useEffect(() => {
        try {
            const saved = localStorage.getItem(APPEARANCE_KEY);
            if (saved) {
                const appearance = validateTheme(JSON.parse(saved));
                applyAppearance(appearance);
                setInstalledAppearance(appearance);
                if (typeof appearance.sizes?.editorFontSize === 'number') {
                    void preferenceService.set('editor.fontSize', appearance.sizes.editorFontSize, PreferenceScope.User)
                        .catch(error => {
                            console.error('Could not restore the themed editor font size.', error);
                            setNotice('تعذّر استعادة حجم خط المحرر للثيم؛ راجع إعدادات المحرر.');
                        });
                }
                if (appearance.fonts?.editor) {
                    void preferenceService.set('editor.fontFamily', THEME_FONTS.editor[appearance.fonts.editor], PreferenceScope.User)
                        .catch(error => {
                            console.error('Could not restore the themed editor font family.', error);
                            setNotice('تعذّر استعادة خط المحرر للثيم؛ راجع إعدادات المحرر.');
                        });
                }
            }
            const storedThemes = localStorage.getItem(INSTALLED_THEMES_KEY);
            const themes = storedThemes === null ? [] : JSON.parse(storedThemes);
            if (!Array.isArray(themes)) {
                throw new Error('قائمة الثيمات المثبتة غير صالحة.');
            }
            const validatedThemes = themes.map(validateTheme);
            if (saved) {
                const active = validateTheme(JSON.parse(saved));
                if (!validatedThemes.some(theme => theme.name === active.name)) {
                    validatedThemes.push(active);
                }
            }
            setInstalledThemes(validatedThemes);
            if (validatedThemes.length) {
                localStorage.setItem(INSTALLED_THEMES_KEY, JSON.stringify(validatedThemes));
            }
        } catch (error) {
            console.error('Could not restore the TaskFlow editor appearance.', error);
            setNotice('تعذّر استعادة المظهر المحفوظ؛ استخدم إعادة الضبط للعودة إلى الشكل الأصلي.');
        }
        const controller = new AbortController();
        void fetch(CATALOG_URL, { signal: controller.signal, headers: { Accept: 'application/json' } })
            .then(async response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return validateCatalog(await response.json());
            })
            .then(setCatalog)
            .catch(error => {
                if (error?.name !== 'AbortError') {
                    setCatalogError('مستودع المتجر غير متاح حاليًا. ستظل أوضاع المظهر المحلية متاحة.');
                    console.error('TaskFlow marketplace catalog could not be loaded.', error);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            });
        return () => controller.abort();
    }, []);

    React.useEffect(() => {
        if (!themeSettingsOpen || !themeSettingsDraft) return undefined;
        applyAppearance(themeSettingsDraft);
        const timer = window.setTimeout(() => {
            const updates = [];
            if (typeof themeSettingsDraft.sizes?.editorFontSize === 'number') {
                updates.push(preferenceService.set(
                    'editor.fontSize',
                    themeSettingsDraft.sizes.editorFontSize,
                    PreferenceScope.User
                ));
            }
            if (themeSettingsDraft.fonts?.editor) {
                updates.push(preferenceService.set(
                    'editor.fontFamily',
                    THEME_FONTS.editor[themeSettingsDraft.fonts.editor],
                    PreferenceScope.User
                ));
            }
            void Promise.all(updates).catch(error => {
                console.error('Could not update editor typography during theme preview.', error);
                setNotice('تعذّر تحديث خط المحرر أثناء المعاينة؛ راجع إعدادات المحرر.');
            });
        }, 80);
        return () => window.clearTimeout(timer);
    }, [themeSettingsOpen, themeSettingsDraft, preferenceService]);

    React.useEffect(() => () => {
        const snapshot = themeSettingsSnapshot.current;
        if (!snapshot) return;
        applyAppearance(snapshot.appearance);
        if (snapshot.wallpaper) {
            localStorage.setItem(GLASS_WALLPAPER_KEY, snapshot.wallpaper);
        } else {
            localStorage.removeItem(GLASS_WALLPAPER_KEY);
        }
        void Promise.all([
            preferenceService.set('editor.fontSize', snapshot.editorFontSize, PreferenceScope.User),
            preferenceService.set('editor.fontFamily', snapshot.editorFontFamily, PreferenceScope.User)
        ]).catch(error => console.error('Could not restore theme preview after closing Appearance.', error));
    }, [preferenceService]);

    const updateEditorFontSize = async size => {
        const original = localStorage.getItem(EDITOR_FONT_SIZE_KEY);
        if (typeof size === 'number') {
            if (original === null) {
                const baseline = preferenceService.get('editor.fontSize', 14);
                localStorage.setItem(EDITOR_FONT_SIZE_KEY, String(baseline));
            }
            await preferenceService.set('editor.fontSize', size, PreferenceScope.User);
        } else if (original !== null) {
            const parsed = Number(original);
            if (!Number.isFinite(parsed) || parsed < 10 || parsed > 24) {
                throw new Error('قيمة حجم المحرر المحفوظة غير صالحة؛ أعد ضبط حجم الخط من إعدادات المحرر.');
            }
            await preferenceService.set('editor.fontSize', parsed, PreferenceScope.User);
            localStorage.removeItem(EDITOR_FONT_SIZE_KEY);
        }
    };

    const updateEditorFontFamily = async font => {
        const original = localStorage.getItem(EDITOR_FONT_FAMILY_KEY);
        if (font) {
            if (original === null) {
                localStorage.setItem(EDITOR_FONT_FAMILY_KEY, preferenceService.get('editor.fontFamily', 'monospace'));
            }
            await preferenceService.set('editor.fontFamily', THEME_FONTS.editor[font], PreferenceScope.User);
        } else if (original !== null) {
            await preferenceService.set('editor.fontFamily', original, PreferenceScope.User);
            localStorage.removeItem(EDITOR_FONT_FAMILY_KEY);
        }
    };

    const saveAppearance = async appearance => {
        await updateEditorFontSize(appearance.sizes?.editorFontSize);
        await updateEditorFontFamily(appearance.fonts?.editor);
        localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
        const storedThemes = localStorage.getItem(INSTALLED_THEMES_KEY);
        const themes = storedThemes === null ? [] : JSON.parse(storedThemes).map(validateTheme);
        const updatedThemes = [...themes.filter(theme => theme.name !== appearance.name), appearance];
        localStorage.setItem(INSTALLED_THEMES_KEY, JSON.stringify(updatedThemes));
        applyAppearance(appearance);
        setInstalledAppearance(appearance);
        setInstalledThemes(updatedThemes);
        setNotice(`تم تطبيق المظهر: ${appearance.name}.`);
    };

    const installTheme = async item => {
        setBusy(item.id);
        setNotice('');
        try {
            const response = await fetch(assetPath(item, 'themes'), { headers: { Accept: 'application/json' } });
            if (!response.ok) {
                throw new Error(`تعذّر تحميل السمة (HTTP ${response.status}).`);
            }
            await saveAppearance(validateTheme(await response.json()));
        } catch (error) {
            setNotice(error instanceof Error ? error.message : 'تعذّر تثبيت السمة.');
        } finally {
            setBusy('');
        }
    };

    const importLocalTheme = async file => {
        setBusy('local-theme');
        setNotice('');
        try {
            if (!file.name.toLowerCase().endsWith('.json')) {
                throw new Error('اختر ملف سمة بامتداد JSON.');
            }
            if (file.size > 128_000) {
                throw new Error('يجب ألا يتجاوز ملف السمة 128 كيلوبايت.');
            }
            await saveAppearance(validateTheme(JSON.parse(await file.text())));
        } catch (error) {
            setNotice(error instanceof Error ? error.message : 'تعذّر استيراد ملف السمة.');
        } finally {
            setBusy('');
        }
    };

    const importLocalExtension = async file => {
        if (!file.name.toLowerCase().endsWith('.vsix')) {
            setNotice('اختر حزمة إضافة بامتداد VSIX.');
            return;
        }
        if (file.size > 50 * 1024 * 1024) {
            setNotice('يجب ألا يتجاوز حجم حزمة الإضافة 50 ميغابايت.');
            return;
        }
        if (!window.confirm(`تثبيت الإضافة المحلية "${file.name}"؟ ستعمل داخل المحرر وقد تصل إلى مساحة العمل.`)) {
            return;
        }
        setBusy('local-extension');
        setNotice('');
        let uploadedId = '';
        let resultNotice = '';
        let apiBase = '';
        let sessionToken = '';
        try {
            apiBase = window.taskflowApiBase;
            sessionToken = window.taskflowSessionToken;
            if (typeof apiBase !== 'string' || typeof sessionToken !== 'string' || !sessionToken) {
                throw new Error('لم تكتمل مصادقة المحرر مع منصة TaskFlow.');
            }
            const form = new FormData();
            form.append('extension', file, file.name);
            const response = await fetch(`${apiBase}/api/programming/extensions/upload`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${sessionToken}` },
                body: form
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(typeof result?.detail === 'string' ? result.detail : `تعذّر رفع الإضافة (HTTP ${response.status}).`);
            }
            if (typeof result?.id !== 'string' || !/^[a-f0-9]{32}$/.test(result.id) ||
                typeof result?.plugin_entry !== 'string' || !result.plugin_entry.startsWith('file:')) {
                throw new Error('استجابة رفع الإضافة المحلية غير صالحة.');
            }
            uploadedId = result.id;
            await pluginServer.install(result.plugin_entry);
            resultNotice = `تم تثبيت ${file.name}. قد تحتاج إلى إعادة تحميل المحرر لتفعيلها.`;
        } catch (error) {
            resultNotice = error instanceof Error ? error.message : 'تعذّر تثبيت الإضافة المحلية.';
        } finally {
            if (uploadedId) {
                try {
                    const cleanup = await fetch(`${apiBase}/api/programming/extensions/${uploadedId}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${sessionToken}` }
                    });
                    if (!cleanup.ok) {
                        throw new Error(`تعذّر حذف نسخة التثبيت المؤقتة (HTTP ${cleanup.status}).`);
                    }
                } catch (error) {
                    const cleanupError = error instanceof Error ? error.message : 'خطأ غير معروف.';
                    resultNotice = resultNotice
                        ? `${resultNotice} تعذّر تنظيف النسخة المؤقتة: ${cleanupError}`
                        : `تعذّر تثبيت الإضافة، كما تعذّر تنظيف النسخة المؤقتة: ${cleanupError}`;
                }
            }
            setNotice(resultNotice);
            setBusy('');
        }
    };

    const installSkill = async item => {
        if (!window.confirm(`إضافة مهارة ${item.name} إلى تعليمات AI؟ راجع محتواها لأنها تؤثر في سلوك المساعد.`)) {
            return;
        }
        setBusy(item.id);
        setNotice('');
        try {
            const response = await fetch(assetPath(item, 'skills'), { headers: { Accept: 'text/markdown' } });
            if (!response.ok) {
                throw new Error(`تعذّر تحميل المهارة (HTTP ${response.status}).`);
            }
            const content = await response.text();
            if (!content.trim() || content.length > 100_000 || !content.startsWith('---')) {
                throw new Error('ملف المهارة فارغ أو لا يحتوي على ترويسة SKILL.md صالحة.');
            }
            const skillName = /^name:\s*['"]?([a-z0-9][a-z0-9-]{0,63})['"]?\s*$/m.exec(content)?.[1];
            if (skillName !== item.id) {
                throw new Error('اسم المهارة داخل SKILL.md لا يطابق معرّفها في المتجر.');
            }
            const roots = await workspaceService.roots;
            const workspace = roots[0]?.resource;
            if (!workspace) {
                throw new Error('افتح مساحة عمل قبل تثبيت مهارة.');
            }
            const directory = workspace.resolve(`.agents/skills/${item.id}`);
            const skillFile = directory.resolve('SKILL.md');
            if (await fileService.exists(skillFile)) {
                throw new Error('المهارة مثبتة بالفعل في مساحة العمل.');
            }
            await fileService.createFolder(directory);
            await fileService.write(skillFile, content);
            setNotice(`تم تثبيت مهارة ${item.name} في مساحة العمل.`);
        } catch (error) {
            setNotice(error instanceof Error ? error.message : 'تعذّر تثبيت المهارة.');
        } finally {
            setBusy('');
        }
    };

    const resetAppearance = async () => {
        try {
            localStorage.removeItem(APPEARANCE_KEY);
            localStorage.removeItem(GLASS_WALLPAPER_KEY);
            setGlassWallpaper('');
            applyAppearance(null);
            setInstalledAppearance(null);
            const originalFontSize = localStorage.getItem(EDITOR_FONT_SIZE_KEY);
            if (originalFontSize !== null) {
                const parsed = Number(originalFontSize);
                if (!Number.isFinite(parsed) || parsed < 10 || parsed > 24) {
                    throw new Error('قيمة حجم المحرر المحفوظة غير صالحة؛ أعد ضبط حجم الخط من إعدادات المحرر.');
                }
                await preferenceService.set('editor.fontSize', parsed, PreferenceScope.User);
                localStorage.removeItem(EDITOR_FONT_SIZE_KEY);
            }
            await updateEditorFontFamily(undefined);
            setThemeSettingsOpen(false);
            setThemeSettingsDraft(null);
            setNotice('تمت إعادة المظهر الأصلي للمحرر.');
        } catch (error) {
            setNotice(error instanceof Error ? error.message : 'تعذّرت إعادة المظهر الأصلي.');
        }
    };

    const selectGlassWallpaper = async file => {
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_000_000) {
            setNotice('خلفية الزجاج يجب أن تكون PNG أو JPEG أو WebP، وبحجم لا يتجاوز 1 ميغابايت.');
            return;
        }
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => typeof reader.result === 'string'
                    ? resolve(reader.result)
                    : reject(new Error('تعذّر قراءة صورة الخلفية.'));
                reader.onerror = () => reject(new Error('تعذّر قراءة صورة الخلفية.'));
                reader.readAsDataURL(file);
            });
            if (!isSafeGlassWallpaper(dataUrl)) {
                throw new Error('صيغة صورة الخلفية غير مدعومة.');
            }
            localStorage.setItem(GLASS_WALLPAPER_KEY, dataUrl);
            setGlassWallpaper(dataUrl);
            applyAppearance(themeSettingsDraft ?? installedAppearance);
            setNotice('تم حفظ خلفية الزجاج على هذا الجهاز.');
        } catch (error) {
            setNotice(error instanceof Error ? error.message : 'تعذّر حفظ خلفية الزجاج.');
        }
    };

    const clearGlassWallpaper = () => {
        localStorage.removeItem(GLASS_WALLPAPER_KEY);
        setGlassWallpaper('');
        applyAppearance(themeSettingsDraft ?? installedAppearance);
        setNotice('تمت إزالة خلفية الزجاج.');
    };

    const loadReadmePreview = async (item, event, assetPrefix = RAW_ASSET_PREFIX) => {
        if (!event.currentTarget.open || readmePreviews[item.id]) return;
        setReadmePreviews(current => ({ ...current, [item.id]: { loading: true } }));
        try {
            const response = await fetch(safeAssetUrl(item.readme, assetPrefix), { headers: { Accept: 'text/markdown' } });
            if (!response.ok) {
                throw new Error(`تعذّر تحميل README (HTTP ${response.status}).`);
            }
            const text = await response.text();
            if (!text.trim() || text.length > 50_000) {
                throw new Error('ملف README فارغ أو يتجاوز حد المعاينة (50 كيلوبايت).');
            }
            setReadmePreviews(current => ({ ...current, [item.id]: { text } }));
        } catch (error) {
            setReadmePreviews(current => ({
                ...current,
                [item.id]: { error: error instanceof Error ? error.message : 'تعذّرت معاينة README.' }
            }));
        }
    };

    const renderReadmePreviewContent = (id, readmePath, assetPrefix = RAW_ASSET_PREFIX) => {
        const preview = readmePreviews[id];
        if (preview?.loading) return React.createElement('p', { role: 'status' }, 'جارٍ تحميل README...');
        if (preview?.error) return React.createElement('p', { role: 'alert' }, preview.error);
        if (!preview?.text) return null;
        return React.createElement('div', {
            className: 'taskflow-readme-rendered',
            dir: 'auto'
        }, renderReadmeMarkdown(preview.text, safeAssetUrl(readmePath, assetPrefix)));
    };

    const updateThemeSettingsDraft = (key, value) => {
        setThemeSettingsDraft(current => {
            if (!current) return current;
            const next = {
                ...current,
                colors: { ...current.colors },
                sizes: { ...current.sizes },
                fonts: { ...current.fonts },
                glassSettings: { ...current.glassSettings },
                buttonSettings: { ...current.buttonSettings },
                motion: { ...current.motion }
            };
            if (key === 'glassEffect') next.glass = value;
            else if (['glassBlur', 'glassOpacity', 'glassSaturation', 'glassTint'].includes(key)) {
                const settingKey = { glassBlur: 'blur', glassOpacity: 'opacity', glassSaturation: 'saturation', glassTint: 'tint' }[key];
                next.glassSettings[settingKey] = value;
            } else if (key === 'uiFontFamily') next.fonts.ui = value;
            else if (key === 'editorFontFamily') next.fonts.editor = value;
            else if (key === 'uiFontSize') next.sizes.uiFontSize = value;
            else if (key === 'editorFontSize') next.sizes.editorFontSize = value;
            else if (key === 'cornerRadius') next.sizes.cornerRadius = value;
            else if (key === 'buttonRadius') next.buttonSettings.radius = value;
            else if (key === 'buttonHeight') next.buttonSettings.height = value;
            else if (key === 'buttonStyle') next.buttonSettings.style = value;
            else if (key === 'motionPreset') next.motion.preset = value;
            else if (key === 'motionDuration') next.motion.duration = value;
            else if (key === 'hoverLift') next.motion.hoverLift = value;
            else if (['accent', 'buttonHoverBackground', 'listHoverBackground', 'listActiveSelectionBackground',
                'listActiveSelectionForeground', 'toolbarHoverBackground', 'tabHoverBackground', 'focusBorder'].includes(key)) {
                next.colors[key] = value;
            }
            return next;
        });
    };

    const renderThemeSettingControl = (key, draft) => {
        const range = (label, property, min, max, step, unit = '') => React.createElement(
            'label',
            { className: 'taskflow-theme-setting-range', key },
            React.createElement('span', null,
                label,
                React.createElement('output', null, `${property}${unit}`)
            ),
            React.createElement('input', {
                type: 'range',
                min,
                max,
                step,
                value: property,
                onChange: event => updateThemeSettingsDraft(key, Number(event.currentTarget.value))
            })
        );
        const color = (label, value) => React.createElement(
            'label',
            { className: 'taskflow-theme-setting-color', key },
            React.createElement('span', null, label),
            React.createElement('input', {
                type: 'color',
                value,
                onChange: event => updateThemeSettingsDraft(key, event.currentTarget.value)
            })
        );
        const select = (label, value, options) => React.createElement(
            'label',
            { className: 'taskflow-theme-setting-select', key },
            React.createElement('span', null, label),
            React.createElement('select', {
                value,
                onChange: event => updateThemeSettingsDraft(key, event.currentTarget.value)
            }, options.map(([option, title]) => React.createElement('option', { key: option, value: option }, title)))
        );
        switch (key) {
            case 'glassEffect':
                return React.createElement('label', { className: 'taskflow-theme-setting-toggle', key },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: draft.glass,
                        onChange: event => updateThemeSettingsDraft(key, event.currentTarget.checked)
                    }),
                    React.createElement('span', null, 'تفعيل أسطح الزجاج')
                );
            case 'glassBlur': return range('قوة التمويه', draft.glassSettings.blur ?? 20, 0, 36, 1, 'px');
            case 'glassOpacity': return range('شفافية الزجاج', draft.glassSettings.opacity ?? 68, 10, 92, 1, '%');
            case 'glassSaturation': return range('تشبّع الألوان', draft.glassSettings.saturation ?? 125, 60, 180, 5, '%');
            case 'glassTint': return color('لون الزجاج', draft.glassSettings.tint || '#9b87ef');
            case 'glassWallpaper':
                return React.createElement('div', { className: 'taskflow-theme-setting-wallpaper', key },
                    React.createElement('span', null, 'خلفية الزجاج'),
                    React.createElement('input', {
                        type: 'file',
                        accept: 'image/png,image/jpeg,image/webp',
                        onChange: event => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            void selectGlassWallpaper(file);
                        }
                    }),
                    glassWallpaper && React.createElement('button', {
                        type: 'button',
                        onClick: clearGlassWallpaper
                    }, 'إزالة الخلفية')
                );
            case 'uiFontFamily':
                return select('خط الواجهة', draft.fonts.ui || 'system', [
                    ['system', 'نظام الجهاز'], ['inter', 'Inter'], ['cairo', 'Cairo'], ['segoe', 'Segoe UI'], ['arial', 'Arial']
                ]);
            case 'editorFontFamily':
                return select('خط المحرر', draft.fonts.editor || 'monospace', [
                    ['monospace', 'Monospace'], ['cascadia-code', 'Cascadia Code'], ['jetbrains-mono', 'JetBrains Mono'],
                    ['fira-code', 'Fira Code'], ['consolas', 'Consolas']
                ]);
            case 'uiFontSize': return range('حجم خط الواجهة', draft.sizes.uiFontSize ?? 13, 11, 18, 1, 'px');
            case 'editorFontSize': return range('حجم خط المحرر', draft.sizes.editorFontSize ?? 14, 10, 24, 1, 'px');
            case 'cornerRadius': return range('استدارة الزوايا', draft.sizes.cornerRadius ?? 8, 0, 18, 1, 'px');
            case 'accent': return color('لون التمييز', draft.colors.accent || '#9b87ef');
            case 'buttonHoverBackground': return color('لون مرور المؤشر على الأزرار', draft.colors.buttonHoverBackground || '#3d374c');
            case 'listHoverBackground': return color('لون مرور المؤشر على القوائم', draft.colors.listHoverBackground || '#343642');
            case 'listActiveSelectionBackground': return color('خلفية التحديد النشط', draft.colors.listActiveSelectionBackground || '#41465a');
            case 'listActiveSelectionForeground': return color('نص التحديد النشط', draft.colors.listActiveSelectionForeground || '#ffffff');
            case 'toolbarHoverBackground': return color('لون مرور المؤشر على شريط الأدوات', draft.colors.toolbarHoverBackground || '#343642');
            case 'tabHoverBackground': return color('لون مرور المؤشر على التبويبات', draft.colors.tabHoverBackground || '#343642');
            case 'focusBorder': return color('لون إطار التركيز', draft.colors.focusBorder || '#d2c4ff');
            case 'buttonRadius': return range('استدارة الأزرار', draft.buttonSettings.radius ?? 8, 0, 24, 1, 'px');
            case 'buttonHeight': return range('ارتفاع الأزرار', draft.buttonSettings.height ?? 38, 28, 52, 1, 'px');
            case 'buttonStyle':
                return select('شكل الأزرار', draft.buttonSettings.style || 'solid', [
                    ['solid', 'ممتلئ'], ['soft', 'ناعم'], ['outline', 'محدد بإطار'], ['glass', 'زجاجي']
                ]);
            case 'motionPreset':
                return select('أسلوب الحركة', draft.motion.preset || 'subtle', [
                    ['none', 'بدون حركة'], ['subtle', 'هادئة'], ['smooth', 'انسيابية'], ['snappy', 'سريعة']
                ]);
            case 'motionDuration': return range('مدة الحركة', draft.motion.duration ?? 180, 80, 500, 10, 'ms');
            case 'hoverLift': return range('ارتفاع الزر عند المرور', draft.motion.hoverLift ?? 1, 0, 4, 1, 'px');
            default: return null;
        }
    };

    const saveThemeSettings = async () => {
        if (!themeSettingsDraft) return;
        setBusy('save-theme-settings');
        try {
            await saveAppearance(validateTheme(themeSettingsDraft));
            themeSettingsSnapshot.current = null;
            setThemeSettingsDraft(null);
            setThemeSettingsOpen(false);
        } catch (error) {
            setNotice(error instanceof Error ? error.message : 'تعذّر حفظ إعدادات الثيم.');
        } finally {
            setBusy('');
        }
    };

    const openThemeSettings = theme => {
        themeSettingsSnapshot.current = {
            appearance: installedAppearance ? JSON.parse(JSON.stringify(installedAppearance)) : null,
            editorFontSize: preferenceService.get('editor.fontSize', 14),
            editorFontFamily: preferenceService.get('editor.fontFamily', 'monospace'),
            wallpaper: localStorage.getItem(GLASS_WALLPAPER_KEY) || ''
        };
        setNotice('');
        setThemeSettingsDraft(JSON.parse(JSON.stringify(theme)));
        setThemeSettingsOpen(true);
    };

    const cancelThemeSettings = async () => {
        const snapshot = themeSettingsSnapshot.current;
        try {
            if (snapshot) {
                if (snapshot.wallpaper) {
                    localStorage.setItem(GLASS_WALLPAPER_KEY, snapshot.wallpaper);
                } else {
                    localStorage.removeItem(GLASS_WALLPAPER_KEY);
                }
                setGlassWallpaper(snapshot.wallpaper);
                applyAppearance(snapshot.appearance);
                await Promise.all([
                    preferenceService.set('editor.fontSize', snapshot.editorFontSize, PreferenceScope.User),
                    preferenceService.set('editor.fontFamily', snapshot.editorFontFamily, PreferenceScope.User)
                ]);
            } else {
                applyAppearance(null);
            }
            themeSettingsSnapshot.current = null;
            setThemeSettingsDraft(null);
            setThemeSettingsOpen(false);
            setNotice('تم إلغاء المعاينة وإرجاع المظهر السابق.');
        } catch (error) {
            setNotice(error instanceof Error ? error.message : 'تعذّر إرجاع المظهر السابق.');
        }
    };

    const renderItems = (title, items, kind, install, assetPrefix = RAW_ASSET_PREFIX) => React.createElement(
        'section',
        { className: 'taskflow-store-section', key: kind, 'aria-label': title },
        React.createElement('h3', null, title),
        items.length
            ? items.map(item => React.createElement(
                'article',
                { className: 'taskflow-store-card', key: item.id },
                item.preview && React.createElement('img', {
                    className: 'taskflow-store-preview',
                    src: safeAssetUrl(item.preview, assetPrefix),
                    alt: `معاينة ${item.name}`,
                    loading: 'lazy',
                }),
                React.createElement('strong', null, item.name),
                React.createElement('p', null, item.description),
                item.author && React.createElement('small', { className: 'taskflow-store-author' }, `الصانع: ${item.author}`),
                item.readme && React.createElement(
                    'details',
                    {
                        className: 'taskflow-store-readme-preview',
                        onToggle: event => void loadReadmePreview(item, event, assetPrefix)
                    },
                    React.createElement('summary', null, 'معاينة README'),
                    renderReadmePreviewContent(item.id, item.readme, assetPrefix)
                ),
                React.createElement('button', {
                    type: 'button',
                    disabled: Boolean(busy),
                    onClick: () => void install(item),
                }, busy === item.id ? 'جارٍ التثبيت...' : 'تثبيت')
            ))
            : React.createElement('p', { className: 'taskflow-store-empty' }, 'لا توجد عناصر منشورة حاليًا.')
    );

    if (themeSettingsOpen && themeSettingsDraft) {
        return React.createElement('main', { className: 'taskflow-appearance-panel taskflow-theme-settings-page' },
            React.createElement('button', {
                className: 'taskflow-theme-settings-back',
                type: 'button',
                disabled: Boolean(busy),
                onClick: () => void cancelThemeSettings()
            }, 'العودة إلى المظهر والمتجر'),
            React.createElement('h1', null, `إعدادات الثيم: ${themeSettingsDraft.name}`),
            React.createElement('p', { className: 'taskflow-appearance-description' },
                'عدّل الخيارات التي أتاحها صانع الثيم. التغييرات تحفظ على هذا الجهاز ولا تشغّل كودًا من ملفات الثيم.'
            ),
            React.createElement('p', { className: 'taskflow-theme-live-preview', role: 'status' },
                'المعاينة الحية مفعّلة: التغييرات تظهر في المحرر قبل الحفظ.'
            ),
            React.createElement('div', { className: 'taskflow-theme-settings-grid' },
                themeSettingsDraft.controls.map(control => renderThemeSettingControl(control, themeSettingsDraft))
            ),
            notice && React.createElement('p', { className: 'taskflow-store-notice', role: 'status' }, notice),
            React.createElement('button', {
                className: 'taskflow-theme-settings-save',
                type: 'button',
                disabled: Boolean(busy),
                onClick: () => void saveThemeSettings()
            }, busy === 'save-theme-settings' ? 'جارٍ حفظ الإعدادات...' : 'حفظ إعدادات الثيم'),
            React.createElement('button', {
                className: 'taskflow-theme-settings-cancel',
                type: 'button',
                disabled: Boolean(busy),
                onClick: () => void cancelThemeSettings()
            }, 'إلغاء المعاينة')
        );
    }

    return React.createElement(
        'div',
        { className: 'taskflow-appearance-panel' },
        React.createElement('h2', null, 'Appearance'),
        React.createElement('p', { className: 'taskflow-appearance-description' },
            'خصّص مظهر المحرر أو أعده إلى إعداداته الأصلية. استخدم Theme Coding لصنع ثيمات بواجهة ثابتة وآمنة.'
        ),
        React.createElement('details', {
            className: 'taskflow-store-readme-preview taskflow-theme-guide',
            onToggle: event => void loadReadmePreview({
                id: 'theme-authoring-guide',
                readme: 'themes/THEMES-CODING.md'
            }, event)
        },
        React.createElement('summary', null, 'README: إرشادات صناعة الثيمات'),
        renderReadmePreviewContent('theme-authoring-guide', 'themes/THEMES-CODING.md')),
        React.createElement('div', { className: 'taskflow-appearance-actions' },
            React.createElement('button', {
                type: 'button',
                onClick: () => void saveAppearance({
                    name: 'Glass',
                    glass: true,
                    colors: {},
                    sizes: {},
                    fonts: {},
                    glassSettings: { blur: 20, opacity: 68, saturation: 125, tint: '#9b87ef' },
                    controls: [...THEME_SETTING_CONTROLS]
                })
                    .catch(error => setNotice(error instanceof Error ? error.message : 'تعذّر تطبيق المظهر الزجاجي.')),
            }, 'Glass mode'),
            React.createElement('button', { type: 'button', onClick: () => void resetAppearance() }, 'إعادة الشكل الأصلي')
        ),
        installedAppearance && React.createElement('p', { className: 'taskflow-store-active' }, `المظهر الحالي: ${installedAppearance.name}`),
        React.createElement('section', { className: 'taskflow-store-section taskflow-installed-themes', 'aria-label': 'الثيمات المثبتة' },
            React.createElement('h3', null, 'الثيمات المثبتة'),
            installedThemes.length
                ? installedThemes.map(theme => React.createElement('article', {
                    className: 'taskflow-installed-theme-card',
                    key: theme.name
                },
                    React.createElement('div', null,
                        React.createElement('strong', null, theme.name),
                        React.createElement('p', null, installedAppearance?.name === theme.name
                            ? 'الثيم النشط على هذا الجهاز.'
                            : 'مثبّت على هذا الجهاز.')
                    ),
                    React.createElement('button', {
                        type: 'button',
                        onClick: () => openThemeSettings(theme)
                    }, 'إعدادات الثيم')
                ))
                : React.createElement('p', { className: 'taskflow-store-empty' }, 'لم يتم تثبيت أي ثيم بعد.')
        ),
        notice && React.createElement('p', { className: 'taskflow-store-notice', role: 'status' }, notice),
        React.createElement('section', { className: 'taskflow-store-section taskflow-local-imports', 'aria-label': 'استيراد محلي' },
            React.createElement('h3', null, 'إضافة من الجهاز'),
            React.createElement('p', { className: 'taskflow-appearance-description' }, 'استورد ملف سمة JSON أو إضافة VSIX من جهازك. راجع الإضافات قبل تثبيتها لأنها تعمل داخل المحرر.'),
            React.createElement('div', { className: 'taskflow-appearance-actions' },
                React.createElement('button', {
                    type: 'button',
                    disabled: Boolean(busy),
                    onClick: () => themeFileInput.current?.click()
                }, 'استيراد سمة JSON'),
                React.createElement('button', {
                    type: 'button',
                    disabled: Boolean(busy),
                    onClick: () => extensionFileInput.current?.click()
                }, 'تثبيت إضافة VSIX')
            ),
            React.createElement('input', {
                ref: themeFileInput,
                type: 'file',
                accept: '.json,application/json',
                hidden: true,
                onChange: event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void importLocalTheme(file);
                }
            }),
            React.createElement('input', {
                ref: extensionFileInput,
                type: 'file',
                accept: '.vsix,application/octet-stream',
                hidden: true,
                onChange: event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void importLocalExtension(file);
                }
            })
        ),
        React.createElement('h2', null, 'Theme & Skills Store'),
        React.createElement('p', { className: 'taskflow-appearance-description' }, 'الثيمات والمهارات المنشورة في مستودع TaskFlow. لإدارة الإضافات البرمجية، افتح قسم Extensions.'),
        catalogError && React.createElement('p', { className: 'taskflow-store-warning', role: 'status' }, catalogError),
        loading
            ? React.createElement('p', { role: 'status' }, 'جارٍ تحميل فهرس المتجر...')
            : React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'taskflow-store-sections' },
                    renderItems('Themes', catalog.themes, 'themes', installTheme),
                    React.createElement(OpenVsxThemeLibrary, { pluginServer })
                ),
                React.createElement(TaskflowSkillLibraries, { fileService, workspaceService })
            )
    );
}

function TaskflowExtensionMarketplace({ pluginServer, hostedPluginSupport, commandRegistry, onSourceChange, initialSource }) {
    const [source, setSource] = React.useState(activeExtensionSource);
    const [extensions, setExtensions] = React.useState([]);
    const [openVsxExtensions, setOpenVsxExtensions] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [busyId, setBusyId] = React.useState('');
    const [query, setQuery] = React.useState('');
    const [readmePreviews, setReadmePreviews] = React.useState({});
    const [openVsxOffset, setOpenVsxOffset] = React.useState(0);
    const [openVsxHasMore, setOpenVsxHasMore] = React.useState(false);

    React.useEffect(() => {
        setSource(initialSource);
    }, [initialSource]);

    React.useEffect(() => {
        if (source === EXTENSION_SOURCE_OPEN_VSX) {
            const controller = new AbortController();
            setOpenVsxExtensions([]);
            setError('');
            setLoading(true);
            void fetchCompatibleOpenVsxExtensions('', 0, controller.signal).then(result => {
                setOpenVsxExtensions(result.extensions);
                setOpenVsxOffset(0);
                setOpenVsxHasMore(result.hasMore);
            }).catch(fetchError => {
                if (fetchError?.name !== 'AbortError') {
                    setOpenVsxExtensions([]);
                    setError(fetchError instanceof Error ? fetchError.message : 'تعذّر تحميل الإضافات المتوافقة.');
                    console.error('Open VSX compatibility search failed.', fetchError);
                }
            }).finally(() => {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            });
            return () => controller.abort();
        }
        if (source !== EXTENSION_SOURCE_TASKFLOW) {
            setExtensions([]);
            setError('');
            setLoading(false);
            return undefined;
        }
        const controller = new AbortController();
        setLoading(true);
        setError('');
        setReadmePreviews({});
        void fetch(TASKFLOW_EXTENSION_REPOSITORY.catalogUrl, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        }).then(async response => {
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('مكتبة AI TaskFlow Extensions لا تحتوي catalog.json منشورًا في فرع main حتى الآن.');
                }
                throw new Error(`تعذّر تحميل مكتبة الإضافات (HTTP ${response.status}).`);
            }
            return validateCatalog(await response.json(), TASKFLOW_EXTENSION_REPOSITORY.assetPrefix);
        }).then(catalog => {
            setExtensions(catalog.extensions);
        }).catch(fetchError => {
            if (fetchError?.name !== 'AbortError') {
                setExtensions([]);
                setError(fetchError instanceof Error ? fetchError.message : 'تعذّر تحميل مكتبة الإضافات.');
                console.error('TaskFlow extension catalog could not be loaded.', fetchError);
            }
        }).finally(() => {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        });
        return () => controller.abort();
    }, [source]);

    const searchOpenVsx = async (searchText = query, offset = 0, append = false) => {
        setLoading(true);
        setError('');
        try {
            const result = await fetchCompatibleOpenVsxExtensions(searchText, offset);
            setOpenVsxExtensions(current => append ? [...current, ...result.extensions] : result.extensions);
            setOpenVsxOffset(offset);
            setOpenVsxHasMore(result.hasMore);
        } catch (searchError) {
            setError(searchError instanceof Error ? searchError.message : 'تعذّر تحميل الإضافات المتوافقة.');
            if (!append) {
                setOpenVsxExtensions([]);
            }
        } finally {
            setLoading(false);
        }
    };

    const filteredExtensions = extensions.filter(item =>
        item.manifest && isExtensionCompatible(item.manifest) &&
        `${item.name} ${item.description} ${item.author ?? ''}`.toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())
    );

    const installExtension = async item => {
        if (!window.confirm(`تثبيت ${item.name}؟ ستعمل الإضافة داخل المحرر وقد تصل إلى مساحة العمل.`)) {
            return;
        }
        setBusyId(item.id);
        setNotice('');
        try {
            await pluginServer.install(assetPath(item, 'extensions', TASKFLOW_EXTENSION_REPOSITORY.assetPrefix));
            setNotice(`تم تثبيت ${item.name}. قد تحتاج إلى إعادة تحميل المحرر لتفعيلها.`);
        } catch (installError) {
            const detail = installError instanceof Error ? installError.message : 'تعذّر تثبيت الإضافة.';
            setNotice(`جرّب المحرر تشغيل الإضافة بالتوافق المتاح، لكن التثبيت أو التفعيل لم ينجح: ${detail} سنقيّم دعمها لاحقًا.`);
        } finally {
            setBusyId('');
        }
    };

    const installOpenVsxExtension = async item => {
        if (!window.confirm(`تثبيت ${item.name}؟ ستعمل الإضافة داخل المحرر وقد تصل إلى مساحة العمل.`)) {
            return;
        }
        setBusyId(item.id);
        setNotice('');
        try {
            await pluginServer.install(item.downloadUrl);
            if (item.compatibility.status === 'translation-required') {
                try {
                    await Promise.all(item.compatibility.activationEvents.map(event =>
                        hostedPluginSupport.activateByEvent(event)
                    ));
                } catch (translationError) {
                    const detail = translationError instanceof Error ? translationError.message : 'تعذّر تفعيل مسار التوافق.';
                    setNotice(`ثُبّتت ${item.name}، لكن محاولة ترجمة حدث التفعيل لم تنجح: ${detail} دعم هذا الحدث غير مكتمل وسنقيّمه لاحقًا.`);
                    return;
                }
                setNotice(`ثُبّتت ${item.name} وفُعّل مسار التوافق البديل لحدث التفعيل. هذا لا يضمن عمل كل الوظائف؛ قد تحتاج إلى إعادة تحميل المحرر.`);
            } else {
                setNotice(`تم تثبيت ${item.name} (${item.version}). اجتاز فحص توافق بياناته، لكن لا يمكن ضمان توافق كل وظائفه. قد تحتاج إلى إعادة تحميل المحرر.`);
            }
        } catch (installError) {
            const detail = installError instanceof Error ? installError.message : 'تعذّر تثبيت الإضافة.';
            setNotice(`حاول المحرر تثبيت الإضافة، لكن المحاولة لم تنجح: ${detail} هذه الوظيفة غير مدعومة حاليًا وسنقيّم إضافتها لاحقًا.`);
        } finally {
            setBusyId('');
        }
    };

    const loadReadme = async (item, event) => {
        if (!event.currentTarget.open || readmePreviews[item.id]) {
            return;
        }
        setReadmePreviews(current => ({ ...current, [item.id]: { loading: true } }));
        try {
            const response = await fetch(safeAssetUrl(item.readme, TASKFLOW_EXTENSION_REPOSITORY.assetPrefix), {
                headers: { Accept: 'text/markdown' }
            });
            if (!response.ok) {
                throw new Error(`تعذّر تحميل README (HTTP ${response.status}).`);
            }
            const markdown = await response.text();
            if (!markdown.trim() || markdown.length > 100_000) {
                throw new Error('ملف README فارغ أو يتجاوز الحد المسموح للمعاينة.');
            }
            setReadmePreviews(current => ({ ...current, [item.id]: { text: markdown } }));
        } catch (readmeError) {
            setReadmePreviews(current => ({
                ...current,
                [item.id]: { error: readmeError instanceof Error ? readmeError.message : 'تعذّرت معاينة README.' }
            }));
        }
    };

    const openExtensionSettings = item => {
        void commandRegistry.executeCommand('preferences:open', item.id)
            .then(() => setNotice(`افتح إعدادات الإضافة ${item.name} وعدّل الخيارات التي يوفّرها ناشرها.`))
            .catch(settingsError => setNotice(settingsError instanceof Error
                ? settingsError.message
                : 'تعذّر فتح إعدادات الإضافة؛ تأكد من تثبيتها وأنها تعلن عن إعدادات.'));
    };

    const selectSource = event => {
        const nextSource = event.currentTarget.value;
        if (![EXTENSION_SOURCE_OPEN_VSX, EXTENSION_SOURCE_TASKFLOW].includes(nextSource)) {
            setError('مصدر مكتبة الإضافات المختار غير معروف.');
            return;
        }
        localStorage.setItem(EXTENSION_SOURCE_KEY, nextSource);
        activeExtensionSource = nextSource;
        setSource(nextSource);
        onSourceChange(nextSource);
    };

    return React.createElement('section', {
        className: `taskflow-extension-marketplace ${source === EXTENSION_SOURCE_TASKFLOW ? 'taskflow-extension-source-active' : ''}`,
        'aria-label': 'مصادر الإضافات'
    },
    React.createElement('label', { className: 'taskflow-extension-source-select' },
        React.createElement('span', null, 'مكتبة الإضافات'),
        React.createElement('select', {
            value: source,
            onChange: selectSource,
            'aria-label': 'اختيار مكتبة الإضافات'
        },
        React.createElement('option', { value: EXTENSION_SOURCE_OPEN_VSX }, 'Open VSX Registry'),
        React.createElement('option', { value: EXTENSION_SOURCE_TASKFLOW }, 'AI TaskFlow Extensions'))
    ),
    source === EXTENSION_SOURCE_OPEN_VSX && React.createElement('div', { className: 'taskflow-extension-catalog' },
    React.createElement('form', {
        className: 'taskflow-extension-search',
        onSubmit: event => {
            event.preventDefault();
            void searchOpenVsx(query);
        }
    },
    React.createElement('span', null, 'بحث عن الإضافات المتوافقة فقط'),
    React.createElement('input', {
        type: 'search',
        value: query,
        maxLength: 100,
        onChange: event => setQuery(event.currentTarget.value),
        placeholder: 'اسم الإضافة أو وصفها',
        'aria-label': 'بحث في إضافات Open VSX المتوافقة'
    }),
    React.createElement('button', { type: 'submit', disabled: loading },
        loading ? 'جارٍ البحث...' : 'بحث'
    )),
    React.createElement('p', { className: 'taskflow-appearance-description' },
        'تُفحص بيانات VS Code لكل إضافة، ولا تظهر إلا الإضافات التي تتوافق متطلباتها المعلنة مع واجهات المحرر. هذا الفحص لا يضمن عمل كل الميزات.'
    ),
    notice && React.createElement('p', { className: 'taskflow-store-notice', role: 'status' }, notice),
    error && React.createElement('p', { className: 'taskflow-store-warning', role: 'alert' }, error),
    loading && openVsxExtensions.length === 0
        ? React.createElement('p', { role: 'status' }, 'جارٍ فحص إضافات Open VSX...')
        : openVsxExtensions.length
            ? React.createElement('div', { className: 'taskflow-extension-marketplace-items' },
                openVsxExtensions.map(item => React.createElement('article', {
                    className: 'taskflow-store-card',
                    key: item.id
                },
                React.createElement('strong', null, item.name),
                React.createElement('p', null, item.description || 'إضافة متوافقة حسب بياناتها المنشورة.'),
                React.createElement('small', { className: 'taskflow-store-author' },
                    `${item.namespace} · ${item.version} · ${item.downloads.toLocaleString()} تنزيل`
                ),
                React.createElement('span', { className: 'taskflow-extension-compatibility-badge' },
                    item.compatibility.status === 'translation-required'
                        ? 'توافق عبر محاولة تفعيل بديلة'
                        : 'اجتازت فحص التوافق'
                ),
                React.createElement('a', {
                    href: item.openVsxUrl,
                    target: '_blank',
                    rel: 'noopener noreferrer'
                }, 'تفاصيل الإضافة في Open VSX'),
                React.createElement('button', {
                    type: 'button',
                    disabled: Boolean(busyId),
                    onClick: () => void installOpenVsxExtension(item)
                }, busyId === item.id ? 'جارٍ التثبيت...' : 'تثبيت')
                ))
            )
            : React.createElement('p', { className: 'taskflow-store-empty' },
                'لا توجد إضافات اجتازت فحص التوافق في هذه الصفحة. قد تتطلب بقية النتائج واجهات غير متاحة.'
            ),
    openVsxHasMore && React.createElement('button', {
        type: 'button',
        disabled: loading,
        onClick: () => void searchOpenVsx(query, openVsxOffset + 24, true)
    }, loading ? 'جارٍ الفحص...' : 'فحص المزيد')
    ),
    source === EXTENSION_SOURCE_TASKFLOW && React.createElement('div', { className: 'taskflow-extension-catalog' },
    React.createElement('label', { className: 'taskflow-extension-search' },
        React.createElement('span', null, 'بحث في المكتبة'),
        React.createElement('input', {
            type: 'search',
            value: query,
            onChange: event => setQuery(event.currentTarget.value),
            placeholder: 'اسم الإضافة أو وصفها',
            'aria-label': 'بحث في إضافات AI TaskFlow'
        })
    ),
    React.createElement('p', { className: 'taskflow-appearance-description' },
        'تظهر هنا الإضافات التي يرفق ناشرها بيانات manifest قابلة للفحص. لا تظهر الحزم التي لم تُتحقق بيانات توافقها.'
    ),
    notice && React.createElement('p', { className: 'taskflow-store-notice', role: 'status' }, notice),
    error && React.createElement('p', { className: 'taskflow-store-warning', role: 'status' }, error),
    loading
        ? React.createElement('p', { role: 'status' }, 'جارٍ تحميل الإضافات...')
        : filteredExtensions.length
                ? React.createElement('div', { className: 'taskflow-extension-marketplace-items' },
                    filteredExtensions.map(item => {
                        const readme = readmePreviews[item.id];
                        return React.createElement('article', { className: 'taskflow-store-card', key: item.id },
                            item.preview && React.createElement('img', {
                                className: 'taskflow-store-preview',
                                src: safeAssetUrl(item.preview, TASKFLOW_EXTENSION_REPOSITORY.assetPrefix),
                                alt: `معاينة ${item.name}`,
                                loading: 'lazy',
                                referrerPolicy: 'no-referrer'
                            }),
                            React.createElement('strong', null, item.name),
                            React.createElement('p', null, item.description),
                            item.author && React.createElement('small', { className: 'taskflow-store-author' }, `الصانع: ${item.author}`),
                            item.readme && React.createElement('details', {
                                className: 'taskflow-store-readme-preview',
                                onToggle: event => void loadReadme(item, event)
                            },
                            React.createElement('summary', null, 'معاينة README'),
                            readme?.loading
                                ? React.createElement('p', { role: 'status' }, 'جارٍ تحميل README...')
                                : readme?.error
                                    ? React.createElement('p', { role: 'alert' }, readme.error)
                                    : readme?.text && React.createElement('div', {
                                        className: 'taskflow-readme-rendered',
                                        dir: 'auto'
                                    }, renderReadmeMarkdown(readme.text, safeAssetUrl(item.readme, TASKFLOW_EXTENSION_REPOSITORY.assetPrefix)))
                            ),
                            React.createElement('div', { className: 'taskflow-extension-actions' },
                                React.createElement('button', {
                                    type: 'button',
                                    disabled: Boolean(busyId),
                                    onClick: () => openExtensionSettings(item)
                                }, 'إعدادات الإضافة'),
                                React.createElement('small', null, 'تظهر إعدادات الإضافة التي يعلنها ناشرها بعد تثبيتها.')
                            ),
                            React.createElement('button', {
                                type: 'button',
                                disabled: Boolean(busyId),
                                onClick: () => void installExtension(item)
                            }, busyId === item.id ? 'جارٍ التثبيت...' : 'تثبيت')
                        );
                    })
                )
                : React.createElement('p', { className: 'taskflow-store-empty' },
                    query.trim()
                        ? 'لا توجد إضافات مطابقة اجتازت فحص التوافق.'
                        : 'لا تعرض المكتبة إضافات موثقة التوافق حاليًا؛ يلزم أن ينشر المستودع ملف manifest لكل حزمة.'
                )
    ));
}

let TaskflowExtensionMarketplaceWidget = class TaskflowExtensionMarketplaceWidget extends ReactWidget {
    constructor() {
        super();
        this.id = TaskflowExtensionMarketplaceWidget.ID;
        this.title.label = 'AI TaskFlow Extensions';
        this.title.caption = 'اختيار مصدر مكتبة الإضافات';
        this.title.closable = true;
        this.addClass('taskflow-extension-marketplace-widget');
    }

    init() {
        this.update();
    }

    render() {
        return React.createElement(TaskflowExtensionMarketplace, {
            pluginServer: this.pluginServer,
            hostedPluginSupport: this.hostedPluginSupport,
            commandRegistry: this.commandRegistry,
            onSourceChange: source => this.onSourceChange?.(source),
            initialSource: this.source ?? activeExtensionSource
        });
    }
};

TaskflowExtensionMarketplaceWidget.ID = 'taskflow-extension-marketplace-widget';
injectable()(TaskflowExtensionMarketplaceWidget);
postConstruct()(TaskflowExtensionMarketplaceWidget.prototype, 'init', null);
inject(PluginServer)(TaskflowExtensionMarketplaceWidget.prototype, 'pluginServer');
inject(HostedPluginSupport)(TaskflowExtensionMarketplaceWidget.prototype, 'hostedPluginSupport');
inject(CommandRegistry)(TaskflowExtensionMarketplaceWidget.prototype, 'commandRegistry');

let TaskflowExtensionMarketplaceContribution = class TaskflowExtensionMarketplaceContribution {
    async onStart() {
        activeExtensionSource = getSavedExtensionSource();
        localStorage.setItem(EXTENSION_SOURCE_KEY, activeExtensionSource);
        const extensionsView = await this.widgetManager.getOrCreateWidget('vsx-extensions-view-container');
        if (!(extensionsView instanceof ViewContainer)) {
            throw new Error('The native extensions view container is not available.');
        }
        const marketplaceWidget = await this.widgetManager.getOrCreateWidget(TaskflowExtensionMarketplaceWidget.ID);
        extensionsView.shouldShowWidget = part => {
            return part.wrapped === marketplaceWidget;
        };
        const updateSource = source => {
            activeExtensionSource = source;
            extensionsView.addClass('taskflow-ai-extension-source');
            for (const part of extensionsView.getParts()) {
                if (extensionsView.shouldShowWidget(part)) {
                    part.show();
                    part.collapsed = false;
                } else {
                    part.hide();
                }
            }
        };
        marketplaceWidget.source = activeExtensionSource;
        marketplaceWidget.onSourceChange = source => {
            marketplaceWidget.source = source;
            updateSource(source);
            marketplaceWidget.update();
        };
        if (!extensionsView.getPartFor(marketplaceWidget)) {
            extensionsView.addWidget(marketplaceWidget, { order: -1, initiallyCollapsed: false });
        }
        const marketplacePart = extensionsView.getPartFor(marketplaceWidget);
        marketplacePart?.hideTitle();
        updateSource(activeExtensionSource);
    }
};

injectable()(TaskflowExtensionMarketplaceContribution);
inject(WidgetManager)(TaskflowExtensionMarketplaceContribution.prototype, 'widgetManager');

let TaskflowAppearanceWidget = class TaskflowAppearanceWidget extends ReactWidget {
    constructor() {
        super();
        this.id = TaskflowAppearanceWidget.ID;
        this.title.label = 'Appearance';
        this.title.caption = 'TaskFlow Appearance and Store';
        this.title.closable = true;
    }

    init() {
        this.update();
    }

    render() {
        return React.createElement(TaskflowAppearancePanel, {
            pluginServer: this.pluginServer,
            fileService: this.fileService,
            workspaceService: this.workspaceService,
            commandRegistry: this.commandRegistry,
            preferenceService: this.preferenceService,
        });
    }
};

TaskflowAppearanceWidget.ID = 'taskflow-appearance-widget';
injectable()(TaskflowAppearanceWidget);
postConstruct()(TaskflowAppearanceWidget.prototype, 'init', null);
inject(PluginServer)(TaskflowAppearanceWidget.prototype, 'pluginServer');
inject(FileService)(TaskflowAppearanceWidget.prototype, 'fileService');
inject(WorkspaceService)(TaskflowAppearanceWidget.prototype, 'workspaceService');
inject(CommandRegistry)(TaskflowAppearanceWidget.prototype, 'commandRegistry');
inject(PreferenceService)(TaskflowAppearanceWidget.prototype, 'preferenceService');

let TaskflowAppearanceViewContribution = class TaskflowAppearanceViewContribution extends AbstractViewContribution {
    constructor() {
        super({
            widgetId: TaskflowAppearanceWidget.ID,
            widgetName: 'Appearance',
            defaultWidgetOptions: { area: 'main' },
            toggleCommandId: 'taskflow-appearance:toggle',
        });
    }
};

injectable()(TaskflowAppearanceViewContribution);

let TaskflowAboutDialog = class TaskflowAboutDialog extends AboutDialog {
    constructor(props) {
        super(props);
    }

    renderHeader() {
        return React.createElement(
            React.Fragment,
            null,
            super.renderHeader(),
            React.createElement('p', { className: 'taskflow-about-author' }, 'Made by ADAM MAHMOUD')
        );
    }
};

injectable()(TaskflowAboutDialog);
inject(AboutDialogProps)(TaskflowAboutDialog, undefined, 0);

export default new ContainerModule((bind, _unbind, isBound, rebind) => {
    if (isBound(AboutDialog)) {
        rebind(AboutDialog).to(TaskflowAboutDialog).inSingletonScope();
    }
    bind(TaskflowAppearanceWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: TaskflowAppearanceWidget.ID,
        createWidget: () => context.container.get(TaskflowAppearanceWidget),
    })).inSingletonScope();
    bindViewContribution(bind, TaskflowAppearanceViewContribution);
    bind(TaskflowExtensionMarketplaceWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: TaskflowExtensionMarketplaceWidget.ID,
        createWidget: () => context.container.get(TaskflowExtensionMarketplaceWidget),
    })).inSingletonScope();
    bind(TaskflowExtensionMarketplaceContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TaskflowExtensionMarketplaceContribution);
});
