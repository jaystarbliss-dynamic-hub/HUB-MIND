import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Editor, EditorContent } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { OfficialLetterhead } from './OfficialLetterhead';
import {
  PaperSizeOption,
  OrientationOption,
  MarginOption,
  PaperThemeOption,
  computePageLayout,
  getPageStartInEditorPx,
  getPageEndInEditorPx,
  getPageNumberAtEditorOffsetPx,
  getPageUsableHeightPx,
  ComputedPageLayout,
} from '../../lib/paginationEngine';

export interface PaginationDebugMetrics {
  paperSize: string;
  orientation: string;
  marginOption: string;
  pageWidthPx: number;
  pageHeightPx: number;
  usablePage1HeightPx: number;
  usableSubsequentHeightPx: number;
  measuredContentHeightPx: number;
  computedPageCount: number;
  renderedPageSheets: number;
  activeBreakCount: number;
}

interface PaginatedPageContainerProps {
  editor: Editor | null;
  docTitle?: string;
  paperSize: PaperSizeOption;
  orientation: OrientationOption;
  marginOption: MarginOption;
  paperTheme: PaperThemeOption;
  zoomLevel: number;
  onZoomChange?: (nextZoom: number) => void;
  showPageNumbers?: boolean;
  showPageBreaks?: boolean;
  showRuler?: boolean;
  showMarginGuides?: boolean;
  debugMode?: boolean;
  showDebugInfo?: boolean;
  pageCount?: number;
  activePage?: number;
  onDebugInfoChange?: (info: PaginationDebugMetrics) => void;
  onPageCountChange?: (pageCount: number) => void;
  onActivePageChange?: (activePage: number) => void;
}

interface WidgetSpacerSpec {
  pos: number;
  heightPx: number;
  toPage: number;
}

const HM_PAGINATION_PLUGIN_KEY = new PluginKey<DecorationSet>('hubmindPaginationSpacers');

function createFlowSpacerWidgetDOM(spec: WidgetSpacerSpec): HTMLElement {
  const span = document.createElement('span');
  span.className = 'hm-page-flow-spacer';
  span.setAttribute('data-hm-page-spacer', String(spec.toPage));
  span.setAttribute('data-hm-spacer-height', String(spec.heightPx));
  span.setAttribute('contenteditable', 'false');
  span.setAttribute('aria-hidden', 'true');
  span.style.display = 'block';
  span.style.width = '100%';
  span.style.height = `${spec.heightPx}px`;
  span.style.margin = '0';
  span.style.padding = '0';
  span.style.border = '0';
  span.style.lineHeight = '0';
  span.style.fontSize = '0';
  span.style.pointerEvents = 'none';
  span.style.userSelect = 'none';
  return span;
}

interface WordToken {
  node: Text;
  start: number;
  end: number;
}

