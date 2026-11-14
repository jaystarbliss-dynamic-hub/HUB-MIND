import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  Calendar as CalendarIcon,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Mic,
  Monitor,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Users,
} from 'lucide-react';

export type WorkspaceScreenId =
  | 'today'
  | 'inbox'
  | 'tasks'
  | 'projects'
  | 'documents'
  | 'calendar'
  | 'colleagues'
  | 'knowledge'
  | 'followups'
  | 'jess';

export interface WorkspaceScreenSpec {
  id: WorkspaceScreenId;
  label: string;
  mobileLabel: string;
  headline: string;
  summary: string;
  routeLabel: string;
  desktopAction: string;
  mobileAction: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

export const WORKSPACE_SCREENS: WorkspaceScreenSpec[] = [
  {
    id: 'today',
    label: 'Today',
    mobileLabel: 'Today',
    headline: 'Operations Hub at a glance',
    summary: 'Task completion gauges, daily focus queues, and AI-assisted end-of-day reporting synchronized in real time.',
    routeLabel: '/workspace',
    desktopAction: 'Checking completion rings & daily focus',
    mobileAction: 'Reviewing urgent items & schedule',
    icon: LayoutDashboard,
  },
  {
    id: 'inbox',
    label: 'Inbox',
    mobileLabel: 'Inbox',
    headline: 'Captures and shared workspace threads',
    summary: 'Incoming documents, team shares with edit permissions, and quick thoughts ready to convert into tasks or knowledge.',
    routeLabel: '/workspace/inbox',
    desktopAction: 'Triaging shared files & captures',
    mobileAction: 'Opening newly shared doc & message',
    icon: Inbox,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    mobileLabel: 'Tasks',
    headline: 'Focused priority and recurring execution',
    summary: 'Filter by active or completed work, inspect recurring schedules, and track clear ownership across every deliverable.',
    routeLabel: '/workspace/tasks',
    desktopAction: 'Filtering active urgent deliverables',
    mobileAction: 'Marking Q4 milestone complete',
    icon: CheckSquare,
  },
  {
    id: 'projects',
    label: 'Projects',
    mobileLabel: 'Projects',
    headline: 'Multi-track initiatives and timelines',
    summary: 'Switch smoothly between project card grids and Gantt timeline schedules anchored to clients and tasks.',
    routeLabel: '/workspace/projects',
    desktopAction: 'Inspecting active initiative progress',
    mobileAction: 'Checking delivery milestones',
    icon: Briefcase,
  },
  {
    id: 'documents',
    label: 'Documents',
    mobileLabel: 'Docs',
    headline: 'Paginated A4 word processor & letterhead',
    summary: 'Write formal proposals and monthly budgets on crisp physical A4 sheets with official letterhead, tables, and live sharing.',
    routeLabel: '/workspace/documents',
    desktopAction: 'Editing paginated A4 studio proposal',
    mobileAction: 'Reading shared A4 financial brief',
    icon: Folder,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    mobileLabel: 'Calendar',
    headline: 'Unified schedule and Google Calendar sync',
    summary: 'View monthly allocations, meetings, and task deadlines side-by-side with one-click schedule sharing.',
    routeLabel: '/workspace/calendar',
    desktopAction: 'Reviewing November sprint blocks',
    mobileAction: 'Checking upcoming 11:00 review',
    icon: CalendarIcon,
  },
  {
    id: 'colleagues',
    label: 'Colleagues & Clients',
    mobileLabel: 'People',
    headline: 'Connected handles and client accounts',
    summary: 'Send items directly to @username colleagues or inspect school, parent, and partner accounts from one directory.',
    routeLabel: '/workspace/colleagues',
    desktopAction: 'Sharing budget directly to @amara',
    mobileAction: 'Calling verified partner contact',
    icon: Users,
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    mobileLabel: 'Know',
    headline: 'Standard procedures, templates and playbooks',
    summary: 'Institutional memory organized by SOPs, templates, FAQs, and project lessons — searchable across web and Jess.',
    routeLabel: '/workspace/knowledge',
    desktopAction: 'Opening production SOP checklist',
    mobileAction: 'Searching onboarding playbook',
    icon: BookOpen,
  },
  {
    id: 'followups',
    label: 'Follow-ups',
    mobileLabel: 'Follow',
    headline: 'Overdue, due today and waiting radar',
    summary: 'Keep every external promise and client response visible with overdue counters and resolution tracking.',
    routeLabel: '/workspace/follow-ups',
    desktopAction: 'Checking overdue client confirmations',
    mobileAction: 'Logging contacted status update',
    icon: Clock3,
  },
  {
    id: 'jess',
    label: 'Jess & Settings',
    mobileLabel: 'Jess',
    headline: 'Voice companion, memory and device bridge',
    summary: 'Configure permission boundaries, adaptive tone, web research, and Windows or Android companion control.',
    routeLabel: '/workspace/settings',
    desktopAction: 'Managing Jess autonomy & Android link',
    mobileAction: 'Talking live with Jess companion',
    icon: Settings,
  },
];

export type OperatorPhase = 'dwell' | 'aim' | 'tap';

export function useWorkspaceOperatorCycle(intervalMs = 4300) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [operatorPhase, setOperatorPhase] = useState<OperatorPhase>('dwell');
  const [isPlaying, setIsPlaying] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const aimTimerRef = useRef<number | null>(null);
  const tapTimerRef = useRef<number | null>(null);
  const swapTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  const clearTimers = useCallback(() => {
    if (aimTimerRef.current) window.clearTimeout(aimTimerRef.current);
    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
    if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
  }, []);

  useEffect(() => {
    clearTimers();
    if (!isPlaying || isHovered || reducedMotion) {
      setOperatorPhase('dwell');
      return;
    }

    const dwellTime = Math.max(2200, intervalMs - 760);
    aimTimerRef.current = window.setTimeout(() => {
      setOperatorPhase('aim');
      tapTimerRef.current = window.setTimeout(() => {
        setOperatorPhase('tap');
        swapTimerRef.current = window.setTimeout(() => {
          setActiveIndex((prev) => (prev + 1) % WORKSPACE_SCREENS.length);
          setOperatorPhase('dwell');
        }, 260);
      }, 460);
    }, dwellTime);

    return clearTimers;
  }, [activeIndex, isPlaying, isHovered, reducedMotion, intervalMs, clearTimers]);

