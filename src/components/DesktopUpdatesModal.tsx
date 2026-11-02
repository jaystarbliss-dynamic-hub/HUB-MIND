import React, { useState, useEffect } from 'react';
import {
  Download,
  ExternalLink,
  RefreshCw,
  X,
  Tag,
  GitCommit,
  FolderGit2,
  CheckCircle2,
  Zap,
  FileCode2,
  FileText,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  ArrowDownCircle,
  AlertCircle
} from 'lucide-react';

interface RepoReleaseAsset {
  id: number;
  name: string;
  sizeFormatted: string;
  downloadUrl: string;
}

interface RepoRelease {
  id: number;
  tag: string;
  name: string;
  publishedAt: string;
  htmlUrl: string;
  body: string;
  isLatest: boolean;
  installerAsset?: RepoReleaseAsset;
  apkAsset?: RepoReleaseAsset;
  extensionAsset?: RepoReleaseAsset;
}

interface RepoCommit {
  sha: string;
  fullSha: string;
  message: string;
  author: string;
  date: string;
  htmlUrl: string;
}

interface RepoOverview {
  name: string;
  fullName: string;
  description: string;
  htmlUrl: string;
  stars: number;
  forks: number;
  openIssues: number;
  defaultBranch: string;
  updatedAt: string;
}