function collectBlockWordTokens(blockEl: HTMLElement): WordToken[] {
  if (
    blockEl.tagName.toLowerCase() === 'table' ||
    blockEl.classList.contains('tableWrapper') ||
    blockEl.querySelector('table') !== null
  ) {
    return [];
  }

  const tokens: WordToken[] = [];
  const walker = document.createTreeWalker(
    blockEl,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }
        if (
          parent.classList.contains('hm-page-flow-spacer') ||
          parent.closest('table, thead, tbody, tr, td, th, .tableWrapper, .hm-page-flow-spacer')
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let current: Node | null = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const text = textNode.nodeValue || '';
    const regex = /\S+\s*/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      tokens.push({
        node: textNode,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    current = walker.nextNode();
  }
  return tokens;
}

export function PaginatedPageContainer({
  editor,
  docTitle = 'Official Hub-Mind Document',
  paperSize,
  orientation,
  marginOption,
  paperTheme,
  zoomLevel,
  onZoomChange,
  showPageNumbers = true,
  showPageBreaks: _showPageBreaks = true,
  showRuler = true,
  showMarginGuides = false,
  debugMode = false,
  showDebugInfo = false,
  pageCount: externalPageCount,
  activePage: _externalActivePage,
  onDebugInfoChange,
  onPageCountChange,
  onActivePageChange,
}: PaginatedPageContainerProps) {
  const isDebugActive = debugMode || showDebugInfo;
  const [pageCount, setPageCount] = useState<number>(externalPageCount || 1);
  const [measuredHeightPx, setMeasuredHeightPx] = useState<number>(0);
  const [activeBreakCount, setActiveBreakCount] = useState<number>(0);
  const [mobileFitScale, setMobileFitScale] = useState<number>(1);
  const [isMobileScreen, setIsMobileScreen] = useState<boolean>(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const activeWidgetSpecsRef = useRef<WidgetSpacerSpec[]>([]);
  const isReflowingRef = useRef<boolean>(false);

  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(zoomLevel);

  const deskGapPx = 48;

  const layout: ComputedPageLayout = useMemo(() => {
    return computePageLayout({
      paperSize,
      orientation,
      marginOption,
      deskGapPx,
    });
  }, [paperSize, orientation, marginOption, deskGapPx]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const plugin = new Plugin<DecorationSet>({
      key: HM_PAGINATION_PLUGIN_KEY,
      state: {
        init() {
          return DecorationSet.empty;
        },
        apply(tr, oldSet) {
          const nextSet = tr.getMeta(HM_PAGINATION_PLUGIN_KEY);
          if (nextSet !== undefined) {
            return nextSet;
          }
          if (tr.docChanged) {
            return oldSet.map(tr.mapping, tr.doc);
          }
          return oldSet;
        },
      },
      props: {
        decorations(state) {
          return HM_PAGINATION_PLUGIN_KEY.getState(state) || DecorationSet.empty;
        },
      },
    });

    editor.registerPlugin(plugin);
    return () => {
      try {
        if (!editor.isDestroyed) {
          editor.unregisterPlugin(HM_PAGINATION_PLUGIN_KEY);
        }
      } catch {
        // Ignore
      }
    };
  }, [editor]);

  const updateResponsiveScale = useCallback(() => {
    if (typeof window === 'undefined') return;
    const viewportWidth = window.innerWidth;
    const mobile = viewportWidth < 768;
    setIsMobileScreen(mobile);

    if (mobile && scrollContainerRef.current) {
      const containerWidth = Math.max(260, scrollContainerRef.current.clientWidth - 20);
      const scale = Math.min(1, Math.max(0.32, containerWidth / layout.pageWidthPx));
      setMobileFitScale(Math.round(scale * 1000) / 1000);
    } else {
      setMobileFitScale(1);
    }
  }, [layout.pageWidthPx]);

  useEffect(() => {
    updateResponsiveScale();
    window.addEventListener('resize', updateResponsiveScale);
    window.addEventListener('orientationchange', updateResponsiveScale);
    return () => {
      window.removeEventListener('resize', updateResponsiveScale);
      window.removeEventListener('orientationchange', updateResponsiveScale);
    };
  }, [updateResponsiveScale]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistanceRef.current = Math.hypot(dx, dy);
      pinchStartZoomRef.current = zoomLevel;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchStartDistanceRef.current !== null && onZoomChange) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDistance = Math.hypot(dx, dy);
      const ratio = currentDistance / Math.max(1, pinchStartDistanceRef.current);
      const nextZoom = Math.min(2.0, Math.max(0.5, Math.round(pinchStartZoomRef.current * ratio * 100) / 100));
      onZoomChange(nextZoom);
    }
  };

  const handleTouchEnd = () => {
    pinchStartDistanceRef.current = null;
  };

  const mobileCanvasScale = useMemo(() => {
    return Math.min(1.6, Math.max(0.28, mobileFitScale * zoomLevel));
  }, [mobileFitScale, zoomLevel]);

  const reflowEditorPages = useCallback(() => {
    if (isReflowingRef.current) return;
    const hostEl = editorHostRef.current;
    if (!hostEl || !editor || editor.isDestroyed) return;

    const editorProse = hostEl.querySelector('.tiptap.ProseMirror') as HTMLElement | null;
    if (!editorProse) return;

    isReflowingRef.current = true;

    try {
      const shiftedNodes = editorProse.querySelectorAll<HTMLElement>(
        '[data-hm-paginated-margin], [data-paginated-shift="true"]'
      );
      shiftedNodes.forEach((el) => {
        el.style.marginTop = '';
        el.removeAttribute('data-hm-paginated-margin');
        el.removeAttribute('data-hm-page-start');
        delete el.dataset.paginatedShift;
      });

      const multipageTables = editorProse.querySelectorAll<HTMLElement>('table[data-hm-multipage]');
      multipageTables.forEach((tbl) => {
        tbl.removeAttribute('data-hm-multipage');
      });

      const lockedCells = editorProse.querySelectorAll<HTMLElement>('[data-hm-cell-width]');
      lockedCells.forEach((cell) => {
        cell.style.width = '';
        cell.removeAttribute('data-hm-cell-width');
      });

      const existingSpacers = editorProse.querySelectorAll<HTMLElement>('.hm-page-flow-spacer');
      existingSpacers.forEach((sp) => {
        sp.style.display = 'none';
        sp.style.height = '0px';
      });

      const legacySoftHrs = editorProse.querySelectorAll<HTMLElement>(
        'hr[data-page-break="soft"], hr.soft-page-break'
      );
      legacySoftHrs.forEach((hr) => {
        hr.style.display = 'none';
        hr.style.height = '0px';
        hr.style.margin = '0px';
      });

      const proseRect = editorProse.getBoundingClientRect();
      const fallbackScale = (isMobileScreen ? mobileCanvasScale : zoomLevel) || 1;
      const measuredScale =
        editorProse.offsetWidth > 0 && proseRect.width > 0
          ? proseRect.width / editorProse.offsetWidth
          : fallbackScale;
      const safeScale = measuredScale > 0.05 ? measuredScale : 1;

      const children = Array.from(editorProse.children).filter(
        (child) =>
          !(
            child.getAttribute('data-page-break') === 'soft' ||
            child.classList.contains('soft-page-break')
          )
      ) as HTMLElement[];

      if (children.length === 0) {
        setPageCount(1);
        setMeasuredHeightPx(0);
        setActiveBreakCount(0);
        onPageCountChange?.(1);
        return;
      }

      let currentPage = 1;
      let breaksApplied = 0;
      let forceNextPageStart = false;
      let unappliedWidgetDeltaPx = 0;
      const nextWidgetSpecs: WidgetSpacerSpec[] = [];
      const sharedRange = document.createRange();

      const toEditorY = (viewportY: number): number =>
        (viewportY - proseRect.top) / safeScale + unappliedWidgetDeltaPx;

      const applyExactShiftToEditorTop = (
        el: HTMLElement,
        targetEditorTopPx: number,
        pageNum: number
      ): number => {
        const beforeTop = toEditorY(el.getBoundingClientRect().top);
        const rawDelta = targetEditorTopPx - beforeTop;
        if (rawDelta <= 0.5) return 0;

        let marginPx = Math.round(rawDelta);
        el.style.marginTop = `${marginPx}px`;
        el.setAttribute('data-hm-paginated-margin', String(marginPx));
        el.setAttribute('data-hm-page-start', String(pageNum));
        el.dataset.paginatedShift = 'true';

        const afterTop = toEditorY(el.getBoundingClientRect().top);
        const residual = targetEditorTopPx - afterTop;
        if (Math.abs(residual) >= 1) {
          marginPx = Math.max(0, Math.round(marginPx + residual));
          el.style.marginTop = `${marginPx}px`;
          el.setAttribute('data-hm-paginated-margin', String(marginPx));
        }

        breaksApplied += 1;
        return marginPx;
      };

      const paginateBlockLines = (blockEl: HTMLElement) => {
        const tokens = collectBlockWordTokens(blockEl);
        if (tokens.length < 2) {
          const blockBottom = toEditorY(blockEl.getBoundingClientRect().bottom);
          while (blockBottom > getPageEndInEditorPx(layout, currentPage, deskGapPx)) {
            currentPage += 1;
            breaksApplied += 1;
          }
          return;
        }

        let searchStartIdx = 0;
        let safetyCounter = 0;

        while (searchStartIdx < tokens.length && safetyCounter < 50) {
          safetyCounter += 1;
          const pageEnd = getPageEndInEditorPx(layout, currentPage, deskGapPx);
          const blockBottom = toEditorY(blockEl.getBoundingClientRect().bottom);

          if (blockBottom <= pageEnd + 1) {
            break;
          }

          let low = searchStartIdx;
          let high = tokens.length - 1;
          let overflowIdx = -1;

          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const tok = tokens[mid];
            sharedRange.setStart(tok.node, tok.start);
            sharedRange.setEnd(tok.node, Math.min(tok.end, tok.start + 1));
            const wRect = sharedRange.getBoundingClientRect();
            const wBottom = toEditorY(wRect.bottom);

            if (wBottom > pageEnd) {
              overflowIdx = mid;
              high = mid - 1;
            } else {
              low = mid + 1;
            }
          }

          if (overflowIdx <= searchStartIdx) {
            if (overflowIdx === -1) break;
            currentPage += 1;
            breaksApplied += 1;
            searchStartIdx = overflowIdx + 1;
            continue;
          }

          sharedRange.setStart(tokens[overflowIdx].node, tokens[overflowIdx].start);
          sharedRange.setEnd(
            tokens[overflowIdx].node,
            Math.min(tokens[overflowIdx].end, tokens[overflowIdx].start + 1)
          );
          const overflowLineTop = toEditorY(sharedRange.getBoundingClientRect().top);

          while (overflowIdx > searchStartIdx + 1) {
            const prevTok = tokens[overflowIdx - 1];
            sharedRange.setStart(prevTok.node, prevTok.start);
            sharedRange.setEnd(prevTok.node, Math.min(prevTok.end, prevTok.start + 1));
            const prevTop = toEditorY(sharedRange.getBoundingClientRect().top);
            if (Math.abs(prevTop - overflowLineTop) <= 4) {
              overflowIdx -= 1;
            } else {
              break;
            }
          }

          const breakToken = tokens[overflowIdx];
          sharedRange.setStart(breakToken.node, breakToken.start);
          sharedRange.setEnd(breakToken.node, Math.min(breakToken.end, breakToken.start + 1));
          const lineTopInEditor = toEditorY(sharedRange.getBoundingClientRect().top);

          currentPage += 1;
          const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
          const spacerHeightPx = Math.max(0, Math.round(targetStart - lineTopInEditor));

          if (spacerHeightPx > 0) {
            try {
              const pmPos = editor.view.posAtDOM(breakToken.node, breakToken.start);
              if (typeof pmPos === 'number' && pmPos >= 0) {
                nextWidgetSpecs.push({
                  pos: pmPos,
                  heightPx: spacerHeightPx,
                  toPage: currentPage,
                });
                unappliedWidgetDeltaPx += spacerHeightPx;
                breaksApplied += 1;
              }
            } catch {
              unappliedWidgetDeltaPx += spacerHeightPx;
              breaksApplied += 1;
            }
          }

          searchStartIdx = overflowIdx + 1;
        }
      };

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const nextChild = i + 1 < children.length ? children[i + 1] : null;
        const tag = child.tagName.toLowerCase();

        const isHardBreak =
          tag === 'hr' ||
          child.classList.contains('page-break') ||
          child.classList.contains('hard-page-break') ||
          child.getAttribute('data-page-break') === 'true' ||
          child.getAttribute('data-page-break') === 'hard';

        if (isHardBreak) {
          forceNextPageStart = true;
          if (i === children.length - 1) {
            currentPage += 1;
            breaksApplied += 1;
          }
          continue;
        }

        if (forceNextPageStart) {
          currentPage += 1;
          const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
          applyExactShiftToEditorTop(child, targetStart, currentPage);
          forceNextPageStart = false;
        }

        const childRect = child.getBoundingClientRect();
        const childTop = toEditorY(childRect.top);
        const childBottom = toEditorY(childRect.bottom);
        const childHeight = Math.max(0, childBottom - childTop);

        const pageStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
        const pageEnd = getPageEndInEditorPx(layout, currentPage, deskGapPx);
        const isAtTopOfCurrentPage = childTop <= pageStart + 6;

        if (/^h[1-6]$/.test(tag)) {
          const hasNextContent =
            nextChild &&
            nextChild.tagName.toLowerCase() !== 'hr' &&
            !nextChild.classList.contains('page-break');
          const keepWithNext = hasNextContent ? layout.headingKeepWithNextPx : 0;

          if (!isAtTopOfCurrentPage && childBottom + keepWithNext > pageEnd) {
            currentPage += 1;
            const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
            applyExactShiftToEditorTop(child, targetStart, currentPage);
          }
          continue;
        }

        const isImageBlock =
          tag === 'img' ||
          tag === 'figure' ||
          (child.querySelector('img') !== null && (child.textContent || '').trim().length === 0);

        if (isImageBlock) {
          if (!isAtTopOfCurrentPage && childBottom > pageEnd) {
            currentPage += 1;
            const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
            applyExactShiftToEditorTop(child, targetStart, currentPage);
          }
          const updatedBottom = toEditorY(child.getBoundingClientRect().bottom);
          while (updatedBottom > getPageEndInEditorPx(layout, currentPage, deskGapPx)) {
            currentPage += 1;
          }
          continue;
        }

        if (tag === 'ul' || tag === 'ol') {
          const items = Array.from(child.children).filter(
            (el) => el.tagName.toLowerCase() === 'li'
          ) as HTMLElement[];

          if (items.length > 0) {
            const firstLiRect = items[0].getBoundingClientRect();
            const firstLiBottom = toEditorY(firstLiRect.bottom);
            const firstLiHeight = firstLiRect.height / safeScale;

            if (
              !isAtTopOfCurrentPage &&
              firstLiBottom > pageEnd &&
              (firstLiHeight <= layout.orphanLineBufferPx * 2.5 ||
                pageEnd - childTop < layout.orphanLineBufferPx * 1.5)
            ) {
              currentPage += 1;
              const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
              applyExactShiftToEditorTop(child, targetStart, currentPage);
            }

            for (let k = 0; k < items.length; k++) {
              const li = items[k];
              const liRect = li.getBoundingClientRect();
              const liTop = toEditorY(liRect.top);
              const liBottom = toEditorY(liRect.bottom);
              const liHeight = Math.max(0, liBottom - liTop);
              const curPageStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
              const curPageEnd = getPageEndInEditorPx(layout, currentPage, deskGapPx);
              const liAtPageTop = liTop <= curPageStart + 6;

              if (liBottom > curPageEnd) {
                const remainingOnPage = curPageEnd - liTop;
                const shouldShiftWholeItem =
                  !liAtPageTop &&
                  (remainingOnPage < layout.orphanLineBufferPx * 1.5 ||
                    liHeight <= getPageUsableHeightPx(layout, currentPage + 1) * 0.45);

                if (shouldShiftWholeItem) {
                  currentPage += 1;
                  const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
                  applyExactShiftToEditorTop(li, targetStart, currentPage);
                }

                if (toEditorY(li.getBoundingClientRect().bottom) > getPageEndInEditorPx(layout, currentPage, deskGapPx)) {
                  paginateBlockLines(li);
                }
              }
            }
          }
          continue;
        }

        const tableEl = (
          tag === 'table'
            ? child
            : child.classList.contains('tableWrapper') || child.querySelector('table') !== null
            ? (child.querySelector('table') as HTMLElement | null)
            : null
        );

        if (tableEl) {
          const rows = Array.from(tableEl.querySelectorAll('tr')) as HTMLElement[];
          if (rows.length > 0) {
            const firstRowBottom = toEditorY(rows[0].getBoundingClientRect().bottom);
            const secondRowBottom =
              rows.length > 1 ? toEditorY(rows[1].getBoundingClientRect().bottom) : firstRowBottom;

            if (!isAtTopOfCurrentPage && (firstRowBottom > pageEnd || secondRowBottom > pageEnd)) {
              currentPage += 1;
              const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
              applyExactShiftToEditorTop(child, targetStart, currentPage);
            }

            if (
              toEditorY(child.getBoundingClientRect().bottom) >
              getPageEndInEditorPx(layout, currentPage, deskGapPx)
            ) {
              const allCells = Array.from(tableEl.querySelectorAll('th, td')) as HTMLElement[];
              const measuredCellWidths = allCells.map((cell) =>
                Math.max(40, Math.round(cell.getBoundingClientRect().width / safeScale))
              );
              allCells.forEach((cell, idx) => {
                cell.style.width = `${measuredCellWidths[idx]}px`;
                cell.setAttribute('data-hm-cell-width', 'true');
              });

              tableEl.setAttribute('data-hm-multipage', 'true');

              for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                const rRect = row.getBoundingClientRect();
                const rTop = toEditorY(rRect.top);
                const rBottom = toEditorY(rRect.bottom);
                const curPageStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
                const curPageEnd = getPageEndInEditorPx(layout, currentPage, deskGapPx);

                if (rBottom > curPageEnd) {
                  if (r === 0 && rTop > curPageStart + 6) {
                    currentPage += 1;
                    const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
                    applyExactShiftToEditorTop(child, targetStart, currentPage);
                  } else if (rTop > curPageStart + 6) {
                    currentPage += 1;
                    const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
                    applyExactShiftToEditorTop(row, targetStart, currentPage);
                  } else {
                    while (
                      toEditorY(row.getBoundingClientRect().bottom) >
                      getPageEndInEditorPx(layout, currentPage, deskGapPx)
                    ) {
                      currentPage += 1;
                      breaksApplied += 1;
                    }
                  }
                }
              }
            }
          }
          continue;
        }

        if (childBottom > pageEnd) {
          const remainingOnPage = pageEnd - childTop;
          const isShortBlock = childHeight <= layout.orphanLineBufferPx * 2.5;
          const tooLittleRoomToSplit = remainingOnPage < layout.orphanLineBufferPx * 1.5;

          if (!isAtTopOfCurrentPage && (isShortBlock || tooLittleRoomToSplit)) {
            currentPage += 1;
            const targetStart = getPageStartInEditorPx(layout, currentPage, deskGapPx);
            applyExactShiftToEditorTop(child, targetStart, currentPage);
          }

          const updatedBottom = toEditorY(child.getBoundingClientRect().bottom);
          if (updatedBottom > getPageEndInEditorPx(layout, currentPage, deskGapPx)) {
            paginateBlockLines(child);
          }
        }
      }

      const prevSpecs = activeWidgetSpecsRef.current;
      const specsChanged =
        prevSpecs.length !== nextWidgetSpecs.length ||
        prevSpecs.some(
          (s, idx) =>
            s.pos !== nextWidgetSpecs[idx].pos ||
            Math.abs(s.heightPx - nextWidgetSpecs[idx].heightPx) > 1 ||
            s.toPage !== nextWidgetSpecs[idx].toPage
        );

      if (specsChanged) {
        activeWidgetSpecsRef.current = nextWidgetSpecs;
        const decorations = nextWidgetSpecs.map((spec) =>
          Decoration.widget(spec.pos, () => createFlowSpacerWidgetDOM(spec), {
            side: -1,
            key: `hm-spacer-${spec.pos}-${spec.toPage}-${spec.heightPx}`,
          })
        );
        const decoSet =
          decorations.length > 0
            ? DecorationSet.create(editor.state.doc, decorations)
            : DecorationSet.empty;

        const tr = editor.state.tr
          .setMeta(HM_PAGINATION_PLUGIN_KEY, decoSet)
          .setMeta('addToHistory', false);
        editor.view.dispatch(tr);
      } else if (existingSpacers.length > 0) {
        existingSpacers.forEach((sp, idx) => {
          const spec = nextWidgetSpecs[idx];
          const h = spec ? spec.heightPx : Number(sp.getAttribute('data-hm-spacer-height') || '0');
          if (h > 0) {
            sp.style.display = 'block';
            sp.style.height = `${h}px`;
          }
        });
      }

      const lastChild = children[children.length - 1];
      const finalProseRect = editorProse.getBoundingClientRect();
      const finalLastBottom =
        (lastChild.getBoundingClientRect().bottom - finalProseRect.top) / safeScale;
      const pageFromLastBottom = getPageNumberAtEditorOffsetPx(
        layout,
        Math.max(0, finalLastBottom - 2),
        deskGapPx
      );

      const finalTotalPages = Math.max(1, currentPage, pageFromLastBottom);
      const totalSpanPx = Math.max(0, Math.round(finalLastBottom));

      setMeasuredHeightPx(totalSpanPx);
      setActiveBreakCount(breaksApplied);
      setPageCount(finalTotalPages);
      onPageCountChange?.(finalTotalPages);

      if (onActivePageChange && editor.view) {
        try {
          const selFrom = editor.state.selection.from;
          const coords = editor.view.coordsAtPos(selFrom);
          const cursorYRel = (coords.top - finalProseRect.top) / safeScale;
          const cursorPage = Math.min(
            finalTotalPages,
            Math.max(1, getPageNumberAtEditorOffsetPx(layout, cursorYRel, deskGapPx))
          );
          onActivePageChange(cursorPage);
        } catch {
          // Ignore
        }
      }

      if (onDebugInfoChange) {
        onDebugInfoChange({
          paperSize: layout.paperDef.name,
          orientation,
          marginOption: layout.marginPreset.name,
          pageWidthPx: layout.pageWidthPx,
          pageHeightPx: layout.pageHeightPx,
          usablePage1HeightPx: layout.page1UsableHeightPx,
          usableSubsequentHeightPx: layout.subsequentUsableHeightPx,
          measuredContentHeightPx: totalSpanPx,
          computedPageCount: finalTotalPages,
          renderedPageSheets: finalTotalPages,
          activeBreakCount: breaksApplied,
        });
      }
    } finally {
      isReflowingRef.current = false;
    }
  }, [
    editor,
    layout,
    deskGapPx,
    orientation,
    zoomLevel,
    isMobileScreen,
    mobileCanvasScale,
    onDebugInfoChange,
    onPageCountChange,
    onActivePageChange,
  ]);

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      reflowEditorPages();
    };

    const handleSelectionUpdate = () => {
      if (!onActivePageChange || !editorHostRef.current || !editor.view) return;
      const editorProse = editorHostRef.current.querySelector('.tiptap.ProseMirror') as HTMLElement | null;
      if (!editorProse) return;
      try {
        const proseRect = editorProse.getBoundingClientRect();
        const fallbackScale = (isMobileScreen ? mobileCanvasScale : zoomLevel) || 1;
        const measuredScale =
          editorProse.offsetWidth > 0 && proseRect.width > 0
            ? proseRect.width / editorProse.offsetWidth
            : fallbackScale;
        const safeScale = measuredScale > 0.05 ? measuredScale : 1;
        const coords = editor.view.coordsAtPos(editor.state.selection.from);
        const cursorYRel = (coords.top - proseRect.top) / safeScale;
        const cursorPage = Math.min(
          pageCount,
          Math.max(1, getPageNumberAtEditorOffsetPx(layout, cursorYRel, deskGapPx))
        );
        onActivePageChange(cursorPage);
      } catch {
        // Ignore
      }
    };

    handleUpdate();

    editor.on('update', handleUpdate);
    editor.on('selectionUpdate', handleSelectionUpdate);

    const handleCustomReflow = () => {
      reflowEditorPages();
    };
    window.addEventListener('hubmind:reflow-pagination', handleCustomReflow);

    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => {
        if (!editor.isDestroyed) {
          reflowEditorPages();
        }
      });
    }

    const hostEl = editorHostRef.current;
    const imgs = hostEl ? Array.from(hostEl.querySelectorAll('img')) : [];
    const onImgLoad = () => reflowEditorPages();
    imgs.forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', onImgLoad);
      }
    });

    const timer1 = setTimeout(handleUpdate, 60);
    const timer2 = setTimeout(handleUpdate, 220);

    return () => {
      editor.off('update', handleUpdate);
      editor.off('selectionUpdate', handleSelectionUpdate);
      window.removeEventListener('hubmind:reflow-pagination', handleCustomReflow);
      imgs.forEach((img) => img.removeEventListener('load', onImgLoad));
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [editor, paperSize, orientation, marginOption, reflowEditorPages, onActivePageChange, isMobileScreen, mobileCanvasScale, zoomLevel, pageCount, layout, deskGapPx]);

  useEffect(() => {
    reflowEditorPages();
  }, [layout, zoomLevel, mobileCanvasScale, paperSize, orientation, marginOption, reflowEditorPages]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const containerEl = scrollContainerRef.current;
    if (!containerEl) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        updateResponsiveScale();
        reflowEditorPages();
      });
    });

    observer.observe(containerEl);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [updateResponsiveScale, reflowEditorPages]);

  const pagesArray = useMemo(() => {
    return Array.from({ length: Math.max(1, pageCount) }, (_, idx) => idx + 1);
  }, [pageCount]);

  const totalStackHeightPx = useMemo(() => {
    return pageCount * layout.pageHeightPx + Math.max(0, pageCount - 1) * deskGapPx;
  }, [pageCount, layout.pageHeightPx, deskGapPx]);

  const rulerTicks = useMemo(() => {
    const totalCm = Math.floor(layout.pageWidthMm / 10);
    return Array.from({ length: totalCm + 1 }, (_, i) => i);
  }, [layout.pageWidthMm]);

  const isPaperWhite = paperTheme === 'white';

  return (
    <div
      ref={scrollContainerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="flex-1 overflow-y-auto overflow-x-auto bg-slate-900/95 p-2 sm:p-6 md:p-10 flex flex-col items-center relative select-none print:p-0 print:bg-white print:overflow-visible scrollbar-thin scrollbar-thumb-slate-700"
    >
      {showRuler && (
        <div
          style={{
            width: `${layout.pageWidthPx}px`,
            transform: isMobileScreen ? `scale(${mobileCanvasScale})` : `scale(${zoomLevel})`,
            transformOrigin: 'top center',
          }}
          className="h-6 bg-slate-950/90 border border-slate-800 rounded-t-sm mb-3 hidden sm:flex items-end relative overflow-hidden shrink-0 print:hidden shadow-md"
        >
          <div
            style={{ width: `${layout.marginsPx.left}px` }}
            className="h-full bg-slate-800/70 border-r border-teal-500/40 shrink-0"
            title={`Left Margin: ${layout.marginsMm.left}mm`}
          />
          <div className="flex-1 h-full relative">
            {rulerTicks.map((cm) => {
              const leftPx = (cm * 10 * layout.pageWidthPx) / layout.pageWidthMm - layout.marginsPx.left;
              if (leftPx < 0 || leftPx > layout.contentWidthPx) return null;
              return (
                <div
                  key={cm}
                  style={{ left: `${leftPx}px` }}
                  className="absolute bottom-0 flex flex-col items-center"
                >
                  <span className="text-[8px] font-mono text-slate-400 mb-0.5 select-none">{cm}</span>
                  <div className="w-px h-1.5 bg-slate-600" />
                </div>
              );
            })}
          </div>
          <div
            style={{ width: `${layout.marginsPx.right}px` }}
            className="h-full bg-slate-800/70 border-l border-teal-500/40 shrink-0"
            title={`Right Margin: ${layout.marginsMm.right}mm`}
          />
        </div>
      )}

      {isDebugActive && (
        <div className="mb-4 px-3.5 py-2 rounded-xl bg-slate-950/95 border border-amber-500/40 text-[11px] font-mono text-amber-300 flex flex-wrap items-center gap-x-4 gap-y-1 shadow-lg max-w-4xl z-30 print:hidden">
          <span className="font-bold text-amber-400 uppercase">Pagination Inspector:</span>
          <span>Paper: {layout.paperDef.name} ({orientation})</span>
          <span>Sheet: {layout.pageWidthPx}×{layout.pageHeightPx}px</span>
          <span>Usable P1: {layout.page1UsableHeightPx}px</span>
          <span>Usable P2+: {layout.subsequentUsableHeightPx}px</span>
          <span>Content Span: {measuredHeightPx}px</span>
          <span>Breaks: {activeBreakCount}</span>
          <span className="text-emerald-400 font-bold">Total Sheets: {pageCount}</span>
        </div>
      )}

      <div
        style={{
          width: isMobileScreen
            ? `${Math.round(layout.pageWidthPx * mobileCanvasScale)}px`
            : `${Math.round(layout.pageWidthPx * zoomLevel)}px`,
          minHeight: isMobileScreen
            ? `${Math.round(totalStackHeightPx * mobileCanvasScale + 40)}px`
            : `${Math.round(totalStackHeightPx * zoomLevel + 60)}px`,
        }}
        className="relative flex justify-center transition-all duration-150 print:w-full print:min-h-0"
      >
        <div
          style={{
            width: `${layout.pageWidthPx}px`,
            minHeight: `${totalStackHeightPx}px`,
            transform: isMobileScreen
              ? `scale(${mobileCanvasScale})`
              : `scale(${zoomLevel})`,
            transformOrigin: 'top center',
          }}
          className="relative flex flex-col items-center pb-16 print:pb-0 print:transform-none"
        >
          <div
            aria-hidden="true"
            className="w-full flex flex-col items-center pointer-events-none select-none z-0"
          >
            {pagesArray.map((pageNumber, index) => {
              const isFirstPage = pageNumber === 1;

              return (
                <div
                  key={pageNumber}
                  data-page-sheet={pageNumber}
                  style={{
                    width: `${layout.pageWidthPx}px`,
                    height: `${layout.pageHeightPx}px`,
                    marginBottom: index < pagesArray.length - 1 ? `${deskGapPx}px` : '0px',
                    boxSizing: 'border-box',
                  }}
                  className={`relative transition-colors duration-200 flex flex-col justify-between rounded-[2px] ${
                    isPaperWhite
                      ? 'bg-white text-slate-950 shadow-[0_14px_38px_rgba(0,0,0,0.55)] border border-slate-300 ring-1 ring-black/5'
                      : 'bg-slate-950 text-slate-100 shadow-[0_14px_38px_rgba(0,0,0,0.75)] border border-slate-800 ring-1 ring-white/10'
                  }`}
                >
                  <div
                    style={{
                      height: `${layout.marginsPx.top + (isFirstPage ? layout.page1HeaderHeightPx : layout.subsequentHeaderHeightPx)}px`,
                      paddingTop: `${layout.marginsPx.top}px`,
                      paddingLeft: `${layout.marginsPx.left}px`,
                      paddingRight: `${layout.marginsPx.right}px`,
                    }}
                    className="shrink-0 select-none pointer-events-none flex flex-col justify-start overflow-hidden"
                  >
                    {isFirstPage ? (
                      <OfficialLetterhead theme={paperTheme} className="mb-2" />
                    ) : (
                      <div
                        className={`pb-2.5 border-b flex items-center justify-between text-xs font-mono ${
                          isPaperWhite
                            ? 'border-slate-200 text-slate-500'
                            : 'border-slate-800 text-slate-400'
                        }`}
                      >
                        <span className="truncate max-w-[340px] font-semibold">
                          {docTitle || 'Untitled Document'}
                        </span>
                        <span>Jaystarbliss Dynamic Institute</span>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      marginLeft: `${layout.marginsPx.left}px`,
                      marginRight: `${layout.marginsPx.right}px`,
                    }}
                    className={`flex-1 relative ${
                      showMarginGuides || isDebugActive
                        ? isPaperWhite
                          ? 'border border-dashed border-sky-400/50 bg-sky-50/10'
                          : 'border border-dashed border-teal-500/40 bg-teal-950/10'
                        : ''
                    }`}
                  >
                    {isDebugActive && (
                      <div className="absolute bottom-1 right-2 text-[9px] font-mono text-rose-500/80 bg-rose-500/10 px-1.5 py-0.5 rounded">
                        Page {pageNumber} Boundary ({isFirstPage ? layout.page1UsableHeightPx : layout.subsequentUsableHeightPx}px usable)
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      height: `${layout.marginsPx.bottom}px`,
                      paddingLeft: `${layout.marginsPx.left}px`,
                      paddingRight: `${layout.marginsPx.right}px`,
                    }}
                    className="shrink-0 flex items-center justify-between text-[11px] font-mono select-none"
                  >
                    <div
                      className={`w-full pt-3 border-t flex items-center justify-between ${
                        isPaperWhite
                          ? 'border-slate-200 text-slate-500'
                          : 'border-slate-800 text-slate-500'
                      }`}
                    >
                      <span className="truncate max-w-[260px]">
                        {docTitle || 'Official Hub-Mind Document'}
                      </span>
                      {showPageNumbers && (
                        <span className="font-semibold">
                          Page {pageNumber} of {pageCount}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="absolute -left-20 top-4 hidden xl:flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-950/90 border border-slate-800 text-[11px] font-mono text-slate-400 shadow-md">
                    <span>P.{pageNumber}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            ref={editorHostRef}
            id="hubmind-active-editor-content-host"
            onClick={(e) => {
              if (editor && e.target === e.currentTarget) {
                editor.commands.focus();
              }
            }}
            style={{
              width: `${layout.pageWidthPx}px`,
              minHeight: `${totalStackHeightPx}px`,
              paddingTop: `${layout.marginsPx.top + layout.page1HeaderHeightPx}px`,
              paddingBottom: `${layout.marginsPx.bottom}px`,
              paddingLeft: `${layout.marginsPx.left}px`,
              paddingRight: `${layout.marginsPx.right}px`,
              boxSizing: 'border-box',
            }}
            className={`absolute top-0 left-0 z-10 select-text cursor-text ${
              isPaperWhite ? 'paper-white text-slate-950' : 'paper-dark text-slate-100'
            }`}
          >
            <EditorContent editor={editor} />
          </div>

          <div
            aria-hidden="true"
            className="absolute top-0 left-0 w-full flex flex-col items-center pointer-events-none select-none z-20 print:hidden"
          >
            {pagesArray.map((pageNumber, index) => {
              const isFirstPage = pageNumber === 1;
              return (
                <React.Fragment key={`mask-${pageNumber}`}>
                  <div
                    style={{
                      width: `${layout.pageWidthPx}px`,
                      height: `${layout.pageHeightPx}px`,
                      boxSizing: 'border-box',
                    }}
                    className="relative flex flex-col justify-between"
                  >
                    <div
                      style={{
                        height: `${layout.marginsPx.top + (isFirstPage ? layout.page1HeaderHeightPx : layout.subsequentHeaderHeightPx)}px`,
                        paddingTop: `${layout.marginsPx.top}px`,
                        paddingLeft: `${layout.marginsPx.left}px`,
                        paddingRight: `${layout.marginsPx.right}px`,
                      }}
                      className={`shrink-0 flex flex-col justify-start overflow-hidden rounded-t-[2px] border-t border-x ${
                        isPaperWhite
                          ? 'bg-white text-slate-950 border-slate-300'
                          : 'bg-slate-950 text-slate-100 border-slate-800'
                      }`}
                    >
                      {isFirstPage ? (
                        <OfficialLetterhead theme={paperTheme} className="mb-2" />
                      ) : (
                        <div
                          className={`pb-2.5 border-b flex items-center justify-between text-xs font-mono ${
                            isPaperWhite
                              ? 'border-slate-200 text-slate-500'
                              : 'border-slate-800 text-slate-400'
                          }`}
                        >
                          <span className="truncate max-w-[340px] font-semibold">
                            {docTitle || 'Untitled Document'}
                          </span>
                          <span>Jaystarbliss Dynamic Institute</span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 bg-transparent" />

                    <div
                      style={{
                        height: `${layout.marginsPx.bottom}px`,
                        paddingLeft: `${layout.marginsPx.left}px`,
                        paddingRight: `${layout.marginsPx.right}px`,
                      }}
                      className={`shrink-0 flex items-center justify-between text-[11px] font-mono rounded-b-[2px] border-b border-x ${
                        isPaperWhite
                          ? 'bg-white text-slate-950 border-slate-300'
                          : 'bg-slate-950 text-slate-100 border-slate-800'
                      }`}
                    >
                      <div
                        className={`w-full pt-3 border-t flex items-center justify-between ${
                          isPaperWhite
                            ? 'border-slate-200 text-slate-500'
                            : 'border-slate-800 text-slate-500'
                        }`}
                      >
                        <span className="truncate max-w-[260px]">
                          {docTitle || 'Official Hub-Mind Document'}
                        </span>
                        {showPageNumbers && (
                          <span className="font-semibold">
                            Page {pageNumber} of {pageCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {index < pagesArray.length - 1 && (
                    <div
                      data-page-gap-mask={pageNumber}
                      style={{
                        width: `${layout.pageWidthPx + 8}px`,
                        height: `${deskGapPx}px`,
                      }}
                      className="shrink-0 bg-slate-900"
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