  const selectScreen = useCallback(
    (index: number) => {
      clearTimers();
      const normalized = ((index % WORKSPACE_SCREENS.length) + WORKSPACE_SCREENS.length) % WORKSPACE_SCREENS.length;
      setOperatorPhase('tap');
      setActiveIndex(normalized);
      tapTimerRef.current = window.setTimeout(() => {
        setOperatorPhase('dwell');
      }, 280);
    },
    [clearTimers]
  );

  const stepPrev = useCallback(() => {
    selectScreen(activeIndex - 1);
  }, [activeIndex, selectScreen]);

  const stepNext = useCallback(() => {
    selectScreen(activeIndex + 1);
  }, [activeIndex, selectScreen]);

  const nextIndex = (activeIndex + 1) % WORKSPACE_SCREENS.length;

  return {
    screens: WORKSPACE_SCREENS,
    activeIndex,
    nextIndex,
    activeScreen: WORKSPACE_SCREENS[activeIndex],
    nextScreen: WORKSPACE_SCREENS[nextIndex],
    operatorPhase,
    isPlaying: isPlaying && !reducedMotion,
    isHovered,
    setIsPlaying,
    setIsHovered,
    selectScreen,
    stepPrev,
    stepNext,
  };
}

/**
 * Keeps device mockups in their true aspect ratio at any viewport width,
 * scaling proportionally down to fit mobile phones cleanly without squishing
 * landscape PC screens into narrow vertical rectangles.
 */
