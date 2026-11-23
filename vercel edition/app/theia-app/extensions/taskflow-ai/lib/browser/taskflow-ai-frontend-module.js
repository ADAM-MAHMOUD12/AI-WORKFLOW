import { ContainerModule, inject, injectable } from '@theia/core/shared/inversify';
import React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import { CommandRegistry, MessageService, PreferenceService } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { PreferenceScope } from '@theia/core/lib/common';
import { ReactToolbarItemImpl } from '@theia/core/lib/browser/shell/tab-bar-toolbar/tab-toolbar-item';
import { FrontendLanguageModelRegistry, LanguageModelAliasRegistry } from '@theia/ai-core/lib/common';
import { ToolbarController } from '@theia/toolbar/lib/browser/toolbar-controller';
import { registerPythonLanguage } from './taskflow-language-compatibility.js';
import './taskflow-toolbar.css';

const IMAGE_LIMIT = 3;
const HISTORY_LIMIT = 20;
const MAX_IMAGE_DATA_URL_LENGTH = 5_300_000;
const AI_ENABLED_PREFERENCE = 'ai-features.AiEnable.enableAI';
const DEFAULT_CHAT_AGENT_PREFERENCE = 'ai-features.chat.defaultChatAgent';
const RETURN_TOOLBAR_ITEM_ID = 'taskflow.return-to-platform';
const APPEARANCE_TOOLBAR_ITEM_ID = 'taskflow.open-appearance';
const OPEN_TAB_TOOLBAR_ITEM_ID = 'taskflow.open-in-new-tab';
const SIDEBAR_TOOLBAR_ITEM_ID = 'taskflow.toggle-platform-sidebar';
const GITHUB_TOOLBAR_ITEM_ID = 'taskflow.connect-github';