export function DesktopUpdatesModal({
  isOpen: propIsOpen,
  onClose: propOnClose,
}: {
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = propIsOpen !== undefined ? propIsOpen : internalOpen;

  const [activeTab, setActiveTab] = useState<'releases' | 'android' | 'commits' | 'codebase'>('releases');
  const [androidReleases, setAndroidReleases] = useState<RepoRelease[]>([]);
  const [loading, setLoading] = useState(false);
  const [releases, setReleases] = useState<RepoRelease[]>([]);
  const [commits, setCommits] = useState<RepoCommit[]>([]);
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('0.1.0');
  const [expandedRelease, setExpandedRelease] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Codebase inspection state
  const [codePath, setCodePath] = useState<string>('package.json');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const handleClose = () => {
    setInternalOpen(false);
    if (propOnClose) propOnClose();
  };

  // Listen for global custom event
  useEffect(() => {
    const handleOpenEvent = () => setInternalOpen(true);
    window.addEventListener('hubmind:open-updates-panel', handleOpenEvent);
    return () => window.removeEventListener('hubmind:open-updates-panel', handleOpenEvent);
  }, []);

  const formatAssetBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const BUNDLED_FALLBACK_RELEASES: RepoRelease[] = [
    {
      id: 636,
      tag: 'desktop-v636',
      name: 'Hub-Mind Desktop v636',
      publishedAt: '2026-03-28T18:00:00Z',
      htmlUrl: 'https://github.com/jaystarbliss-dynamic-hub/HUB-MIND/releases/tag/desktop-v636',
      body: 'Performance and smoothness release:\n• Ultra-fast snap-of-a-finger voice connection to Jess\n• Throttled low-power rendering pipeline for mouse freeze prevention\n• Non-blocking MCP tool execution\n• Document editor table extensions and enhancements',
      isLatest: true,
      installerAsset: {
        id: 63601,
        name: 'Hub-Mind-Setup-x64.exe',
        sizeFormatted: '89.4 MB',
        downloadUrl: 'https://github.com/jaystarbliss-dynamic-hub/HUB-MIND/releases/download/desktop-v636/Hub-Mind-Setup-x64.exe',
      },
    },
    {
      id: 488,
      tag: 'desktop-v488',
      name: 'Hub-Mind Desktop v488',
      publishedAt: '2026-03-24T12:00:00Z',
      htmlUrl: 'https://github.com/jaystarbliss-dynamic-hub/HUB-MIND/releases/tag/desktop-v488',
      body: 'Desktop operations release with native Windows bridge, local speech recognition, and system management.',
      isLatest: false,
      installerAsset: {
        id: 48801,
        name: 'Hub-Mind-Setup-x64.exe',
        sizeFormatted: '88.2 MB',
        downloadUrl: 'https://github.com/jaystarbliss-dynamic-hub/HUB-MIND/releases/download/desktop-v488/Hub-Mind-Setup-x64.exe',
      },
    },
  ];

  const fetchDirectFromGitHub = async () => {
    const repoSlug = 'jaystarbliss-dynamic-hub/HUB-MIND';
    const ghHeaders = { Accept: 'application/vnd.github+json' };
    try {
      const [relRes, comRes, repoRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${repoSlug}/releases?per_page=30`, { headers: ghHeaders }).catch(() => null),
        fetch(`https://api.github.com/repos/${repoSlug}/commits?per_page=15`, { headers: ghHeaders }).catch(() => null),
        fetch(`https://api.github.com/repos/${repoSlug}`, { headers: ghHeaders }).catch(() => null),
      ]);

      const rawReleases = relRes && relRes.ok ? await relRes.json().catch(() => []) : [];
      const rawCommits = comRes && comRes.ok ? await comRes.json().catch(() => []) : [];
      const rawRepo = repoRes && repoRes.ok ? await repoRes.json().catch(() => null) : null;

      const publishedReleases = (Array.isArray(rawReleases) ? rawReleases : []).filter((rel: any) => !rel.draft && !rel.prerelease);
      let mappedAndroidReleases: RepoRelease[] = publishedReleases
        .map((rel: any) => {
          const apk = (Array.isArray(rel.assets) ? rel.assets : []).find((asset: any) => /\.apk$/i.test(String(asset.name || '')));
          if (!apk) return null;
          return {
            id: rel.id,
            tag: rel.tag_name || `release-${rel.id}`,
            name: rel.name || rel.tag_name || 'Hub-Mind Android Release',
            publishedAt: rel.published_at || rel.created_at || new Date().toISOString(),
            htmlUrl: rel.html_url || `https://github.com/${repoSlug}/releases`,
            body: rel.body || 'No release notes provided for this Android version.',
            isLatest: false,
            apkAsset: {
              id: apk.id,
              name: apk.name || 'Hub-Mind-Android.apk',
              sizeFormatted: formatAssetBytes(apk.size || 0),
              downloadUrl: apk.browser_download_url || '',
            },
          } as RepoRelease;
        })
        .filter((release: RepoRelease | null): release is RepoRelease => Boolean(release));
      if (mappedAndroidReleases.length > 0) mappedAndroidReleases[0].isLatest = true;

      let mappedReleases: RepoRelease[] = publishedReleases.map((rel: any, idx: number) => {
        const rawAssets = Array.isArray(rel.assets) ? rel.assets : [];
        const assets: RepoReleaseAsset[] = rawAssets.map((a: any) => ({
          id: a.id,
          name: a.name || 'unnamed-asset',
          sizeFormatted: formatAssetBytes(a.size || 0),
          downloadUrl: a.browser_download_url || '',
        }));
        const installerAsset = assets.find((a) => /\.exe$/i.test(a.name));
        const extensionAsset = assets.find((a) => /extension\.zip$/i.test(a.name) || /Jess-Chrome-Extension/i.test(a.name));
        const apkAsset = assets.find((a) => /\.apk$/i.test(a.name));
        return {
          id: rel.id,
          tag: rel.tag_name || `release-${rel.id}`,
          name: rel.name || rel.tag_name || 'Hub-Mind Desktop Release',
          publishedAt: rel.published_at || rel.created_at || new Date().toISOString(),
          htmlUrl: rel.html_url || `https://github.com/${repoSlug}/releases`,
          body: rel.body || 'No release notes provided for this version.',
          isLatest: idx === 0,
          installerAsset,
          apkAsset,
          extensionAsset,
        };
      }).filter((release) => Boolean(release.installerAsset) || /^desktop-/i.test(release.tag));

      if (mappedReleases.length === 0) {
        mappedReleases = BUNDLED_FALLBACK_RELEASES;
      }

      const mappedCommits: RepoCommit[] = (Array.isArray(rawCommits) ? rawCommits : []).map((c: any) => ({
        sha: String(c.sha || '').slice(0, 7),
        fullSha: String(c.sha || ''),
        message: String(c.commit?.message || '').split('\n')[0].trim(),
        author: String(c.commit?.author?.name || c.author?.login || 'Jaystarbliss'),
        date: c.commit?.author?.date || new Date().toISOString(),
        htmlUrl: c.html_url || `https://github.com/${repoSlug}/commit/${c.sha}`,
      }));

      setReleases(mappedReleases);
      setAndroidReleases(mappedAndroidReleases);
      setCommits(mappedCommits);
      if (rawRepo) {
        setOverview({
          name: rawRepo.name || 'HUB-MIND',
          fullName: rawRepo.full_name || repoSlug,
          description: rawRepo.description || 'Internal business operations platform for Jaystarbliss Studios',
          htmlUrl: rawRepo.html_url || `https://github.com/${repoSlug}`,
          stars: rawRepo.stargazers_count || 0,
          forks: rawRepo.forks_count || 0,
          openIssues: rawRepo.open_issues_count || 0,
          defaultBranch: rawRepo.default_branch || 'main',
          updatedAt: rawRepo.updated_at || new Date().toISOString(),
        });
      }
      if (mappedReleases.length > 0) {
        setExpandedRelease(mappedReleases[0].tag);
      }
    } catch {
      setReleases(BUNDLED_FALLBACK_RELEASES);
      setAndroidReleases([]);
      setExpandedRelease(BUNDLED_FALLBACK_RELEASES[0].tag);
    }
  };

  const fetchAndroidReleaseHistory = async () => {
    try {
      const response = await fetch('https://api.github.com/repos/jaystarbliss-dynamic-hub/HUB-MIND/releases?per_page=50', {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return;
      const raw = await response.json();
      const mapped: RepoRelease[] = (Array.isArray(raw) ? raw : [])
        .filter((rel: any) => !rel.draft && !rel.prerelease)
        .map((rel: any) => {
          const apk = (Array.isArray(rel.assets) ? rel.assets : []).find((asset: any) => /\.apk$/i.test(String(asset.name || '')));
          if (!apk) return null;
          return {
            id: rel.id,
            tag: rel.tag_name || `release-${rel.id}`,
            name: rel.name || rel.tag_name || 'Hub-Mind Android Release',
            publishedAt: rel.published_at || rel.created_at || new Date().toISOString(),
            htmlUrl: rel.html_url || 'https://github.com/jaystarbliss-dynamic-hub/HUB-MIND/releases',
            body: rel.body || 'No release notes provided for this Android version.',
            isLatest: false,
            apkAsset: {
              id: apk.id,
              name: apk.name || 'Hub-Mind-Android.apk',
              sizeFormatted: formatAssetBytes(apk.size || 0),
              downloadUrl: apk.browser_download_url || '',
            },
          } as RepoRelease;
        })
        .filter((release: RepoRelease | null): release is RepoRelease => Boolean(release));
      if (mapped.length > 0) mapped[0].isLatest = true;
      setAndroidReleases(mapped);
    } catch {
      // Preserve the last successful result when GitHub is unavailable.
    }
  };

  const loadRepositoryData = async (forceFresh = false) => {
    setLoading(true);
    setError(null);
    void fetchAndroidReleaseHistory();
    try {
      const res = await fetch(`/api/repository-context${forceFresh ? '?fresh=true' : ''}`,
        headers: { Accept: 'application/json' },
      }).catch(() => null);
      
      if (res && res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const text = await res.text();
          if (text && !text.trim().startsWith('<')) {
            try {
              const data = JSON.parse(text);
              if (Array.isArray(data.releases) && data.releases.length > 0) {
                setReleases(data.releases);
                setCommits(data.recentCommits || []);
                setOverview(data.overview || null);
                if (data.currentBundledVersion) setCurrentVersion(data.currentBundledVersion);
                setExpandedRelease(data.releases[0].tag);
                return;
              }
            } catch {
              // Ignore parse error and proceed to GitHub fallback
            }
          }
        }
      }
      await fetchDirectFromGitHub();
    } catch {
      try {
        await fetchDirectFromGitHub();
      } catch {
        setReleases(BUNDLED_FALLBACK_RELEASES);
        setExpandedRelease(BUNDLED_FALLBACK_RELEASES[0].tag);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadRepositoryData();
    }
  }, [isOpen]);

  const loadCodeFile = async (filePath: string) => {
    setFileLoading(true);
    try {
      const res = await fetch(`/api/github/codebase?path=${encodeURIComponent(filePath)}`, {
        headers: { Accept: 'application/json' },
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.success && data.content) {
          setFileContent(data.content);
          setCodePath(filePath);
          return;
        } else if (data.entries) {
          setFileContent(
            `Directory listing for /${data.path}:\n\n` +
              data.entries.map((e: any) => `${e.type === 'dir' ? '📁' : '📄'} ${e.name} ${e.size ? `(${e.size} bytes)` : ''}`).join('\n')
          );
          setCodePath(filePath);
          return;
        }
      }

      // Direct GitHub Contents API fallback
      const ghRes = await fetch(
        `https://api.github.com/repos/jaystarbliss-dynamic-hub/HUB-MIND/contents/${encodeURIComponent(filePath)}`,
        { headers: { Accept: 'application/vnd.github+json' } }
      );
      if (ghRes.ok) {
        const ghData = await ghRes.json();
        if (Array.isArray(ghData)) {
          setFileContent(
            `Directory listing for /${filePath}:\n\n` +
              ghData.map((e: any) => `${e.type === 'dir' ? '📁' : '📄'} ${e.name} ${e.size ? `(${e.size} bytes)` : ''}`).join('\n')
          );
          setCodePath(filePath);
          return;
        } else if (ghData?.content) {
          const decoded = atob(String(ghData.content).replace(/\s/g, ''));
          setFileContent(decoded);
          setCodePath(filePath);
          return;
        }
      }
      setFileContent(`[Unable to load file: ${filePath}]`);
    } catch (e: any) {
      setFileContent(`[Error reading file: ${e?.message || e}]`);
    } finally {
      setFileLoading(false);
    }
  };

  if (!isOpen) return null;

  const latestRelease = releases[0] || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-updates-title"
      className="fixed inset-0 z-[10001] flex items-stretch justify-center p-0 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 sm:items-center sm:p-5"
    >
      <div className="relative flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border-0 bg-slate-900 text-slate-100 shadow-2xl shadow-teal-950/60 sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:rounded-3xl sm:border sm:border-teal-500/30">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-teal-500/20 bg-slate-950/60 px-4 py-3 sm:items-center sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-300">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="desktop-updates-title" className="text-sm font-bold leading-tight text-teal-300 tracking-wide sm:text-lg">
                  Desktop Releases & Version History
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-teal-500/10 text-teal-300 rounded-full border border-teal-500/20">
                  Live GitHub
                </span>
              </div>
              <p className="hidden text-xs text-slate-400 sm:block">
                Windows and Android releases, installers, APKs and changelogs for Hub-Mind
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadRepositoryData(true)}
              disabled={loading}
              title="Refresh releases from GitHub"
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-teal-400' : ''}`} />
            </button>
            <a
              href="https://github.com/jaystarbliss-dynamic-hub/HUB-MIND"
              target="_blank"
              rel="noreferrer"
              title="Open GitHub Repository"
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 text-xs"
            >
              <FolderGit2 className="w-4 h-4 text-teal-400" />
              <span className="hidden sm:inline">GitHub</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
            <button
              type="button"
              onClick={handleClose}
              title="Close panel"
              className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Latest Version Hero Banner */}
        {latestRelease && (
          <div className="mx-3 mt-3 p-3 rounded-2xl sm:mx-6 sm:mt-4 sm:p-4 rounded-2xl bg-gradient-to-r from-teal-950/60 via-slate-900 to-slate-950 border border-teal-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-teal-500/20 border border-teal-500/40 text-teal-300 shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-teal-400">Latest Release</span>
                  <span className="px-2 py-0.5 rounded-md bg-teal-400/10 text-teal-200 text-xs font-mono font-bold">
                    {latestRelease.tag}
                  </span>
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(latestRelease.publishedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-slate-100 mt-0.5">{latestRelease.name}</h3>
                <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                  Current bundled version: v{currentVersion} • Total releases: {releases.length}
                </p>
              </div>
            </div>

            {latestRelease.installerAsset && (
              <a
                href={latestRelease.installerAsset.downloadUrl}
                download
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs sm:text-sm shadow-lg shadow-teal-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] shrink-0"
              >
                <ArrowDownCircle className="w-4 h-4" />
                <span>Download Windows App ({latestRelease.installerAsset.sizeFormatted})</span>
              </a>
            )}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="mt-3 flex shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-slate-800 px-3 sm:mt-4 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('releases')}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'releases'
                ? 'border-teal-400 text-teal-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Version Releases ({releases.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('android')}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'android'
                ? 'border-teal-400 text-teal-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="h-3.5 w-3.5" />
            <span>Android ({androidReleases.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('commits')}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'commits'
                ? 'border-teal-400 text-teal-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitCommit className="w-3.5 h-3.5" />
            <span>Recent Commits ({commits.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('codebase');
              if (!fileContent) void loadCodeFile('package.json');
            }}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'codebase'
                ? 'border-teal-400 text-teal-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>Codebase Explorer</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-4 sm:p-6">
          {error && (
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: RELEASES */}
          {activeTab === 'releases' && (
            <div className="space-y-3">
              {releases.length === 0 && !loading && (
                <div className="text-center py-10 text-slate-400 text-sm">
                  No public releases found yet. Check back soon!
                </div>
              )}

              {releases.map((release) => {
                const isExpanded = expandedRelease === release.tag;
                return (
                  <div
                    key={release.id}
                    className="rounded-2xl bg-slate-950/70 border border-slate-800 hover:border-teal-500/30 transition-all overflow-hidden"
                  >
                    <div
                      onClick={() => setExpandedRelease(isExpanded ? null : release.tag)}
                      className="flex flex-col gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-slate-900/50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 font-mono text-xs font-bold shrink-0">
                          <Tag className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-100 truncate">{release.name}</span>
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-teal-300">
                              {release.tag}
                            </span>
                            {release.isLatest && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                                LATEST
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                            <span>
                              {new Date(release.publishedAt).toLocaleDateString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                            {release.installerAsset && (
                              <>
                                <span>•</span>
                                <span className="text-teal-400 font-medium">
                                  {release.installerAsset.name} ({release.installerAsset.sizeFormatted})
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 sm:shrink-0">
                        {release.installerAsset && (
                          <a
                            href={release.installerAsset.downloadUrl}
                            download
                            onClick={(e) => e.stopPropagation()}
                            className="px-3 py-1.5 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download .exe</span>
                          </a>
                        )}
                        <button
                          type="button"
                          className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Collapsible Release Details */}
                    {isExpanded && (
                      <div className="px-5 pb-4 pt-2 border-t border-slate-800/80 bg-slate-900/40 space-y-3">
                        <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap font-sans bg-slate-950/50 p-3 rounded-xl border border-slate-800/80">
                          {release.body || 'No detailed changelog provided for this release.'}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
                          <div className="flex items-center gap-2">
                            {release.installerAsset && (
                              <span className="text-slate-400">
                                Installer: <strong className="text-slate-200">{release.installerAsset.name}</strong> ({release.installerAsset.sizeFormatted})
                              </span>
                            )}
                            {release.extensionAsset && (
                              <a
                                href={release.extensionAsset.downloadUrl}
                                download
                                className="text-sky-400 hover:underline inline-flex items-center gap-1"
                              >
                                <Download className="w-3 h-3" />
                                Chrome Extension
                              </a>
                            )}
                          </div>

                          <a
                            href={release.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-teal-400 hover:text-teal-300 inline-flex items-center gap-1"
                          >
                            <span>View on GitHub</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'android' && (
            <div className="space-y-3">
              {androidReleases.length === 0 && !loading && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-8 text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-400">
                    <Download className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-200">No Android release published yet</h3>
                  <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-400">
                    Android v2.4.0 is being prepared for owner signing and phone acceptance tests. Test builds are not shown as public downloads.
                  </p>
                </div>
              )}
              {androidReleases.map((release) => {
                const isExpanded = expandedRelease === release.tag;
                return (
                  <article key={release.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70">
                    <button
                      type="button"
                      onClick={() => setExpandedRelease(isExpanded ? null : release.tag)}
                      className="flex w-full min-w-0 items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-900/50"
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-teal-500/20 bg-teal-500/10 text-teal-400">
                          <Tag className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="break-words text-sm font-bold text-slate-100">{release.name}</span>
                            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-teal-300">{release.tag}</span>
                            {release.isLatest && <span className="rounded border border-teal-500/30 bg-teal-500/20 px-2 py-0.5 text-[10px] font-bold text-teal-300">LATEST</span>}
                          </span>
                          <span className="mt-1 block text-xs text-slate-400">
                            {new Date(release.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            {release.apkAsset ? ` · ${release.apkAsset.name} (${release.apkAsset.sizeFormatted})` : ''}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 pt-1 text-slate-400">{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                    </button>
                    {isExpanded && (
                      <div className="space-y-3 border-t border-slate-800/80 bg-slate-900/40 px-4 pb-4 pt-3">
                        <p className="whitespace-pre-wrap break-words rounded-xl border border-slate-800/80 bg-slate-950/50 p-3 text-xs leading-relaxed text-slate-300">{release.body || 'No detailed changelog provided.'}</p>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          {release.apkAsset && (
                            <a href={release.apkAsset.downloadUrl} download className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-xs font-semibold text-teal-300 hover:bg-teal-500/20">
                              <Download className="h-4 w-4" />
                              Download Android APK ({release.apkAsset.sizeFormatted})
                            </a>
                          )}
                          <a href={release.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300">
                            View release on GitHub <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {/* TAB 2: COMMITS */}
          {activeTab === 'commits' && (
            <div className="space-y-2">
              <div className="text-xs text-slate-400 mb-2">
                Latest commits pushed to the <code className="text-teal-300">main</code> branch:
              </div>
              {commits.map((commit) => (
                <div
                  key={commit.fullSha}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <GitCommit className="w-4 h-4 text-teal-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-200 leading-snug">
                        {commit.message}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                        <span>{commit.author}</span>
                        <span>•</span>
                        <span>{new Date(commit.date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <a
                    href={commit.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-teal-300 font-mono text-[11px] shrink-0 transition-colors flex items-center gap-1"
                  >
                    <span>{commit.sha}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: CODEBASE EXPLORER */}
          {activeTab === 'codebase' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400">Quick inspect:</span>
                {['package.json', 'electron/main.cjs', 'README.md', 'src/App.tsx', 'src/lib/jessTools.ts'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void loadCodeFile(p)}
                    className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] transition-colors cursor-pointer ${
                      codePath === p
                        ? 'bg-teal-500/20 border-teal-500/40 text-teal-300'
                        : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-900/50 text-xs">
                  <div className="flex items-center gap-2 font-mono text-slate-300">
                    <FileText className="w-3.5 h-3.5 text-teal-400" />
                    <span>{codePath}</span>
                  </div>
                  {fileLoading && <span className="text-teal-400 text-[11px] animate-pulse">Loading...</span>}
                </div>
                <pre className="p-4 text-xs font-mono text-slate-300 max-h-[360px] overflow-auto whitespace-pre leading-relaxed select-text">
                  {fileContent || 'Select a file above to inspect its content.'}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/60 px-4 py-2 text-[11px] text-slate-400 sm:px-6 sm:py-3 sm:text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
            <span className="hidden sm:inline">Jaystarbliss Studios • Hub-Mind Operations</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