function ResponsiveScaledFrame({
  designWidth,
  designHeight,
  maxWidth,
  center = false,
  className = '',
  children,
}: {
  designWidth: number;
  designHeight: number;
  maxWidth?: number;
  center?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return maxWidth ? Math.min(designWidth, maxWidth) : designWidth;
    const vwBound = Math.max(240, window.innerWidth - 36);
    return maxWidth ? Math.min(designWidth, maxWidth, vwBound) : Math.min(designWidth, vwBound);
  });

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const measured = el.clientWidth;
      if (measured > 0) setContainerWidth(measured);
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const targetWidth = maxWidth ? Math.min(containerWidth, maxWidth) : containerWidth;
  const scale = Math.min(1, Math.max(0.24, targetWidth / designWidth));
  const scaledWidth = Math.round(designWidth * scale);
  const scaledHeight = Math.round(designHeight * scale);

  return (
    <div
      ref={outerRef}
      className={`w-full overflow-hidden ${center ? 'flex justify-center' : ''} ${className}`}
      style={{ height: `${scaledHeight}px` }}
    >
      <div
        className="relative shrink-0"
        style={{
          width: `${scaledWidth}px`,
          height: `${scaledHeight}px`,
        }}
      >
        <div
          style={{
            width: `${designWidth}px`,
            height: `${designHeight}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function CircularGauge({
  pct,
  label,
  sub,
  strokeClass,
  textClass,
  compact = false,
}: {
  pct: number;
  label: string;
  sub: string;
  strokeClass: string;
  textClass: string;
  compact?: boolean;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (Math.min(100, Math.max(0, pct)) / 100) * circumference;

  return (
    <div
      className={`bg-slate-900 border border-slate-800 rounded-lg ${
        compact ? 'p-2 gap-2' : 'p-2.5 gap-2'
      } flex items-center justify-between`}
    >
      <div className="min-w-0">
        <span
          className={`block ${
            compact ? 'text-[7.5px]' : 'text-[8.5px]'
          } font-bold uppercase tracking-wider text-slate-400 truncate`}
        >
          {label}
        </span>
        <div
          className={`${
            compact ? 'text-xs' : 'text-[15px]'
          } font-extrabold text-white tabular-nums mt-0.5 leading-none`}
        >
          {pct}%
        </div>
        <span className={`block ${compact ? 'text-[8px]' : 'text-[8.5px]'} text-slate-400 truncate mt-1`}>
          {sub}
        </span>
      </div>
      <div className={`relative ${compact ? 'w-8 h-8' : 'w-10 h-10'} shrink-0 flex items-center justify-center`}>
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r={radius} strokeWidth="5.5" className="text-slate-800" stroke="currentColor" fill="transparent" />
          <circle
            cx="32"
            cy="32"
            r={radius}
            strokeWidth="5.5"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            className={strokeClass}
            stroke="currentColor"
            fill="transparent"
          />
        </svg>
        <span className={`absolute ${compact ? 'text-[7.5px]' : 'text-[8.5px]'} font-bold tabular-nums ${textClass}`}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

function ScreenInnerContent({
  screenId,
  variant,
}: {
  screenId: WorkspaceScreenId;
  variant: 'desktop' | 'mobile';
}) {
  const isMobile = variant === 'mobile';

  switch (screenId) {
    case 'today':
      return (
        <div className={isMobile ? 'space-y-2' : 'space-y-3'}>
          <div>
            <h4 className={`${isMobile ? 'text-xs' : 'text-[14px]'} font-bold text-white tracking-tight`}>
              Good morning, Studio Lead
            </h4>
            <p className={`${isMobile ? 'text-[8.5px]' : 'text-[9.5px]'} text-slate-400`}>
              Operations Hub · Live sync
            </p>
          </div>
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-1.5' : 'grid-cols-3 gap-2.5'}`}>
            <CircularGauge
              pct={84}
              label="Task Completion"
              sub="21 of 25 done"
              strokeClass="text-teal-400"
              textClass="text-teal-300"
              compact={isMobile}
            />
            <CircularGauge
              pct={92}
              label="Active Projects"
              sub="6 active · 7 total"
              strokeClass="text-sky-400"
              textClass="text-sky-300"
              compact={isMobile}
            />
            {!isMobile && (
              <CircularGauge
                pct={100}
                label="Schedule Health"
                sub="0 overdue deadlines"
                strokeClass="text-emerald-400"
                textClass="text-emerald-300"
              />
            )}
          </div>
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-1.5' : 'grid-cols-2 gap-2.5'}`}>
            <div className={`bg-slate-900 border border-slate-800 rounded-lg ${isMobile ? 'p-2 space-y-1.5' : 'p-2.5 space-y-2'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`${isMobile ? 'text-[7.5px]' : 'text-[8.5px]'} font-bold uppercase tracking-wider text-slate-400`}>
                  Today&apos;s Focus
                </span>
                <span className={`${isMobile ? 'text-[8px]' : 'text-[8.5px]'} font-semibold text-teal-300`}>
                  Share Schedule
                </span>
              </div>
              <div className={`${isMobile ? 'space-y-1 text-[9px]' : 'space-y-1.5 text-[10px]'} text-slate-300`}>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-teal-400 shrink-0" />
                  <span>2 Urgent Tasks queued</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CalendarIcon className="w-3 h-3 text-teal-400 shrink-0" />
                  <span>3 Meetings Today</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Inbox className="w-3 h-3 text-teal-400 shrink-0" />
                  <span>4 Inbox Captures pending</span>
                </div>
              </div>
            </div>
            {!isMobile && (
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[8.5px] font-bold uppercase tracking-wider text-slate-400">
                    End-of-Day Report
                  </span>
                  <span className="inline-flex items-center gap-1 text-[8.5px] font-semibold text-teal-300">
                    <Bot className="w-3 h-3" /> Jess Ready
                  </span>
                </div>
                <p className="text-[9.5px] text-slate-400 font-mono leading-relaxed my-1.5">
                  Completed: A4 budget layout
                  <br />
                  Pending: Client contract sign-off
                </p>
                <div className="flex items-center gap-2 pt-1.5 border-t border-slate-800">
                  <span className="px-2 py-0.5 rounded bg-teal-400 text-slate-950 text-[8.5px] font-bold">
                    Save Report
                  </span>
                  <span className="text-[8.5px] text-emerald-300 font-medium">WhatsApp Ready</span>
                </div>
              </div>
            )}
          </div>
        </div>
      );

    case 'inbox':
      return (
        <div className={isMobile ? 'space-y-2' : 'space-y-2.5'}>
          <div className={`flex ${isMobile ? 'flex-col gap-1.5' : 'items-center justify-between gap-2'}`}>
            <div>
              <h4 className={`${isMobile ? 'text-xs' : 'text-[14px]'} font-bold text-white`}>
                Inbox &amp; Team Shares
              </h4>
              <p className={`${isMobile ? 'text-[8.5px]' : 'text-[9.5px]'} text-slate-400`}>
                Captures · Shared Documents · Messages
              </p>
            </div>
            <div className="inline-flex self-start items-center gap-0.5 bg-slate-900 border border-slate-800 rounded p-0.5 text-[7.5px]">
              <span className="px-1.5 py-[2px] rounded-sm bg-teal-400 text-slate-950 font-bold leading-tight">Unprocessed</span>
              <span className="px-1.5 py-[2px] text-slate-400 leading-tight">Processed</span>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg divide-y divide-slate-800">
            <div className={isMobile ? 'p-2 space-y-1' : 'p-2.5 space-y-1.5'}>
              <div className="flex items-center justify-between text-[8px]">
                <span className="font-semibold text-teal-300">Shared by @amara · Edit Access</span>
                <span className="text-slate-500 tabular-nums">Just now</span>
              </div>
              <p className={`${isMobile ? 'text-[10px]' : 'text-[11px]'} font-semibold text-white leading-snug`}>
                Monthly Operating Expenses — Q4 Studio Sheet
              </p>
              <div className="flex items-center gap-1.5 pt-0.5 text-[7.5px] text-slate-300">
                <span className="px-1.5 py-[2px] rounded bg-teal-400/15 text-teal-300 font-semibold leading-tight">
                  Open Editor
                </span>
                <span className="px-1.5 py-[2px] rounded bg-slate-800 text-slate-300 leading-tight">
                  Convert to Task
                </span>
              </div>
            </div>
            <div className={isMobile ? 'p-2 space-y-1' : 'p-2.5 space-y-1'}>
              <div className="flex items-center justify-between text-[8px]">
                <span className="text-slate-400">Voice Capture · Jess Note</span>
                <span className="text-slate-500 tabular-nums">14m ago</span>
              </div>
              <p className={`${isMobile ? 'text-[9.5px]' : 'text-[10.5px]'} text-slate-200 leading-snug`}>
                Prepare Sangotedo campus briefing slides for Thursday walkthrough.
              </p>
            </div>
            {!isMobile && (
              <div className="p-2.5 flex items-center justify-between text-[9.5px]">
                <span className="text-slate-300">Direct message from @daniel regarding APK release</span>
                <span className="text-teal-300 font-semibold shrink-0">Reply</span>
              </div>
            )}
          </div>
        </div>
      );

    case 'tasks':
      return (
        <div className={isMobile ? 'space-y-2' : 'space-y-2.5'}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className={`${isMobile ? 'text-xs' : 'text-[14px]'} font-bold text-white`}>Tasks</h4>
              <p className={`${isMobile ? 'text-[8.5px]' : 'text-[9.5px]'} text-slate-400`}>
                Owned, assigned &amp; recurring sprints
              </p>
            </div>
            <span className="px-1.5 py-[2px] rounded bg-teal-400 text-slate-950 text-[7.5px] font-bold inline-flex items-center gap-1 shrink-0 leading-tight">
              <Plus className="w-2.5 h-2.5" /> New
            </span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg divide-y divide-slate-800">
            {[
              { title: 'Verify Android Workspace & Branding Release v2.5.1', status: 'In Progress', priority: 'Urgent', tone: 'text-rose-300', owner: 'Daniel' },
              { title: 'Finalize November Financial Ledger (A4 PDF)', status: 'Assigned', priority: 'High', tone: 'text-amber-300', owner: 'Amara' },
              { title: 'Update Jess Memory Guardrails for Web Sync', status: 'Completed', priority: 'Medium', tone: 'text-emerald-300', owner: 'Studio Lead' },
              ...(!isMobile ? [{ title: 'Publish Cedar County Facility Briefing', status: 'Assigned', priority: 'Low', tone: 'text-slate-300', owner: 'Tolu' }] : []),
            ].map((item) => (
              <div key={item.title} className={`${isMobile ? 'p-2' : 'p-2.5'} flex items-center justify-between gap-2`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[8px] text-slate-400 mb-0.5">
                    <span className={item.tone}>{item.priority}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.status}</span>
                  </div>
                  <p className={`${isMobile ? 'text-[9.5px]' : 'text-[10.5px]'} font-semibold text-white truncate`}>
                    {item.title}
                  </p>
                  <p className="text-[8px] text-slate-500">Assigned to {item.owner}</p>
                </div>
                <span className="px-1.5 py-[2px] rounded bg-slate-800 text-teal-300 text-[7.5px] font-semibold shrink-0 leading-tight">
                  View
                </span>
              </div>
            ))}
          </div>
        </div>
      );

    case 'projects':
      return (
        <div className={isMobile ? 'space-y-2' : 'space-y-2.5'}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className={`${isMobile ? 'text-xs' : 'text-[14px]'} font-bold text-white flex items-center gap-1.5`}>
                <Folder className={`${isMobile ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-teal-400`} /> Projects
              </h4>
              <p className={`${isMobile ? 'text-[8.5px]' : 'text-[9.5px]'} text-slate-400`}>
                Parent workspaces &amp; timelines
              </p>
            </div>
            <div className="flex items-center gap-1">
              <span className="p-1 rounded bg-teal-400/15 text-teal-300">
                <LayoutGrid className="w-2.5 h-2.5" />
              </span>
              <span className="px-2 py-0.5 rounded bg-teal-400 text-slate-950 text-[8px] font-bold">
                New Project
              </span>
            </div>
          </div>
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-1.5' : 'grid-cols-2 gap-2.5'}`}>
            {[
              { name: 'Hub-Mind Android Sync', desc: 'Native companion & Accessibility control channel', progress: 88, due: 'Nov 22' },
              { name: 'Executive Curriculum Deck', desc: 'Multi-page documentation & partner handbooks', progress: 64, due: 'Nov 30' },
            ].map((proj) => (
              <div
                key={proj.name}
                className={`bg-slate-900 border border-slate-800 rounded-lg ${
                  isMobile ? 'p-2 space-y-1.5' : 'p-2.5 space-y-2'
                }`}
              >
                <div className="flex items-center justify-between text-[8px] text-slate-400">
                  <span>Active</span>
                  <span className="tabular-nums">Due {proj.due}</span>
                </div>
                <p className={`${isMobile ? 'text-[10.5px]' : 'text-[11.5px]'} font-bold text-white truncate`}>
                  {proj.name}
                </p>
                <p className={`${isMobile ? 'text-[8.5px]' : 'text-[9.5px]'} text-slate-400 line-clamp-2`}>
                  {proj.desc}
                </p>
                <div className="space-y-1 pt-0.5">
                  <div className="flex justify-between text-[8px] text-slate-400 tabular-nums">
                    <span>Milestones</span>
                    <span className="text-teal-300 font-semibold">{proj.progress}%</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-teal-400 rounded-full" style={{ width: `${proj.progress}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case 'documents':
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-1.5 bg-slate-900 border border-slate-800 rounded-md px-2 py-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <FileText className="w-3 h-3 text-teal-400 shrink-0" />
              <span className={`${isMobile ? 'text-[9px]' : 'text-[10px]'} font-semibold text-white truncate`}>
                Monthly Expenses Overview
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[8px] shrink-0">
              <span className="text-slate-400 tabular-nums">A4 · 1/2</span>
              <span className="px-1.5 py-0.5 rounded bg-teal-400 text-slate-950 font-bold">Share</span>
            </div>
          </div>
          <div className={`bg-white text-slate-900 rounded-md ${isMobile ? 'p-2 space-y-1.5' : 'p-3 space-y-2'} shadow-lg border border-slate-300`}>
            <div className="border-b border-slate-200 pb-1.5 text-center">
              <p className={`${isMobile ? 'text-[8px]' : 'text-[9.5px]'} font-extrabold tracking-wide text-slate-950`}>
                JAYSTARBLISS DYNAMIC INSTITUTE
              </p>
              <p className={`${isMobile ? 'text-[6.5px]' : 'text-[7.5px]'} text-slate-500`}>
                No 3 Komolafe Street, Cedar County Estate · Sangotedo, Lagos
              </p>
            </div>
            <div className={`border border-slate-300 rounded overflow-hidden ${isMobile ? 'text-[7px]' : 'text-[8.5px]'}`}>
              <div className="grid grid-cols-3 bg-slate-100 font-bold text-slate-800 border-b border-slate-300 px-2 py-1">
                <span>Expense Item</span>
                <span>Amount</span>
                <span>Date</span>
              </div>
              <div className="grid grid-cols-3 border-b border-slate-200 px-2 py-1 tabular-nums">
                <span>Fiber &amp; Cloud Sync</span>
                <span>18,500</span>
                <span>06 Nov</span>
              </div>
              <div className="grid grid-cols-3 border-b border-slate-200 px-2 py-1 tabular-nums bg-teal-50/40">
                <span>Studio Hardware</span>
                <span>42,000</span>
                <span>10 Nov</span>
              </div>
              <div className="grid grid-cols-3 px-2 py-1 tabular-nums">
                <span>Team Operations</span>
                <span>29,000</span>
                <span>14 Nov</span>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-slate-200 text-[6.5px] text-slate-400 font-mono">
              <span>Monthly Expenses Overview</span>
              <span>Page 1 of 2</span>
            </div>
          </div>
        </div>
      );

    case 'calendar':
      return (
        <div className={isMobile ? 'space-y-1.5' : 'space-y-2.5'}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className={`${isMobile ? 'text-xs' : 'text-[14px]'} font-bold text-white`}>November 2026</h4>
              <p className={`${isMobile ? 'text-[8px]' : 'text-[9.5px]'} text-emerald-300`}>
                Google Calendar Connected
              </p>
            </div>
            <div className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded-md p-0.5 text-[8px]">
              <span className="px-1.5 py-0.5 rounded bg-teal-400 text-slate-950 font-bold">Month</span>
              <span className="px-1.5 py-0.5 text-slate-400">Agenda</span>
            </div>
          </div>
          <div className={`bg-slate-900 border border-slate-800 rounded-lg ${isMobile ? 'p-1.5' : 'p-2.5'}`}>
            <div className={`grid grid-cols-7 gap-1 text-center ${isMobile ? 'text-[7px]' : 'text-[8px]'} font-semibold text-slate-500 pb-1`}>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
              <span>Sun</span>
            </div>
            <div className={`grid grid-cols-7 gap-1 ${isMobile ? 'text-[8px]' : 'text-[9px]'} tabular-nums`}>
              {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((day) => {
                const isSelected = day === 14;
                const hasEvent = day === 11 || day === 14 || day === 18 || day === 20;
                return (
                  <div
                    key={day}
                    className={`rounded-md ${isMobile ? 'p-1 min-h-[26px]' : 'p-1.5 min-h-[34px]'} border flex flex-col justify-between ${
                      isSelected
                        ? 'bg-teal-400/15 border-teal-400/60 text-teal-200 font-bold'
                        : 'bg-slate-950/60 border-slate-800/80 text-slate-300'
                    }`}
                  >
                    <span>{day}</span>
                    {hasEvent && (
                      <span
                        className={`block h-0.5 w-full rounded-full ${
                          isSelected ? 'bg-teal-300' : 'bg-sky-400/70'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-md px-2 py-1.5 flex items-center justify-between text-[9px]">
            <span className="text-white font-medium truncate">11:00 · Weekly Engineering Sync</span>
            <span className="text-teal-300 tabular-nums shrink-0 ml-2">Today</span>
          </div>
        </div>
      );

    case 'colleagues':
      return (
        <div className={isMobile ? 'space-y-2' : 'space-y-2.5'}>
          <div className="flex items-center justify-between">
            <div>
              <h4 className={`${isMobile ? 'text-xs' : 'text-[14px]'} font-bold text-white`}>
                Colleagues &amp; Clients
              </h4>
              <p className={`${isMobile ? 'text-[8.5px]' : 'text-[9.5px]'} text-slate-400`}>
                Direct @handle sharing · Partner CRM
              </p>
            </div>
            <span className="text-[8.5px] font-semibold text-teal-300 shrink-0">12 Active</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg divide-y divide-slate-800">
            {[
              { name: 'Amara Okafor', handle: '@amara', role: 'Operations Lead' },
              { name: 'Cedar County Prep', handle: 'School Partner', role: 'Lagos · Primary Contact' },
              { name: 'Daniel Adeyemi', handle: '@daniel', role: 'Android Systems' },
            ].map((person) => (
              <div key={person.name} className={`${isMobile ? 'p-2' : 'p-2.5'} flex items-center justify-between gap-2`}>
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`${
                      isMobile ? 'w-6 h-6 text-[9px]' : 'w-7 h-7 text-[10px]'
                    } rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-teal-300 shrink-0`}
                  >
                    {person.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className={`${isMobile ? 'text-[9.5px]' : 'text-[10.5px]'} font-semibold text-white truncate`}>
                      {person.name}
                    </p>
                    <p className="text-[8px] text-slate-400 truncate">
                      {person.handle} · {person.role}
                    </p>
                  </div>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-teal-300 text-[8px] font-semibold shrink-0 inline-flex items-center gap-1">
                  <Send className="w-2.5 h-2.5" /> Share
                </span>
              </div>
            ))}
          </div>
        </div>
      );

    case 'knowledge':
      return (
        <div className={isMobile ? 'space-y-2' : 'space-y-2.5'}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className={`${isMobile ? 'text-xs' : 'text-[14px]'} font-bold text-white`}>Knowledge Base</h4>
              <p className={`${isMobile ? 'text-[8.5px]' : 'text-[9.5px]'} text-slate-400`}>
                SOPs, templates &amp; lessons
              </p>
            </div>
            <span className="px-2 py-0.5 rounded bg-teal-400 text-slate-950 text-[8px] font-bold shrink-0">
              Add Entry
            </span>
          </div>
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-1.5' : 'grid-cols-2 gap-2.5'}`}>
            {[
              { title: 'Client Proposal Standard Operating Procedure', category: 'SOP', updated: '2d ago' },
              { title: 'Monthly Studio Budget Template (A4 Format)', category: 'Template', updated: '5d ago' },
              ...(!isMobile
                ? [
                    { title: 'Android Accessibility Pairing Checklist', category: 'SOP', updated: '1w ago' },
                    { title: 'End-of-Week Executive Review Questions', category: 'Lesson', updated: 'Nov 04' },
                  ]
                : []),
            ].map((doc) => (
              <div
                key={doc.title}
                className={`bg-slate-900 border border-slate-800 rounded-lg ${isMobile ? 'p-2 space-y-1' : 'p-2.5 space-y-1.5'}`}
              >
                <div className="flex items-center justify-between text-[8px] text-slate-400">
                  <span className="text-teal-300 font-semibold">{doc.category}</span>
                  <span>{doc.updated}</span>
                </div>
                <p className={`${isMobile ? 'text-[9.5px]' : 'text-[10.5px]'} font-semibold text-white leading-snug`}>
                  {doc.title}
                </p>
              </div>
            ))}
          </div>
        </div>
      );

    case 'followups':
      return (
        <div className={isMobile ? 'space-y-2' : 'space-y-2.5'}>
          <div>
            <h4 className={`${isMobile ? 'text-xs' : 'text-[14px]'} font-bold text-white`}>Follow-ups</h4>
            <p className={`${isMobile ? 'text-[8.5px]' : 'text-[9.5px]'} text-slate-400`}>
              External confirmations &amp; scheduled callbacks
            </p>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { label: 'Overdue', val: 1, tone: 'text-rose-300' },
              { label: 'Today', val: 2, tone: 'text-amber-300' },
              { label: 'Waiting', val: 3, tone: 'text-sky-300' },
              { label: 'Resolved', val: 14, tone: 'text-emerald-300' },
            ].map((metric) => (
              <div key={metric.label} className="bg-slate-900 border border-slate-800 rounded-md p-1.5 text-center">
                <div className={`${isMobile ? 'text-xs' : 'text-sm'} font-extrabold tabular-nums ${metric.tone}`}>
                  {metric.val}
                </div>
                <div className="text-[7.5px] text-slate-400">{metric.label}</div>
              </div>
            ))}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg divide-y divide-slate-800">
            <div className={`${isMobile ? 'p-2' : 'p-2.5'} flex items-center justify-between gap-2`}>
              <div className="min-w-0">
                <p className={`${isMobile ? 'text-[9.5px]' : 'text-[10.5px]'} font-semibold text-white truncate`}>
                  Confirm Cedar County invoice receipt
                </p>
                <p className="text-[8px] text-slate-400">Mrs. Bello · Due today 16:00</p>
              </div>
              <span className="text-[8px] font-bold text-amber-300 shrink-0">Due</span>
            </div>
            <div className={`${isMobile ? 'p-2' : 'p-2.5'} flex items-center justify-between gap-2`}>
              <div className="min-w-0">
                <p className={`${isMobile ? 'text-[9.5px]' : 'text-[10.5px]'} font-semibold text-white truncate`}>
                  Signed NDAs from autumn workshop
                </p>
                <p className="text-[8px] text-slate-400">Partner Desk · Waiting</p>
              </div>
              <span className="text-[8px] font-bold text-sky-300 shrink-0">Waiting</span>
            </div>
          </div>
        </div>
      );

    case 'jess':
      return (
        <div className={isMobile ? 'space-y-2' : 'space-y-2.5'}>
          <div className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-lg p-2">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src="/assets/jess-avatar.png"
                alt="Jess assistant"
                className={`${isMobile ? 'w-7 h-7' : 'w-8 h-8'} rounded-full object-cover border border-teal-400/60 shrink-0`}
              />
              <div className="min-w-0">
                <p className={`${isMobile ? 'text-[10.5px]' : 'text-xs'} font-bold text-white truncate`}>
                  Jess Thought Partner
                </p>
                <p className="text-[8px] text-teal-300 truncate">Voice · Memory · Screen Verification</p>
              </div>
            </div>
            <span
              className={`${
                isMobile ? 'w-6 h-6' : 'w-7 h-7'
              } rounded-full bg-teal-400/15 border border-teal-400/40 text-teal-300 flex items-center justify-center shrink-0`}
            >
              <Mic className="w-3 h-3" />
            </span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[8.5px] text-slate-400">
              <span className="font-semibold text-white flex items-center gap-1">
                <SlidersHorizontal className="w-2.5 h-2.5 text-teal-400" /> Permission Mode
              </span>
              <span className="text-teal-300 font-semibold">Ask First</span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-[7.5px] font-semibold text-center">
              <span className="py-1 rounded bg-teal-400 text-slate-950 font-bold">Ask First</span>
              <span className="py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">Routine</span>
              <span className="py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">Full Control</span>
            </div>
            <div className="pt-1 border-t border-slate-800 space-y-1 text-[8.5px]">
              <div className="flex items-center justify-between text-slate-300">
                <span>Voice Memory &amp; Context</span>
                <span className="text-emerald-300 font-semibold">Enabled</span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span>Windows + Android Bridge</span>
                <span className="text-teal-300 font-semibold">Paired</span>
              </div>
            </div>
          </div>
        </div>
      );
  }
}

export function DesktopWorkspaceMockup({
  activeIndex,
  nextIndex,
  operatorPhase,
  onSelectScreen,
}: {
  activeIndex: number;
  nextIndex: number;
  operatorPhase: OperatorPhase;
  onSelectScreen: (idx: number) => void;
  compact?: boolean;
}) {
  const activeScreen = WORKSPACE_SCREENS[activeIndex];
  const designWidth = 840;
  const designHeight = 492;

  return (
    <ResponsiveScaledFrame designWidth={designWidth} designHeight={designHeight}>
      <div
        className="hm-device-desktop w-[840px] h-[492px] bg-[#020617] border border-white/15 rounded-2xl overflow-hidden shadow-2xl select-none flex flex-col"
        role="region"
        aria-label={`Desktop workspace preview showing ${activeScreen.label}`}
      >
        {/* Window Title Chrome */}
        <div className="h-7 bg-[#0b111c] border-b border-slate-800/90 px-3.5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-700" />
            <span className="w-2 h-2 rounded-full bg-slate-700" />
            <span className="w-2 h-2 rounded-full bg-slate-700" />
            <span className="ml-2 text-[9.5px] font-medium text-slate-400 whitespace-nowrap">
              Hub-Mind Desktop — {activeScreen.label}
            </span>
          </div>
          <span className="text-[9px] font-mono text-slate-500 truncate">{activeScreen.routeLabel}</span>
        </div>

        {/* Desktop App Shell: Sidebar + Header + Content */}
        <div className="flex flex-1 min-h-0">
          {/* Authentic Sidebar matching DesktopSidebar.tsx */}
          <aside className="w-[164px] shrink-0 bg-slate-900/95 border-r border-slate-800 flex flex-col justify-between p-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1.5 py-1.5 border-b border-slate-800/80">
                <img src="/hub-mind%20logo.png" alt="" className="w-4 h-4 rounded object-contain shrink-0" />
                <div className="min-w-0">
                  <span className="block text-[10.5px] font-bold text-white leading-none truncate">
                    Hub-Mind
                  </span>
                  <span className="block text-[8px] text-slate-400 mt-0.5 truncate">Workspace</span>
                </div>
              </div>

              <nav className="space-y-0.5" aria-label="Workspace screen selector">
                {WORKSPACE_SCREENS.map((screen, idx) => {
                  const Icon = screen.icon;
                  const isActive = idx === activeIndex;
                  const isTargeted = operatorPhase !== 'dwell' && idx === nextIndex;
                  const isTapping = operatorPhase === 'tap' && idx === nextIndex;

                  return (
                    <button
                      key={screen.id}
                      type="button"
                      onClick={() => onSelectScreen(idx)}
                      className={`w-full relative flex items-center gap-2 px-2 py-1 rounded-md text-[9.5px] font-medium transition-colors text-left whitespace-nowrap ${
                        isActive
                          ? 'bg-slate-800 text-teal-300 font-semibold border border-teal-500/25'
                          : isTargeted
                          ? 'bg-slate-800/80 text-white border border-teal-400/40'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                      }`}
                    >
                      <Icon className="w-3 h-3 shrink-0" />
                      <span className="truncate">{screen.label}</span>
                      {isTargeted && (
                        <span
                          aria-hidden="true"
                          className={`hm-operator-ring ${isTapping ? 'is-tapping' : ''}`}
                        />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2 px-1.5">
              <div className="w-5 h-5 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-[8.5px] font-bold text-teal-300 shrink-0">
                S
              </div>
              <span className="text-[9px] text-slate-400 truncate">@studiolead</span>
            </div>
          </aside>

          {/* Main Workspace Canvas */}
          <div className="flex-1 min-w-0 flex flex-col bg-[#020617]">
            {/* Desktop Top Header matching Layout.tsx */}
            <div className="h-9 border-b border-slate-800 px-3.5 flex items-center justify-between gap-2 bg-slate-950/60 shrink-0">
              <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-md text-[9px] text-slate-400 w-44">
                <span className="flex items-center gap-1.5 truncate">
                  <Search className="w-3 h-3 shrink-0" />
                  <span className="truncate">Search workspace...</span>
                </span>
                <span className="text-[8px] font-mono text-slate-500">⌘K</span>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="text-[9px] text-slate-400 truncate max-w-[190px]">
                  {activeScreen.desktopAction}
                </span>
                <Bell className="w-3 h-3 text-slate-400" />
                <span className="px-2 py-1 rounded-md bg-teal-400 text-slate-950 text-[9px] font-bold inline-flex items-center gap-1 whitespace-nowrap">
                  <Plus className="w-2.5 h-2.5" /> Quick Capture
                </span>
              </div>
            </div>

            {/* Animated Active Screen Viewport */}
            <div className="flex-1 p-3.5 overflow-hidden">
              <div key={activeScreen.id} className="hm-screen-transition">
                <ScreenInnerContent screenId={activeScreen.id} variant="desktop" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </ResponsiveScaledFrame>
  );
}

export function PhoneWorkspaceMockup({
  activeIndex,
  nextIndex,
  operatorPhase,
  onSelectScreen,
  size = 'md',
}: {
  activeIndex: number;
  nextIndex: number;
  operatorPhase: OperatorPhase;
  onSelectScreen: (idx: number) => void;
  size?: 'sm' | 'md';
}) {
  const activeScreen = WORKSPACE_SCREENS[activeIndex];
  const windowStart = Math.max(0, Math.min(WORKSPACE_SCREENS.length - 5, activeIndex - 2));
  const bottomNavScreens = WORKSPACE_SCREENS.slice(windowStart, windowStart + 5);

  const designWidth = 264;
  const designHeight = 504;
  const maxWidth = size === 'sm' ? 214 : 244;

  return (
    <ResponsiveScaledFrame
      designWidth={designWidth}
      designHeight={designHeight}
      maxWidth={maxWidth}
      center
    >
      <div
        className="hm-device-phone w-[264px] h-[504px] rounded-[30px] p-[8px] bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border border-white/20 shadow-[0_24px_60px_rgba(0,0,0,0.75)] select-none"
        role="region"
        aria-label={`Mobile phone workspace preview showing ${activeScreen.label}`}
      >
        <div className="rounded-[23px] bg-[#020617] border border-slate-800/90 overflow-hidden flex flex-col w-full h-full relative">
          {/* Top Phone Status Bar & Speaker Pill */}
          <div className="h-6 px-3.5 flex items-center justify-between text-[8px] font-semibold text-slate-300 bg-slate-950 shrink-0">
            <span className="tabular-nums">09:41</span>
            <span className="w-12 h-3 rounded-full bg-black border border-slate-800" aria-hidden="true" />
            <span className="text-[7.5px] text-teal-300">5G · Sync</span>
          </div>

          {/* Authentic Mobile App Header matching Layout.tsx md:hidden header */}
          <div className="h-9 px-2.5 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <img src="/hub-mind%20logo.png" alt="" className="w-4 h-4 rounded object-contain shrink-0" />
              <span className="text-[11px] font-bold text-white truncate">Hub-Mind</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400">
                <Search className="w-2.5 h-2.5" />
              </span>
              <span className="p-1 text-slate-400">
                <Bell className="w-3 h-3" />
              </span>
              <span className="w-4 h-4 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-[8px] font-bold text-teal-300">
                S
              </span>
            </div>
          </div>

          {/* Mobile Screen Body */}
          <div className="flex-1 p-2.5 pb-7 overflow-hidden relative">
            <div key={activeScreen.id} className="hm-screen-transition">
              <ScreenInnerContent screenId={activeScreen.id} variant="mobile" />
            </div>

            {/* Mobile Floating Quick Capture Button matching Layout.tsx */}
            <div
              aria-hidden="true"
              className="absolute bottom-2 right-2.5 w-6 h-6 rounded-full bg-teal-400 text-slate-950 flex items-center justify-center shadow-lg shadow-teal-400/25"
            >
              <Plus className="w-3 h-3" />
            </div>
          </div>

          {/* Authentic Mobile Bottom Navigation matching Layout.tsx */}
          <nav
            className="h-10 border-t border-slate-800 bg-slate-950/95 px-1.5 flex items-center justify-around gap-0.5 shrink-0"
            aria-label="Mobile screen tabs"
          >
            {bottomNavScreens.map((screen) => {
              const idx = WORKSPACE_SCREENS.findIndex((s) => s.id === screen.id);
              const Icon = screen.icon;
              const isActive = idx === activeIndex;
              const isTargeted = operatorPhase !== 'dwell' && idx === nextIndex;
              const isTapping = operatorPhase === 'tap' && idx === nextIndex;

              return (
                <button
                  key={screen.id}
                  type="button"
                  onClick={() => onSelectScreen(idx)}
                  className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-1 px-0.5 rounded text-[6.5px] leading-none tracking-tight font-medium transition-colors duration-150 ${
                    isActive
                      ? 'text-teal-300 font-semibold bg-teal-400/10'
                      : isTargeted
                      ? 'text-white bg-slate-900/70'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate max-w-full">{screen.mobileLabel}</span>
                  {isTargeted && (
                    <span
                      aria-hidden="true"
                      className={`hm-operator-ring is-phone ${isTapping ? 'is-tapping' : ''}`}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Home Gesture Bar */}
          <div className="h-2.5 bg-slate-950 flex items-center justify-center shrink-0">
            <span className="w-11 h-0.5 rounded-full bg-slate-700" aria-hidden="true" />
          </div>
        </div>
      </div>
    </ResponsiveScaledFrame>
  );
}

export function HeroDualDeviceShowcase({
  cycle,
  onInspectFullExplorer,
}: {
  cycle: ReturnType<typeof useWorkspaceOperatorCycle>;
  onInspectFullExplorer: () => void;
}) {
  const { activeIndex, nextIndex, operatorPhase, activeScreen, selectScreen } = cycle;

  return (
    <div
      className="hm-dual-hero-stage"
      onMouseEnter={() => cycle.setIsHovered(true)}
      onMouseLeave={() => cycle.setIsHovered(false)}
    >
      <div className="hm-hero-window-glow" />

      <div className="hm-dual-hero-desktop">
        <DesktopWorkspaceMockup
          activeIndex={activeIndex}
          nextIndex={nextIndex}
          operatorPhase={operatorPhase}
          onSelectScreen={selectScreen}
        />
      </div>

      <div className="hm-dual-hero-phone">
        <PhoneWorkspaceMockup
          activeIndex={activeIndex}
          nextIndex={nextIndex}
          operatorPhase={operatorPhase}
          onSelectScreen={selectScreen}
          size="sm"
        />
      </div>

      <div className="hm-hero-sync-bar">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold text-white truncate">
            {activeScreen.label}: {activeScreen.headline}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-slate-400 tabular-nums">
            {activeIndex + 1} / {WORKSPACE_SCREENS.length}
          </span>
          <button
            type="button"
            onClick={onInspectFullExplorer}
            className="text-[10px] font-bold text-teal-300 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
          >
            Explore all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceExplorerSection({
  cycle,
  onOpenWorkspace,
}: {
  cycle: ReturnType<typeof useWorkspaceOperatorCycle>;
  onOpenWorkspace: () => void;
}) {
  const {
    screens,
    activeIndex,
    nextIndex,
    activeScreen,
    operatorPhase,
    isPlaying,
    setIsPlaying,
    setIsHovered,
    selectScreen,
    stepPrev,
    stepNext,
  } = cycle;

  const [mobilePreviewMode, setMobilePreviewMode] = useState<'phone' | 'desktop'>('phone');

  return (
    <section
      id="live-screens"
      className="hm-explorer-section hm-reveal"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="hm-explorer-inner">
        <div className="hm-explorer-header">
          <div className="hm-section-heading">
            <div className="hm-eyebrow">LIVE WORKSPACE SCREENS</div>
            <h2>
              Every screen.<br />
              <span>Desktop and phone in sync.</span>
            </h2>
            <p>
              Step through all ten modules of the real Hub-Mind workspace. Watch the desktop application and Android companion mirror every view automatically, or pick any screen below.
            </p>
          </div>

          <div className="hm-explorer-controls">
            <button
              type="button"
              onClick={stepPrev}
              className="hm-control-btn"
              aria-label="Previous workspace screen"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying((prev) => !prev)}
              className="hm-control-btn px-2.5 gap-1.5"
              aria-label={isPlaying ? 'Pause automatic screen tour' : 'Play automatic screen tour'}
            >
              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span className="text-[11px] font-semibold whitespace-nowrap">
                {isPlaying ? 'Auto-touring' : 'Paused'}
              </span>
            </button>
            <button
              type="button"
              onClick={stepNext}
              className="hm-control-btn"
              aria-label="Next workspace screen"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Interactive 10-Screen Tab Bar */}
        <div
          className="hm-explorer-tabs"
          role="tablist"
          aria-label="Hub-Mind workspace screens"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              stepNext();
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              stepPrev();
            }
          }}
        >
          {screens.map((screen, idx) => {
            const Icon = screen.icon;
            const isActive = idx === activeIndex;
            return (
              <button
                key={screen.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => selectScreen(idx)}
                className={`hm-explorer-tab ${isActive ? 'is-active' : ''}`}
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="whitespace-nowrap">{screen.label}</span>
              </button>
            );
          })}
        </div>

        {/* Mobile Device Focus Switcher (Phone only: one device at a time, defaulting to Phone) */}
        <div className="flex lg:hidden items-center justify-between gap-2 mb-3">
          <span className="text-[11px] text-slate-400">Preview mode</span>
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => setMobilePreviewMode('phone')}
              aria-pressed={mobilePreviewMode === 'phone'}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold inline-flex items-center gap-1 whitespace-nowrap transition-all duration-200 ${
                mobilePreviewMode === 'phone'
                  ? 'bg-teal-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Smartphone className="w-3 h-3" /> Preview Phone
            </button>
            <button
              type="button"
              onClick={() => setMobilePreviewMode('desktop')}
              aria-pressed={mobilePreviewMode === 'desktop'}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold inline-flex items-center gap-1 whitespace-nowrap transition-all duration-200 ${
                mobilePreviewMode === 'desktop'
                  ? 'bg-teal-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Monitor className="w-3 h-3" /> Preview PC
            </button>
          </div>
        </div>

        {/* Dual Desktop + Phone Theater Stage (Both side-by-side on PC; active one at a time on mobile) */}
        <div className="hm-explorer-theater">
          <div
            key={`desktop-${mobilePreviewMode}`}
            className={`${
              mobilePreviewMode === 'desktop' ? 'block hm-device-switch-in' : 'hidden lg:block'
            } min-w-0`}
          >
            <DesktopWorkspaceMockup
              activeIndex={activeIndex}
              nextIndex={nextIndex}
              operatorPhase={operatorPhase}
              onSelectScreen={selectScreen}
            />
          </div>
          <div
            key={`phone-${mobilePreviewMode}`}
            className={`${
              mobilePreviewMode === 'phone' ? 'flex hm-device-switch-in' : 'hidden lg:flex'
            } flex-col items-center`}
          >
            <PhoneWorkspaceMockup
              activeIndex={activeIndex}
              nextIndex={nextIndex}
              operatorPhase={operatorPhase}
              onSelectScreen={selectScreen}
              size="md"
            />
          </div>
        </div>

        {/* Active Screen Details Strip */}
        <div className="hm-explorer-caption">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5 mb-1">
              <span className="text-teal-300 font-semibold tabular-nums">
                {String(activeIndex + 1).padStart(2, '0')} / {WORKSPACE_SCREENS.length}
              </span>
              <span aria-hidden="true">·</span>
              <span>{activeScreen.label}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{activeScreen.routeLabel}</span>
            </div>
            <h3 className="text-sm sm:text-[15px] font-bold text-white tracking-tight">
              {activeScreen.headline}
            </h3>
            <p className="text-[11.5px] sm:text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              {activeScreen.summary}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="hm-explorer-cta whitespace-nowrap shrink-0"
          >
            Open in Workspace <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}