function GitHubToolbarButton({ contribution }) {
    const [account, setAccount] = React.useState(contribution.githubAccount);
    const [panelOpen, setPanelOpen] = React.useState(false);
    const [repositories, setRepositories] = React.useState([]);
    const [repositoryPage, setRepositoryPage] = React.useState(1);
    const [hasMoreRepositories, setHasMoreRepositories] = React.useState(false);
    const [loadingRepositories, setLoadingRepositories] = React.useState(false);
    const [repositoryError, setRepositoryError] = React.useState('');
    const [repositorySearch, setRepositorySearch] = React.useState('');
    const [openingRepository, setOpeningRepository] = React.useState('');
    const [activeRepository, setActiveRepository] = React.useState(contribution.activeRepository);
    const [panelView, setPanelView] = React.useState('repositories');
    const [gitStatus, setGitStatus] = React.useState(null);
    const [gitLoading, setGitLoading] = React.useState(false);
    const [gitBusy, setGitBusy] = React.useState(false);
    const [gitError, setGitError] = React.useState('');
    const [gitNotice, setGitNotice] = React.useState('');
    const [commitTitle, setCommitTitle] = React.useState('');
    const [commitDescription, setCommitDescription] = React.useState('');
    const [authorName, setAuthorName] = React.useState(contribution.githubAccount?.github_login || '');
    const [authorEmail, setAuthorEmail] = React.useState(
        contribution.githubAccount?.github_login
            ? `${contribution.githubAccount.github_login}@users.noreply.github.com`
            : '',
    );
    const [pushAfterCommit, setPushAfterCommit] = React.useState(false);
    const container = React.useRef(null);
    const trigger = React.useRef(null);
    const panel = React.useRef(null);
    const [panelPosition, setPanelPosition] = React.useState(null);
    React.useEffect(() => {
        const update = event => {
            setAccount(event.detail);
            if (event.detail?.github_login) {
                setAuthorName(current => current || event.detail.github_login);
                setAuthorEmail(current => current || `${event.detail.github_login}@users.noreply.github.com`);
            }
        };
        window.addEventListener('taskflow:github-account-status', update);
        return () => window.removeEventListener('taskflow:github-account-status', update);
    }, []);
    React.useEffect(() => {
        const update = event => {
            setActiveRepository(event.detail);
            setGitStatus(null);
            setGitError('');
        };
        window.addEventListener('taskflow:repository-context', update);
        return () => window.removeEventListener('taskflow:repository-context', update);
    }, []);
    React.useEffect(() => {
        const reportError = event => {
            setOpeningRepository('');
            setRepositoryError(event.detail);
        };
        window.addEventListener('taskflow:github-repository-error', reportError);
        return () => window.removeEventListener('taskflow:github-repository-error', reportError);
    }, []);
    React.useEffect(() => {
        if (!panelOpen) {
            return undefined;
        }
        const updatePanelPosition = () => {
            const bounds = trigger.current?.getBoundingClientRect();
            if (!bounds) {
                return;
            }
            setPanelPosition({
                top: Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - 100)),
                right: Math.max(8, window.innerWidth - bounds.right),
            });
        };
        const closeOnOutsideClick = event => {
            if (!container.current?.contains(event.target) && !panel.current?.contains(event.target)) {
                setPanelOpen(false);
            }
        };
        const closeOnEscape = event => {
            if (event.key === 'Escape') {
                setPanelOpen(false);
            }
        };
        updatePanelPosition();
        window.addEventListener('resize', updatePanelPosition);
        window.addEventListener('scroll', updatePanelPosition, true);
        window.addEventListener('pointerdown', closeOnOutsideClick);
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            window.removeEventListener('resize', updatePanelPosition);
            window.removeEventListener('scroll', updatePanelPosition, true);
            window.removeEventListener('pointerdown', closeOnOutsideClick);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [panelOpen]);

    const loadRepositories = async (page = 1, append = false) => {
        setLoadingRepositories(true);
        setRepositoryError('');
        try {
            const response = await contribution.apiFetch(`/api/github/repositories?page=${page}`);
            const result = await response.json();
            if (!response.ok) {
                const detail = isRecord(result) && typeof result.detail === 'string'
                    ? result.detail
                    : `HTTP ${response.status}`;
                throw new Error(detail);
            }
            if (!isRecord(result) || !Array.isArray(result.repositories) ||
                typeof result.has_more !== 'boolean') {
                throw new Error('GitHub returned an invalid repository list.');
            }
            const nextRepositories = result.repositories.map(repository => {
                if (!isRecord(repository) || typeof repository.full_name !== 'string' ||
                    typeof repository.private !== 'boolean' ||
                    !(typeof repository.description === 'string' || repository.description === null) ||
                    typeof repository.can_push !== 'boolean') {
                    throw new Error('GitHub returned an invalid repository entry.');
                }
                return repository;
            });
            setRepositories(current => append ? [...current, ...nextRepositories] : nextRepositories);
            setRepositoryPage(page);
            setHasMoreRepositories(result.has_more);
        } catch (error) {
            setRepositoryError(error instanceof Error ? error.message : 'Could not load GitHub repositories.');
        } finally {
            setLoadingRepositories(false);
        }
    };

    const loadGitStatus = async () => {
        if (!activeRepository) {
            return;
        }
        setGitLoading(true);
        setGitError('');
        try {
            const response = await contribution.apiFetch(
                `/api/github/repositories/${encodeURIComponent(activeRepository.projectId)}/git-status`,
            );
            const result = await response.json();
            if (!response.ok) {
                throw new Error(isRecord(result) && typeof result.detail === 'string'
                    ? result.detail
                    : `HTTP ${response.status}`);
            }
            if (!isRecord(result) || result.repository !== activeRepository.fullName ||
                typeof result.branch !== 'string' || !Array.isArray(result.files) ||
                typeof result.has_changes !== 'boolean') {
                throw new Error('Git returned an invalid repository status.');
            }
            const files = result.files.map(file => {
                if (!isRecord(file) || typeof file.path !== 'string' ||
                    typeof file.status !== 'string' || typeof file.staged !== 'boolean' ||
                    typeof file.unstaged !== 'boolean' || typeof file.untracked !== 'boolean') {
                    throw new Error('Git returned an invalid changed file.');
                }
                return file;
            });
            setGitStatus({ ...result, files });
        } catch (error) {
            setGitError(error instanceof Error ? error.message : 'Could not load Git status.');
        } finally {
            setGitLoading(false);
        }
    };

    React.useEffect(() => {
        if (panelOpen && panelView === 'source-control' && activeRepository) {
            void loadGitStatus();
            const timer = window.setInterval(() => void loadGitStatus(), 5000);
            return () => window.clearInterval(timer);
        }
        return undefined;
    }, [activeRepository, panelOpen, panelView]);

    const toggleGitFile = async file => {
        if (!activeRepository || gitBusy) {
            return;
        }
        setGitBusy(true);
        setGitError('');
        setGitNotice('');
        try {
            const response = await contribution.apiFetch(
                `/api/github/repositories/${encodeURIComponent(activeRepository.projectId)}/git-stage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        project_id: activeRepository.projectId,
                        paths: [file.path],
                        stage: !file.staged,
                    }),
                },
            );
            const result = await response.json();
            if (!response.ok) {
                throw new Error(isRecord(result) && typeof result.detail === 'string'
                    ? result.detail
                    : `HTTP ${response.status}`);
            }
            await loadGitStatus();
        } catch (error) {
            setGitError(error instanceof Error ? error.message : 'Could not update the staged files.');
        } finally {
            setGitBusy(false);
        }
    };

    const commitChanges = async () => {
        if (!activeRepository || gitBusy) {
            return;
        }
        setGitBusy(true);
        setGitError('');
        setGitNotice('');
        try {
            const response = await contribution.apiFetch(
                `/api/github/repositories/${encodeURIComponent(activeRepository.projectId)}/git-commit`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        project_id: activeRepository.projectId,
                        title: commitTitle,
                        description: commitDescription,
                        author_name: authorName,
                        author_email: authorEmail,
                    }),
                },
            );
            const result = await response.json();
            if (!response.ok) {
                throw new Error(isRecord(result) && typeof result.detail === 'string'
                    ? result.detail
                    : `HTTP ${response.status}`);
            }
            setCommitTitle('');
            setCommitDescription('');
            setGitNotice(`Commit ${result.commit} created locally.`);
            await loadGitStatus();
            if (pushAfterCommit) {
                await pushChanges(true);
            }
        } catch (error) {
            setGitError(error instanceof Error ? error.message : 'Could not create the commit.');
        } finally {
            setGitBusy(false);
        }
    };

    const pushChanges = async (afterCommit = false) => {
        if (!activeRepository || (gitBusy && !afterCommit)) {
            return;
        }
        if (!afterCommit && !window.confirm(`Push commits from ${activeRepository.fullName} to GitHub?`)) {
            return;
        }
        if (!afterCommit) {
            setGitBusy(true);
        }
        setGitError('');
        setGitNotice('');
        try {
            const response = await contribution.apiFetch(
                `/api/github/repositories/${encodeURIComponent(activeRepository.projectId)}/git-push`,
                { method: 'POST' },
            );
            const result = await response.json();
            if (!response.ok) {
                throw new Error(isRecord(result) && typeof result.detail === 'string'
                    ? result.detail
                    : `HTTP ${response.status}`);
            }
            setGitNotice(`Changes pushed to ${activeRepository.fullName}.`);
            await loadGitStatus();
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'Could not push changes to GitHub.';
            setGitError(afterCommit ? `Commit created locally, but the push failed: ${detail}` : detail);
        } finally {
            if (!afterCommit) {
                setGitBusy(false);
            }
        }
    };

    const connected = account?.connected === true;
    const label = connected ? `@${account.github_login}` : 'GitHub';
    const title = connected
        ? `Browse GitHub repositories linked to @${account.github_login}`
        : 'Connect GitHub in AI TaskFlow settings';
    return React.createElement(
        'div',
        { className: 'taskflow-github-menu', ref: container },
        React.createElement(
            'button',
            {
                type: 'button',
                className: `taskflow-github-toolbar-button${connected ? ' is-connected' : ''}`,
                title,
                'aria-label': title,
                'aria-haspopup': 'dialog',
                'aria-expanded': panelOpen,
                ref: trigger,
                onClick: async () => {
                    if (!connected) {
                        const latestAccount = await contribution.refreshGitHubAccount();
                        if (!latestAccount?.connected) {
                            setRepositoryError(latestAccount
                                ? 'Link GitHub in AI TaskFlow settings before opening repositories.'
                                : 'Could not verify the linked GitHub account. Reopen TF CODE and try again.');
                            setPanelOpen(true);
                            return;
                        }
                        setAccount(latestAccount);
                    }
                    const shouldOpen = !panelOpen;
                    setPanelOpen(shouldOpen);
                    if (shouldOpen) {
                        setRepositorySearch('');
                        setOpeningRepository('');
                        void loadRepositories();
                    }
                },
            },
            React.createElement('span', { className: 'taskflow-toolbar-icon', 'aria-hidden': true }, toolbarIcon('github')),
            React.createElement('span', { className: 'taskflow-toolbar-label' }, label),
        ),
        panelOpen && panelPosition && createPortal(React.createElement(
            'section',
            {
                className: 'taskflow-github-repository-panel',
                role: 'dialog',
                'aria-label': 'GitHub repositories',
                ref: panel,
                style: panelPosition,
            },
            React.createElement(
                'div',
                { className: 'taskflow-github-repository-heading' },
                React.createElement('strong', null,
                    panelView === 'source-control' && activeRepository
                        ? activeRepository.fullName
                        : 'GitHub repositories',
                ),
                React.createElement(
                    'button',
                    {
                        type: 'button',
                        className: 'taskflow-github-close',
                        'aria-label': 'Close repository list',
                        onClick: () => setPanelOpen(false),
                    },
                    '\u00d7',
                ),
            ),
            activeRepository && React.createElement(
                'div',
                { className: 'taskflow-github-tabs', role: 'tablist', 'aria-label': 'GitHub tools' },
                React.createElement(
                    'button',
                    {
                        type: 'button',
                        role: 'tab',
                        'aria-selected': panelView === 'repositories',
                        className: `taskflow-github-tab${panelView === 'repositories' ? ' is-active' : ''}`,
                        onClick: () => setPanelView('repositories'),
                    },
                    'Repositories',
                ),
                React.createElement(
                    'button',
                    {
                        type: 'button',
                        role: 'tab',
                        'aria-selected': panelView === 'source-control',
                        className: `taskflow-github-tab${panelView === 'source-control' ? ' is-active' : ''}`,
                        onClick: () => {
                            setPanelView('source-control');
                            setGitNotice('');
                            void loadGitStatus();
                        },
                    },
                    'Source Control',
                ),
            ),
            panelView === 'source-control' && activeRepository && React.createElement(
                'div',
                { className: 'taskflow-github-source-control' },
                React.createElement(
                    'div',
                    { className: 'taskflow-github-branch-row' },
                    React.createElement('span', null, `Branch: ${gitStatus?.branch || '...'}`),
                    React.createElement(
                        'button',
                        {
                            type: 'button',
                            className: 'taskflow-github-refresh',
                            'aria-label': 'Refresh Git status',
                            title: 'Refresh Git status',
                            disabled: gitLoading || gitBusy,
                            onClick: () => void loadGitStatus(),
                        },
                        '\u21bb',
                    ),
                ),
                gitError && React.createElement('p', { className: 'taskflow-github-repository-error', role: 'alert' }, gitError),
                gitNotice && React.createElement('p', { className: 'taskflow-github-repository-progress', role: 'status' }, gitNotice),
                gitLoading && !gitStatus && React.createElement('p', { className: 'taskflow-github-repository-state', role: 'status' }, 'Reading working tree...'),
                gitStatus?.files?.length
                    ? React.createElement(
                        'div',
                        { className: 'taskflow-github-changed-files', 'aria-label': 'Changed files' },
                        gitStatus.files.map(file => React.createElement(
                            'label',
                            { className: 'taskflow-github-changed-file', key: file.path },
                            React.createElement('input', {
                                type: 'checkbox',
                                checked: file.staged,
                                disabled: gitBusy,
                                'aria-label': `${file.staged ? 'Unstage' : 'Stage'} ${file.path}`,
                                onChange: () => void toggleGitFile(file),
                            }),
                            React.createElement(
                                'span',
                                { className: 'taskflow-github-changed-file-path' },
                                file.path,
                                React.createElement(
                                    'span',
                                    { className: 'taskflow-github-file-status' },
                                    `${file.status}${file.unstaged && file.staged ? ' · staged and modified' : ''}`,
                                ),
                            ),
                        )),
                    )
                    : gitStatus && React.createElement(
                        'p',
                        { className: 'taskflow-github-repository-state' },
                        'Working tree is clean.',
                    ),
                React.createElement('label', { className: 'taskflow-github-field-label', htmlFor: 'taskflow-commit-title' }, 'Commit title'),
                React.createElement('input', {
                    id: 'taskflow-commit-title',
                    className: 'taskflow-github-repository-search',
                    value: commitTitle,
                    maxLength: 200,
                    placeholder: 'Describe this change',
                    onChange: event => setCommitTitle(event.target.value),
                }),
                React.createElement('label', { className: 'taskflow-github-field-label', htmlFor: 'taskflow-commit-description' }, 'Description (optional)'),
                React.createElement('textarea', {
                    id: 'taskflow-commit-description',
                    className: 'taskflow-github-commit-description',
                    value: commitDescription,
                    maxLength: 5000,
                    placeholder: 'Add more context to the commit',
                    onChange: event => setCommitDescription(event.target.value),
                }),
                React.createElement('label', { className: 'taskflow-github-field-label', htmlFor: 'taskflow-commit-author' }, 'Commit author'),
                React.createElement('input', {
                    id: 'taskflow-commit-author',
                    className: 'taskflow-github-repository-search',
                    value: authorName,
                    maxLength: 100,
                    placeholder: 'Your name',
                    onChange: event => setAuthorName(event.target.value),
                }),
                React.createElement('label', { className: 'taskflow-github-field-label', htmlFor: 'taskflow-commit-email' }, 'Author email'),
                React.createElement('input', {
                    id: 'taskflow-commit-email',
                    className: 'taskflow-github-repository-search',
                    type: 'email',
                    value: authorEmail,
                    maxLength: 254,
                    placeholder: 'you@example.com',
                    onChange: event => setAuthorEmail(event.target.value),
                }),
                React.createElement(
                    'label',
                    { className: 'taskflow-github-push-option' },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: pushAfterCommit,
                        disabled: gitBusy,
                        onChange: event => setPushAfterCommit(event.target.checked),
                    }),
                    'Push to GitHub after commit',
                ),
                React.createElement(
                    'div',
                    { className: 'taskflow-github-commit-actions' },
                    React.createElement(
                        'button',
                        {
                            type: 'button',
                            className: 'taskflow-github-load-more',
                            disabled: gitBusy || !gitStatus?.files?.some(file => file.staged) || !commitTitle.trim(),
                            onClick: () => void commitChanges(),
                        },
                        gitBusy ? 'Working...' : 'Commit staged',
                    ),
                    React.createElement(
                        'button',
                        {
                            type: 'button',
                            className: 'taskflow-github-load-more',
                            disabled: gitBusy,
                            onClick: () => void pushChanges(),
                        },
                        'Push',
                    ),
                ),
            ),
            panelView === 'repositories' && React.createElement(
                React.Fragment,
                null,
            React.createElement('input', {
                className: 'taskflow-github-repository-search',
                type: 'search',
                value: repositorySearch,
                placeholder: 'Filter repositories',
                'aria-label': 'Filter GitHub repositories',
                onChange: event => setRepositorySearch(event.target.value),
            }),
            repositoryError && React.createElement('p', { className: 'taskflow-github-repository-error', role: 'alert' }, repositoryError),
            openingRepository && React.createElement(
                'p',
                { className: 'taskflow-github-repository-progress', role: 'status' },
                `Cloning ${openingRepository} into a new workspace...`,
            ),
            loadingRepositories && !repositories.length && React.createElement(
                'p',
                { className: 'taskflow-github-repository-state', role: 'status' },
                'Loading repositories...',
            ),
            !loadingRepositories && !repositories.length && !repositoryError && React.createElement(
                'p',
                { className: 'taskflow-github-repository-state' },
                'No accessible repositories were found.',
            ),
            React.createElement(
                'div',
                { className: 'taskflow-github-repository-list' },
                repositories
                    .filter(repository => `${repository.full_name} ${repository.description || ''}`
                        .toLowerCase().includes(repositorySearch.trim().toLowerCase()))
                    .map(repository => React.createElement(
                        'button',
                        {
                            type: 'button',
                            className: 'taskflow-github-repository-item',
                            key: repository.full_name,
                            disabled: Boolean(openingRepository),
                            onClick: () => {
                                setOpeningRepository(repository.full_name);
                                setRepositoryError('');
                                contribution.openGitHubRepository(repository.full_name);
                            },
                        },
                        React.createElement(
                            'span',
                            { className: 'taskflow-github-repository-name' },
                            repository.full_name,
                            React.createElement(
                                'span',
                                { className: 'taskflow-github-repository-badges' },
                                repository.private ? 'Private' : 'Public',
                                repository.can_push ? ' · Write' : ' · Read',
                            ),
                        ),
                        repository.description && React.createElement(
                            'span',
                            { className: 'taskflow-github-repository-description' },
                            repository.description,
                        ),
                    )),
            ),
            hasMoreRepositories && React.createElement(
                'button',
                {
                    type: 'button',
                    className: 'taskflow-github-load-more',
                    disabled: loadingRepositories,
                    onClick: () => void loadRepositories(repositoryPage + 1, true),
                },
                loadingRepositories ? 'Loading...' : 'Load more repositories',
            ),
            React.createElement(
                'p',
                { className: 'taskflow-github-repository-note' },
                'Opening a repository clones it into a separate TF CODE workspace.',
            ),
            ),
        ), document.body),
    );
}

function isRecord(value) {
    return typeof value === 'object' && value !== null;
}

function toolbarIcon(kind) {
    const paths = {
        return: 'M19 12H5m7 7-7-7 7-7',
        appearance: 'm12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3',
        newTab: 'M14 3h7v7M10 14 21 3M19 13v7H4V5h7',
        sidebar: 'M4 4h16v16H4zM9 4v16',
        github: 'M9 19c-4.3 1.4-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3-.3 6.1-1.5 6.1-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.2-.4-3.8 1.4a13.2 13.2 0 0 0-6.9 0C5.4 1.1 4.2 1.5 4.2 1.5a4.8 4.8 0 0 0-.1 3.6 5.2 5.2 0 0 0-1.4 3.6c0 5.2 3.1 6.4 6.1 6.7a3.4 3.4 0 0 0-.9 2.7V22'
    };
    return React.createElement(
        'svg',
        {
            viewBox: '0 0 24 24',
            width: 18,
            height: 18,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            focusable: false,
            'aria-hidden': true
        },
        React.createElement('path', { d: paths[kind] })
    );
}

function readImageCapability(model) {
    const name = model.toLowerCase().replace(/^models\//, '');
    if (/(?:-tts|transcribe|embedding|native-audio|live|lyria|robotics|deep-research)/i.test(name)) {
        return 'no';
    }
    if (/(gpt-4o|gpt-4\.1|gpt-5|gemini-(1\.5|2|2\.5|3|4)|gemma-[34]|claude-(3|4)|qwen[^/]*-vl|qwen-vl|llava|pixtral|ministral-3|llama-3\.2-(11b|90b)-vision|llama-4|molmo|internvl)/i.test(name)) {
        return 'yes';
    }
    if (/^(gpt-3\.5|deepseek-(chat|reasoner)|llama-3(?:\.1|\.3)?(?:-|$)|gemma-2(?:-|$)|qwen(?:2(?:\.5)?|3)?(?:-|$))/.test(name)) {
        return 'no';
    }
    return 'unknown';
}

async function imageToDataUrl(image, signal) {
    let source;
    if (typeof image.base64data === 'string') {
        const mimeType = typeof image.mimeType === 'string' && image.mimeType.startsWith('image/')
            ? image.mimeType
            : 'image/png';
        source = image.base64data.startsWith('data:')
            ? image.base64data
            : `data:${mimeType};base64,${image.base64data}`;
    } else if (typeof image.url === 'string') {
        const response = await fetch(image.url, { signal });
        if (!response.ok) {
            throw new Error(`تعذّر تحميل الصورة المرفقة (HTTP ${response.status}).`);
        }
        const blob = await response.blob();
        source = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('تعذّرت قراءة الصورة المرفقة.'));
            reader.onload = () => typeof reader.result === 'string'
                ? resolve(reader.result)
                : reject(new Error('صيغة الصورة المرفقة غير صالحة.'));
            reader.readAsDataURL(blob);
        });
    } else {
        throw new Error('تعذّر قراءة الصورة المرفقة من محادثة Theia.');
    }

    if (signal?.aborted) {
        throw new DOMException('تم إلغاء تحليل الصورة.', 'AbortError');
    }
    const bitmap = new Image();
    bitmap.src = source;
    await bitmap.decode();
    if (bitmap.naturalWidth < 1 || bitmap.naturalHeight < 1 || bitmap.naturalWidth > 8192 || bitmap.naturalHeight > 8192) {
        throw new Error('أبعاد الصورة المرفقة خارج الحد المدعوم (8192×8192).');
    }
    let scale = Math.min(1, 2048 / bitmap.naturalWidth, 2048 / bitmap.naturalHeight);
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(bitmap.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('تعذّر تجهيز الصورة المرفقة للتحليل.');
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const normalized = canvas.toDataURL('image/webp', Math.max(0.4, 0.88 - attempt * 0.09));
        if (normalized.length <= MAX_IMAGE_DATA_URL_LENGTH) {
            return normalized;
        }
        scale *= 0.72;
    }
    throw new Error('حجم الصورة المرفقة أكبر من الحد المدعوم للتحليل.');
}

function conversationFrom(messages) {
    const lastUserTextIndex = messages.reduce((last, message, index) =>
        message.actor === 'user' && message.type === 'text' ? index : last, -1);
    const currentText = lastUserTextIndex >= 0 && typeof messages[lastUserTextIndex].text === 'string'
        ? messages[lastUserTextIndex].text.trim()
        : '';
    const historyMessages = messages.slice(0, Math.max(0, lastUserTextIndex))
        .filter(message => message.type === 'text' && (message.actor === 'user' || message.actor === 'ai'))
        .map(message => ({
            role: message.actor === 'user' ? 'user' : 'assistant',
            content: typeof message.text === 'string' ? message.text.trim() : ''
        }))
        .filter(message => message.content.length > 0)
        .slice(-HISTORY_LIMIT);
    const images = messages.slice(Math.max(0, lastUserTextIndex + 1))
        .filter(message => message.actor === 'user' && message.type === 'image' && isRecord(message.image))
        .map(message => message.image);
    const systemPrompt = messages
        .filter(message => message.actor === 'system' && message.type === 'text' && typeof message.text === 'string')
        .map(message => message.text.trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 12000);
    return {
        message: currentText || (images.length ? 'حلّل الصور المرفقة وأجب عن محتواها.' : ''),
        history: historyMessages,
        images,
        systemPrompt
    };
}

let TaskflowAIContribution = class TaskflowAIContribution {
    constructor() {
        this.models = [];
        this.apiBase = '';
        this.sessionToken = null;
        this.providerFingerprint = '';
        this.providerRefreshTimer = undefined;
        this.refreshingProviders = false;
        this.originalUniversalAlias = undefined;
        this.originalCodeAlias = undefined;
        this.aliasSnapshotTaken = false;
        this.warnedNoProviders = false;
        this.standaloneWindows = new Set();
        this.handleParentMessage = this.handleParentMessage.bind(this);
    }

    initialize() {
        const expectedParentOrigin = new URLSearchParams(window.location.search).get('taskflowParentOrigin');
        if (!expectedParentOrigin) {
            console.error('TaskFlow AI could not determine the trusted platform origin.');
            return;
        }
        let parentOrigin;
        try {
            parentOrigin = new URL(expectedParentOrigin).origin;
        } catch (error) {
            console.error('TaskFlow AI received an invalid platform origin.', error);
            return;
        }
        this.parentOrigin = parentOrigin;
        this.isStandalone = window.parent === window;
        if (this.isStandalone && !window.opener) {
            console.error('TaskFlow AI standalone editor requires a trusted opener.');
            return;
        }
        window.addEventListener('message', this.handleParentMessage);
        if (this.isStandalone) {
            window.opener.postMessage({ type: 'taskflow:standalone-request-initialize' }, window.location.origin);
        } else {
            window.parent.postMessage({ type: 'taskflow:request-initialize' }, parentOrigin);
        }
    }

    handleParentMessage(event) {
        const fromPlatform = !this.isStandalone &&
            event.source === window.parent && event.origin === this.parentOrigin;
        const fromOpener = this.isStandalone &&
            event.source === window.opener && event.origin === window.location.origin;
        const fromStandalone = this.standaloneWindows.has(event.source) &&
            event.origin === window.location.origin;
        if (fromStandalone && isRecord(event.data)) {
            const forward = type => {
                if (this.isStandalone && window.opener) {
                    window.opener.postMessage({ type: `taskflow:standalone-${type}` }, window.location.origin);
                } else {
                    window.parent.postMessage({ type: `taskflow:${type}` }, this.parentOrigin);
                }
            };
            if (event.data.type === 'taskflow:standalone-request-initialize') {
                forward('request-initialize');
            } else if (event.data.type === 'taskflow:standalone-toggle-platform-sidebar') {
                forward('toggle-platform-sidebar');
            } else if (event.data.type === 'taskflow:standalone-return-to-platform') {
                forward('return-to-platform');
            }
            return;
        }
        if ((!fromPlatform && !fromOpener) || !isRecord(event.data) ||
            event.data.type !== 'taskflow:initialize' || typeof event.data.apiBase !== 'string' ||
            !(typeof event.data.sessionToken === 'string' || event.data.sessionToken === null)) return;
        let apiUrl;
        try {
            apiUrl = new URL(event.data.apiBase);
        } catch (error) {
            this.messageService.error('عنوان API المرسل من منصة TaskFlow غير صالح.');
            console.error('Invalid TaskFlow API URL.', error);
            return;
        }
        if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password) {
            this.messageService.error('عنوان API المرسل من منصة TaskFlow غير آمن.');
            return;
        }
        const sessionChanged = this.apiBase !== apiUrl.origin || this.sessionToken !== event.data.sessionToken;
        this.apiBase = apiUrl.origin;
        this.sessionToken = event.data.sessionToken;
        window.taskflowApiBase = this.apiBase;
        window.taskflowSessionToken = this.sessionToken;
        window.dispatchEvent(new Event('taskflow:platform-initialized'));
        for (const child of this.standaloneWindows) {
            if (child.closed) {
                this.standaloneWindows.delete(child);
            } else {
                child.postMessage({
                    type: 'taskflow:initialize',
                    apiBase: this.apiBase,
                    sessionToken: this.sessionToken
                }, window.location.origin);
            }
        }
        if (!sessionChanged) {
            return;
        }
        void this.initializePlatformAI().catch(error => {
            console.error('TaskFlow AI activation failed.', error);
            this.messageService.error(error instanceof Error ? error.message : 'تعذّر تفعيل محادثة TaskFlow AI.');
        });
    }

    async initializePlatformAI() {
        await this.preferenceService.ready;
        if (!this.preferenceService.get(AI_ENABLED_PREFERENCE, false)) {
            await this.preferenceService.set(AI_ENABLED_PREFERENCE, true, PreferenceScope.User);
        }
        if (!this.preferenceService.get(DEFAULT_CHAT_AGENT_PREFERENCE, '')) {
            await this.preferenceService.set(DEFAULT_CHAT_AGENT_PREFERENCE, 'Coder', PreferenceScope.User);
        }
        await this.refreshProviders();
        if (this.providerRefreshTimer === undefined) {
            this.providerRefreshTimer = window.setInterval(() => {
                void this.refreshProviders();
            }, 30000);
        }
    }

    onStop() {
        if (this.providerRefreshTimer !== undefined) {
            window.clearInterval(this.providerRefreshTimer);
            this.providerRefreshTimer = undefined;
        }
        window.removeEventListener('message', this.handleParentMessage);
    }

    async apiFetch(path, init = {}) {
        if (!this.apiBase) {
            throw new Error('لم يتم ربط محادثة Theia بمنصة TaskFlow بعد.');
        }
        const headers = new Headers(init.headers);
        if (this.sessionToken) {
            headers.set('Authorization', `Bearer ${this.sessionToken}`);
        }
        return fetch(`${this.apiBase}${path}`, { ...init, headers });
    }

    async refreshProviders() {
        if (this.refreshingProviders) {
            return;
        }
        this.refreshingProviders = true;
        try {
            const response = await this.apiFetch('/api/providers');
            const result = await response.json();
            if (!response.ok) {
                const detail = isRecord(result) && typeof result.detail === 'string' ? result.detail : `HTTP ${response.status}`;
                throw new Error(`تعذّر تحميل مزوّدي منصة TaskFlow: ${detail}`);
            }
            if (!Array.isArray(result) || !result.every(provider =>
                isRecord(provider) && typeof provider.id === 'string' && typeof provider.name === 'string' &&
                typeof provider.model === 'string' && typeof provider.is_default === 'boolean')) {
                throw new Error('استجابة قائمة مزوّدي TaskFlow غير صالحة.');
            }
            const providers = result;
            const fingerprint = JSON.stringify(providers.map(({ id, name, model, is_default }) => ({ id, name, model, is_default })));
            if (fingerprint === this.providerFingerprint) {
                return;
            }
            const models = await Promise.all(providers.map(async provider => {
                const capability = await this.getImageCapability(provider);
                return {
                    id: `taskflow/${provider.id}`,
                    name: `${provider.name} · ${provider.model}`,
                    vendor: 'AI TaskFlow',
                    family: provider.model,
                    status: { status: 'ready' },
                    request: (request, cancellationToken) =>
                        this.requestModel(provider, capability, request, cancellationToken)
                };
            }));
            this.registry.removeLanguageModels(this.models.map(model => model.id));
            this.models = models;
            await this.aliasRegistry.ready;
            if (!this.aliasSnapshotTaken) {
                const aliases = this.aliasRegistry.getAliases();
                this.originalUniversalAlias = aliases.find(alias => alias.id === 'default/universal');
                this.originalCodeAlias = aliases.find(alias => alias.id === 'default/code');
                this.aliasSnapshotTaken = true;
            }
            if (models.length) {
                this.registry.addLanguageModels(models);
                const defaultProvider = providers.find(provider => provider.is_default) ?? providers[0];
                const taskflowAlias = {
                    defaultModelIds: models.map(model => model.id),
                    selectedModelId: `taskflow/${defaultProvider.id}`,
                    description: 'نماذج مزوّدي منصة AI TaskFlow'
                };
                this.aliasRegistry.addAlias({ id: 'default/universal', ...taskflowAlias });
                this.aliasRegistry.addAlias({ id: 'default/code', ...taskflowAlias });
                this.warnedNoProviders = false;
            } else {
                this.restoreAlias('default/universal', this.originalUniversalAlias);
                this.restoreAlias('default/code', this.originalCodeAlias);
                if (!this.warnedNoProviders) {
                    this.messageService.warn('لا توجد مزوّدات AI مهيّأة في منصة TaskFlow. أضف مزوّدًا ثم أعد فتح محرر البرمجة.');
                    this.warnedNoProviders = true;
                }
            }
            this.providerFingerprint = fingerprint;
        } catch (error) {
            console.error('TaskFlow AI provider synchronization failed.', error);
            this.messageService.error(error instanceof Error ? error.message : 'تعذّر مزامنة مزوّدي AI مع محادثة Theia.');
        } finally {
            this.refreshingProviders = false;
        }
    }

    restoreAlias(id, alias) {
        if (alias) {
            this.aliasRegistry.addAlias({ ...alias });
        } else {
            this.aliasRegistry.removeAlias(id);
        }
    }

    async getImageCapability(provider) {
        try {
            const response = await this.apiFetch(`/api/providers/${encodeURIComponent(provider.id)}/models`);
            if (response.ok) {
                const result = await response.json();
                const capability = result?.image_capabilities?.[provider.model];
                if (capability === 'yes' || capability === 'no' || capability === 'unknown') {
                    return capability;
                }
            }
        } catch (error) {
            console.warn(`Could not determine image support for TaskFlow provider ${provider.id}.`, error);
        }
        return readImageCapability(provider.model);
    }

    async analyzeImages(images, signal) {
        const descriptions = [];
        for (const image of images) {
            const normalized = await imageToDataUrl(image, signal);
            const response = await this.apiFetch('/api/w2m/vision/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal,
                body: JSON.stringify({ image: normalized, mode: 'caption' })
            });
            const result = await response.json();
            if (!response.ok) {
                const detail = isRecord(result) && typeof result.detail === 'string'
                    ? result.detail
                    : `HTTP ${response.status}`;
                throw new Error(`تعذّر تحليل الصورة محليًا باستخدام Florence-2: ${detail}`);
            }
            if (!isRecord(result) || typeof result.caption !== 'string' || !result.caption.trim() || result.local_only !== true) {
                throw new Error('استجابة Florence-2 لتحليل الصورة غير صالحة.');
            }
            descriptions.push(result.caption.trim());
        }
        return descriptions;
    }

    async requestModel(provider, capability, request, cancellationToken) {
        const controller = new AbortController();
        const cancellation = cancellationToken?.onCancellationRequested(() => controller.abort());
        try {
            const prompt = conversationFrom(request.messages);
            if (!prompt.message) {
                throw new Error('اكتب رسالة أو أرفق صورة قبل الإرسال.');
            }
            if (prompt.images.length > IMAGE_LIMIT) {
                throw new Error(`يدعم هذا المسار حتى ${IMAGE_LIMIT} صور في الرسالة الواحدة.`);
            }
            const images = [];
            for (const image of prompt.images) {
                images.push(await imageToDataUrl(image, controller.signal));
            }
            const send = async (attachedImages, appendedDescription = '') => {
                const body = {
                    provider_id: provider.id,
                    message: `${prompt.message}${appendedDescription}`,
                    images: attachedImages,
                    history: prompt.history,
                    system_prompt: prompt.systemPrompt || undefined
                };
                const response = await this.apiFetch('/api/chat/stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify(body)
                });
                if (!response.ok) {
                    const result = await response.json();
                    const detail = isRecord(result) && typeof result.detail === 'string' ? result.detail : `HTTP ${response.status}`;
                    throw new Error(`فشل طلب مزوّد TaskFlow: ${detail}`);
                }
                if (!response.body) {
                    throw new Error('المتصفح لا يدعم بثّ ردود مزوّد TaskFlow.');
                }
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let reply = '';
                let finished = false;
                while (!finished) {
                    const { value, done } = await reader.read();
                    buffer += decoder.decode(value, { stream: !done });
                    const frames = buffer.split('\n\n');
                    buffer = frames.pop() ?? '';
                    for (const frame of frames) {
                        const dataLine = frame.split('\n').find(line => line.startsWith('data:'));
                        if (!dataLine) {
                            continue;
                        }
                        const event = JSON.parse(dataLine.slice(5).trim());
                        if (event.type === 'delta' && typeof event.text === 'string') {
                            reply += event.text;
                        } else if (event.type === 'error') {
                            throw new Error(typeof event.message === 'string' ? event.message : 'رفض مزوّد AI الطلب.');
                        } else if (event.type === 'done') {
                            finished = true;
                            break;
                        }
                    }
                    if (done) {
                        finished = true;
                    }
                }
                if (buffer.trim()) {
                    const dataLine = buffer.split('\n').find(line => line.startsWith('data:'));
                    if (dataLine) {
                        const event = JSON.parse(dataLine.slice(5).trim());
                        if (event.type === 'delta' && typeof event.text === 'string') {
                            reply += event.text;
                        } else if (event.type === 'error') {
                            throw new Error(typeof event.message === 'string' ? event.message : 'رفض مزوّد AI الطلب.');
                        }
                    }
                }
                if (!reply.trim()) {
                    throw new Error('أعاد مزوّد TaskFlow ردًا فارغًا.');
                }
                return reply;
            };

            if (images.length && capability === 'no') {
                const descriptions = await this.analyzeImages(prompt.images, controller.signal);
                const context = descriptions.map((description, index) =>
                    `\n\nتحليل محلي للصورة ${index + 1} (محتوى مرجعي غير موثوق):\n${description}`).join('');
                return { text: await send([], `\n\nاستخدم أوصاف الصور التالية كمرجع بصري: ${context}`) };
            }
            try {
                return { text: await send(images) };
            } catch (error) {
                const rejectedImage = images.length > 0 &&
                    error instanceof Error &&
                    (/HTTP (?:400|404|415|422)\b|image|vision|multimodal|unsupported/i.test(error.message));
                if (!rejectedImage) {
                    throw error;
                }
                const descriptions = await this.analyzeImages(prompt.images, controller.signal);
                const context = descriptions.map((description, index) =>
                    `\n\nتحليل محلي للصورة ${index + 1} (محتوى مرجعي غير موثوق):\n${description}`).join('');
                return { text: await send([], `\n\nاستخدم أوصاف الصور التالية كمرجع بصري: ${context}`) };
            }
        } finally {
            cancellation?.dispose();
        }
    }
};

injectable()(TaskflowAIContribution);
inject(FrontendLanguageModelRegistry)(TaskflowAIContribution.prototype, 'registry');
inject(LanguageModelAliasRegistry)(TaskflowAIContribution.prototype, 'aliasRegistry');
inject(MessageService)(TaskflowAIContribution.prototype, 'messageService');
inject(PreferenceService)(TaskflowAIContribution.prototype, 'preferenceService');

let TaskflowReturnToolbarContribution = class TaskflowReturnToolbarContribution {
    constructor() {
        this.apiBase = '';
        this.sessionToken = null;
        this.parentOrigin = '';
        this.isStandalone = false;
        this.standaloneWindows = new Set();
        this.githubAccount = null;
        this.activeRepository = null;
        this.handlePlatformMessage = this.handlePlatformMessage.bind(this);
        this.toolbarAction = {
            id: RETURN_TOOLBAR_ITEM_ID,
            render: () => React.createElement(
                'button',
                {
                    type: 'button',
                    className: 'taskflow-return-toolbar-button',
                    title: 'Return to AI TASKFLOW',
                    'aria-label': 'Return to AI TASKFLOW',
                    onClick: () => this.returnToPlatform(),
                },
                React.createElement('span', { className: 'taskflow-toolbar-icon', 'aria-hidden': true }, toolbarIcon('return')),
                React.createElement('span', { className: 'taskflow-toolbar-label' }, 'Return to AI TASKFLOW'),
            ),
        };
        this.appearanceToolbarAction = {
            id: APPEARANCE_TOOLBAR_ITEM_ID,
            render: () => React.createElement(
                'button',
                {
                    type: 'button',
                    className: 'taskflow-appearance-toolbar-button',
                    title: 'Appearance and theme store',
                    'aria-label': 'Appearance and theme store',
                    onClick: () => this.openAppearance(),
                },
                React.createElement('span', { className: 'taskflow-toolbar-icon', 'aria-hidden': true }, toolbarIcon('appearance')),
                React.createElement('span', { className: 'taskflow-toolbar-label' }, 'Appearance'),
            ),
        };
        this.openTabToolbarAction = {
            id: OPEN_TAB_TOOLBAR_ITEM_ID,
            render: () => React.createElement(
                'button',
                {
                    type: 'button',
                    className: 'taskflow-open-tab-toolbar-button',
                    title: 'Open editor in a new tab',
                    'aria-label': 'Open editor in a new tab',
                    onClick: () => this.openEditorInNewTab(),
                },
                React.createElement('span', { className: 'taskflow-toolbar-icon', 'aria-hidden': true }, toolbarIcon('newTab')),
                React.createElement('span', { className: 'taskflow-toolbar-label' }, 'New tab'),
            ),
        };
        this.sidebarToolbarAction = {
            id: SIDEBAR_TOOLBAR_ITEM_ID,
            render: () => React.createElement(
                'button',
                {
                    type: 'button',
                    className: 'taskflow-sidebar-toolbar-button',
                    title: 'Hide or show the TaskFlow sidebar',
                    'aria-label': 'Hide or show the TaskFlow sidebar',
                    onClick: () => this.togglePlatformSidebar(),
                },
                React.createElement('span', { className: 'taskflow-toolbar-icon', 'aria-hidden': true }, toolbarIcon('sidebar')),
                React.createElement('span', { className: 'taskflow-toolbar-label' }, 'Sidebar'),
            ),
        };
        this.githubToolbarAction = {
            id: GITHUB_TOOLBAR_ITEM_ID,
            render: () => React.createElement(GitHubToolbarButton, { contribution: this }),
        };
    }

    initialize() {
        const expectedParentOrigin = new URLSearchParams(window.location.search).get('taskflowParentOrigin');
        if (!expectedParentOrigin) {
            console.error('TaskFlow GitHub toolbar could not determine the platform origin.');
            return;
        }
        try {
            this.parentOrigin = new URL(expectedParentOrigin).origin;
        } catch (error) {
            console.error('TaskFlow GitHub toolbar received an invalid platform origin.', error);
            return;
        }
        this.isStandalone = window.parent === window;
        if (this.isStandalone && !window.opener) {
            console.error('TaskFlow standalone editor requires a trusted opener.');
            return;
        }
        window.addEventListener('message', this.handlePlatformMessage);
        if (typeof window.taskflowApiBase === 'string') {
            this.apiBase = window.taskflowApiBase;
        }
        if (typeof window.taskflowSessionToken === 'string' && window.taskflowSessionToken) {
            this.sessionToken = window.taskflowSessionToken;
        }
        if (this.apiBase && this.sessionToken) {
            void this.refreshGitHubAccount();
        }
        this.requestPlatformInitialization();
        void this.toolbarController.ready.promise
            .then(() => this.installToolbarItems())
            .catch(error => {
                console.error('TaskFlow toolbar initialization failed.', error);
                this.messageService.error('تعذّر تجهيز أزرار TaskFlow في شريط المحرر.');
            });
    }

    requestPlatformInitialization() {
        if (this.isStandalone) {
            window.opener.postMessage(
                { type: 'taskflow:standalone-request-initialize' },
                window.location.origin,
            );
        } else {
            window.parent.postMessage(
                { type: 'taskflow:request-initialize' },
                this.parentOrigin,
            );
        }
    }

    handlePlatformMessage(event) {
        const fromPlatform = !this.isStandalone &&
            event.source === window.parent && event.origin === this.parentOrigin;
        const fromOpener = this.isStandalone &&
            event.source === window.opener && event.origin === window.location.origin;
        const fromStandalone = this.standaloneWindows.has(event.source) &&
            event.origin === window.location.origin;
        if (fromStandalone && isRecord(event.data)) {
            if (event.data.type === 'taskflow:standalone-request-initialize') {
                this.requestPlatformInitialization();
            } else if (event.data.type === 'taskflow:standalone-return-to-platform') {
                if (this.isStandalone && window.opener) {
                    window.opener.postMessage(
                        { type: 'taskflow:standalone-return-to-platform' },
                        window.location.origin,
                    );
                } else {
                    window.parent.postMessage(
                        { type: 'taskflow:return-to-platform' },
                        this.parentOrigin,
                    );
                }
            } else if (event.data.type === 'taskflow:standalone-clone-github-repository' &&
                typeof event.data.full_name === 'string' &&
                /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(event.data.full_name)) {
                window.parent.postMessage({
                    type: 'taskflow:clone-github-repository',
                    full_name: event.data.full_name,
                }, this.parentOrigin);
            }
            return;
        }
        if ((fromPlatform || fromOpener) && isRecord(event.data) &&
            event.data.type === 'taskflow:github-repository-error' &&
            typeof event.data.message === 'string') {
            window.dispatchEvent(new CustomEvent('taskflow:github-repository-error', {
                detail: event.data.message,
            }));
            return;
        }
        if ((!fromPlatform && !fromOpener) || !isRecord(event.data) ||
            event.data.type !== 'taskflow:initialize' ||
            typeof event.data.apiBase !== 'string' ||
            !(typeof event.data.sessionToken === 'string' || event.data.sessionToken === null)) {
            return;
        }
        let apiUrl;
        try {
            apiUrl = new URL(event.data.apiBase);
        } catch (error) {
            console.error('TaskFlow platform supplied an invalid API URL to the GitHub toolbar.', error);
            return;
        }
        if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password) {
            console.error('TaskFlow platform supplied an unsafe API URL to the GitHub toolbar.');
            return;
        }
        const changed = this.apiBase !== apiUrl.origin || this.sessionToken !== event.data.sessionToken;
        this.apiBase = apiUrl.origin;
        this.sessionToken = event.data.sessionToken;
        this.activeRepository = typeof event.data.projectId === 'string' &&
            /^[a-f0-9]{32}$/.test(event.data.projectId) &&
            typeof event.data.repositoryFullName === 'string' &&
            /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(event.data.repositoryFullName)
            ? {
                projectId: event.data.projectId,
                fullName: event.data.repositoryFullName,
            }
            : null;
        window.dispatchEvent(new CustomEvent('taskflow:repository-context', {
            detail: this.activeRepository,
        }));
        window.taskflowApiBase = this.apiBase;
        window.taskflowSessionToken = this.sessionToken;
        for (const child of this.standaloneWindows) {
            if (child.closed) {
                this.standaloneWindows.delete(child);
            } else {
                child.postMessage({
                    type: 'taskflow:initialize',
                    apiBase: this.apiBase,
                    sessionToken: this.sessionToken,
                    ...(this.activeRepository ? {
                        projectId: this.activeRepository.projectId,
                        repositoryFullName: this.activeRepository.fullName,
                    } : {}),
                }, window.location.origin);
            }
        }
        if (changed) {
            void this.refreshGitHubAccount();
        }
    }

    async apiFetch(path, init = {}) {
        if (!this.apiBase) {
            throw new Error('لم يتم ربط محرر TF CODE بمنصة AI TaskFlow.');
        }
        const headers = new Headers(init.headers);
        if (this.sessionToken) {
            headers.set('Authorization', 'Bearer ' + this.sessionToken);
        }
        return fetch(`${this.apiBase}${path}`, { ...init, headers });
    }

    onStop() {
        window.removeEventListener('message', this.handlePlatformMessage);
    }

    async installToolbarItems() {
        const toolbar = this.toolbarController.toolbarItems;
        if (!toolbar) {
            throw new Error('Theia toolbar is not available.');
        }
        const rightGroups = toolbar.items.right;
        const existingIds = new Set(rightGroups.flat().map(item => item.id));
        const newItems = [];
        const actions = [
            [RETURN_TOOLBAR_ITEM_ID, this.toolbarAction],
            [APPEARANCE_TOOLBAR_ITEM_ID, this.appearanceToolbarAction],
            [OPEN_TAB_TOOLBAR_ITEM_ID, this.openTabToolbarAction],
            [SIDEBAR_TOOLBAR_ITEM_ID, this.sidebarToolbarAction],
            [GITHUB_TOOLBAR_ITEM_ID, this.githubToolbarAction],
        ];
        for (const [id, action] of actions) {
            if (!existingIds.has(id)) {
                newItems.push(new ReactToolbarItemImpl(
                    this.commandRegistry,
                    this.contextKeyService,
                    action,
                ));
            }
        }
        if (!newItems.length) {
            return;
        }
        this.toolbarController.toolbarItems = {
            ...toolbar,
            items: {
                ...toolbar.items,
                right: [...rightGroups, newItems],
            },
        };
    }

    openAppearance() {
        void this.commandRegistry.executeCommand('taskflow-appearance:toggle').catch(error => {
            console.error('Could not open the TaskFlow appearance view.', error);
            this.messageService.error('تعذّر فتح قسم المظهر والمتجر.');
        });
    }

    async refreshGitHubAccount() {
        if (!this.apiBase || !this.sessionToken) {
            this.setGitHubAccount(null);
            return null;
        }
        try {
            const response = await this.apiFetch('/api/github/account');
            const result = await response.json();
            if (!response.ok) {
                const detail = isRecord(result) && typeof result.detail === 'string'
                    ? result.detail
                    : `HTTP ${response.status}`;
                throw new Error(`تعذّر قراءة ربط GitHub المحفوظ في المنصة: ${detail}`);
            }
            if (!isRecord(result) || typeof result.connected !== 'boolean' ||
                !(typeof result.github_login === 'string' || result.github_login === null)) {
                throw new Error('استجابة حالة حساب GitHub من المنصة غير صالحة.');
            }
            const account = {
                connected: result.connected,
                github_login: result.github_login,
            };
            this.setGitHubAccount(account);
            return account;
        } catch (error) {
            console.error('Could not read the GitHub account linked to AI TaskFlow.', error);
            this.messageService.error(error instanceof Error ? error.message : 'تعذّر قراءة حساب GitHub المرتبط بالمنصة.');
            return null;
        }
    }

    setGitHubAccount(account) {
        this.githubAccount = account;
        window.dispatchEvent(new CustomEvent('taskflow:github-account-status', { detail: account }));
    }

    async showGitHubAccount() {
        const account = await this.refreshGitHubAccount();
        if (account?.connected && account.github_login) {
            this.messageService.info(`يستخدم TF CODE حساب GitHub المرتبط بالمنصة: @${account.github_login}.`);
        } else if (account) {
            this.messageService.info('اربط حساب GitHub أولًا من إعدادات منصة AI TaskFlow؛ سيستخدمه TF CODE تلقائيًا.');
        } else {
            this.messageService.error('تعذّر التحقق من جلسة منصة AI TaskFlow. ارجع إلى المنصة ثم افتح محرر البرمجة من جديد.');
        }
    }

    openGitHubRepository(fullName) {
        const message = this.isStandalone
            ? { type: 'taskflow:standalone-clone-github-repository', full_name: fullName }
            : { type: 'taskflow:clone-github-repository', full_name: fullName };
        const target = this.isStandalone ? window.opener : window.parent;
        target.postMessage(message, this.isStandalone ? window.location.origin : this.parentOrigin);
    }

    returnToPlatform() {
        const parentOrigin = new URLSearchParams(window.location.search).get('taskflowParentOrigin');
        if (!parentOrigin) {
            this.messageService.error('تعذّر تحديد وجهة الرجوع إلى منصة AI TaskFlow.');
            return;
        }
        let origin;
        try {
            origin = new URL(parentOrigin).origin;
        } catch (error) {
            this.messageService.error('تعذّر التحقق من وجهة الرجوع إلى منصة AI TaskFlow.');
            console.error('Invalid TaskFlow return origin.', error);
            return;
        }
        if (this.isStandalone) {
            if (window.opener) {
                window.opener.postMessage({ type: 'taskflow:standalone-return-to-platform' }, window.location.origin);
            }
            window.location.assign(origin);
            return;
        }
        window.parent.postMessage({ type: 'taskflow:return-to-platform' }, origin);
    }

    openEditorInNewTab() {
        const child = window.open(window.location.href, '_blank');
        if (!child) {
            this.messageService.error('تعذّر فتح تبويب جديد. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مجددًا.');
            return;
        }
        this.standaloneWindows.add(child);
    }

    togglePlatformSidebar() {
        if (this.isStandalone) {
            if (!window.opener) {
                this.messageService.error('افتح المحرر من داخل AI TaskFlow لاستخدام زر القائمة الجانبية.');
                return;
            }
            window.opener.postMessage({ type: 'taskflow:standalone-toggle-platform-sidebar' }, window.location.origin);
            return;
        }
        if (window.parent === window) {
            this.messageService.error('تعذّر الوصول إلى قائمة AI TaskFlow الجانبية.');
            return;
        }
        window.parent.postMessage({ type: 'taskflow:toggle-platform-sidebar' }, this.parentOrigin);
    }
};

injectable()(TaskflowReturnToolbarContribution);
inject(ToolbarController)(TaskflowReturnToolbarContribution.prototype, 'toolbarController');
inject(CommandRegistry)(TaskflowReturnToolbarContribution.prototype, 'commandRegistry');
inject(ContextKeyService)(TaskflowReturnToolbarContribution.prototype, 'contextKeyService');
inject(MessageService)(TaskflowReturnToolbarContribution.prototype, 'messageService');
inject(PreferenceService)(TaskflowReturnToolbarContribution.prototype, 'preferenceService');

class TaskflowLanguageCompatibilityContribution {
    onStart() {
        registerPythonLanguage();
    }
}
injectable()(TaskflowLanguageCompatibilityContribution);

export default new ContainerModule(bind => {
    bind(TaskflowAIContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TaskflowAIContribution);
    bind(TaskflowReturnToolbarContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TaskflowReturnToolbarContribution);
    bind(TaskflowLanguageCompatibilityContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TaskflowLanguageCompatibilityContribution);
});
