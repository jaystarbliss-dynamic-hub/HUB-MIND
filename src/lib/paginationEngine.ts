/**
 * Hub-Mind Word-Processor Multi-Page Pagination Engine
 *
 * Single authoritative source of truth for:
 *  - Page dimensions (A4, Letter, Legal; Portrait & Landscape)
 *  - Margin presets (Normal, Narrow, Moderate, Wide, Custom)
 *  - Header/Letterhead & Footer height reservations
 *  - Usable content heights for Page 1 and subsequent pages
 *  - Coordinate-system mapping between the physical page stack and the live TipTap editor host
 *  - Block, list-item, table-row, heading-orphan, image, and intra-paragraph line-boundary pagination
 *  - Clean stripping of transient pagination artifacts from canonical saved/exported HTML & JSON
 */

export type PaperSizeOption = 'a4' | 'letter' | 'legal';
export type OrientationOption = 'portrait' | 'landscape';
export type MarginOption = 'normal' | 'narrow' | 'moderate' | 'wide' | 'custom';
export type PaperThemeOption = 'white' | 'dark';

export interface CustomMarginsPx {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PaperDimensions {
  id: PaperSizeOption;
  name: string;
  widthMm: number;
  heightMm: number;
  widthIn: number;
  heightIn: number;
  widthPx: number;
  heightPx: number;
}

export interface MarginDimensions {
  id?: MarginOption;
  name: string;
  topMm: number;
  rightMm: number;
  bottomMm: number;
  leftMm: number;
  topPx: number;
  rightPx: number;
  bottomPx: number;
  leftPx: number;
}

export const PX_PER_MM = 96 / 25.4;
const PX_TO_MM = 25.4 / 96;

export const PAPER_SIZES: Record<PaperSizeOption, PaperDimensions> = {
  a4: {
    id: 'a4',
    name: 'A4',
    widthMm: 210,
    heightMm: 297,
    widthIn: 8.27,
    heightIn: 11.69,
    widthPx: 794,
    heightPx: 1123,
  },
  letter: {
    id: 'letter',
    name: 'US Letter',
    widthMm: 215.9,
    heightMm: 279.4,
    widthIn: 8.5,
    heightIn: 11,
    widthPx: 816,
    heightPx: 1056,
  },
  legal: {
    id: 'legal',
    name: 'US Legal',
    widthMm: 215.9,
    heightMm: 355.6,
    widthIn: 8.5,
    heightIn: 14,
    widthPx: 816,
    heightPx: 1344,
  },
};

export const MARGIN_PRESETS: Record<Exclude<MarginOption, 'custom'>, MarginDimensions> = {
  normal: {
    id: 'normal',
    name: 'Normal (1 in / 25.4 mm)',
    topMm: 25.4,
    rightMm: 25.4,
    bottomMm: 25.4,
    leftMm: 25.4,
    topPx: 96,
    rightPx: 96,
    bottomPx: 96,
    leftPx: 96,
  },
  narrow: {
    id: 'narrow',
    name: 'Narrow (0.5 in / 12.7 mm)',
    topMm: 12.7,
    rightMm: 12.7,
    bottomMm: 12.7,
    leftMm: 12.7,
    topPx: 48,
    rightPx: 48,
    bottomPx: 48,
    leftPx: 48,
  },
  moderate: {
    id: 'moderate',
    name: 'Moderate (1 in TB, 0.75 in LR)',
    topMm: 25.4,
    rightMm: 19.05,
    bottomMm: 25.4,
    leftMm: 19.05,
    topPx: 96,
    rightPx: 72,
    bottomPx: 96,
    leftPx: 72,
  },
  wide: {
    id: 'wide',
    name: 'Wide (1 in TB, 1.5 in LR)',
    topMm: 25.4,
    rightMm: 38.1,
    bottomMm: 25.4,
    leftMm: 38.1,
    topPx: 96,
    rightPx: 144,
    bottomPx: 96,
    leftPx: 144,
  },
};

export const DEFAULT_DESK_GAP_PX = 48;
export const PAGE_1_HEADER_HEIGHT_PX = 138;
export const SUBSEQUENT_HEADER_HEIGHT_PX = 64;
export const BOTTOM_MARGIN_SAFETY_PX = 20;
export const ORPHAN_LINE_BUFFER_PX = 24;
export const HEADING_KEEP_WITH_NEXT_PX = 48;

export interface PageLayoutConfig {
  paperSize: PaperSizeOption;
  orientation: OrientationOption;
  marginOption: MarginOption;
  customMarginsPx?: CustomMarginsPx;
  deskGapPx?: number;
}

export interface ComputedPageLayout {
  paperSize: PaperSizeOption;
  orientation: OrientationOption;
  marginOption: MarginOption;
  pageWidthPx: number;
  pageHeightPx: number;
  pageWidthMm: number;
  pageHeightMm: number;
  marginsPx: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  marginsMm: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    topMm: number;
    rightMm: number;
    bottomMm: number;
    leftMm: number;
  };
  deskGapPx: number;
  contentWidthPx: number;
  page1HeaderHeightPx: number;
  subsequentHeaderHeightPx: number;
  bottomMarginSafetyPx: number;
  orphanLineBufferPx: number;
  headingKeepWithNextPx: number;
  page1UsableHeightPx: number;
  subsequentUsableHeightPx: number;
  interPageGapPx: number;
  paperDef: PaperDimensions;
  marginPreset: MarginDimensions;
}

/**
 * Computes exact pixel and millimeter geometry for the given paper size, orientation, and margins.
 */
export function computePageLayout(config: PageLayoutConfig): ComputedPageLayout {
  const paperDef = PAPER_SIZES[config.paperSize] || PAPER_SIZES.a4;
  const isLandscape = config.orientation === 'landscape';
  const deskGapPx = typeof config.deskGapPx === 'number' ? config.deskGapPx : DEFAULT_DESK_GAP_PX;

  let marginPreset: MarginDimensions;
  if (config.marginOption === 'custom' && config.customMarginsPx) {
    const topPx = Math.max(24, Math.round(config.customMarginsPx.top));
    const rightPx = Math.max(24, Math.round(config.customMarginsPx.right));
    const bottomPx = Math.max(24, Math.round(config.customMarginsPx.bottom));
    const leftPx = Math.max(24, Math.round(config.customMarginsPx.left));
    marginPreset = {
      id: 'custom',
      name: 'Custom Margins',
      topPx,
      rightPx,
      bottomPx,
      leftPx,
      topMm: Number((topPx * PX_TO_MM).toFixed(2)),
      rightMm: Number((rightPx * PX_TO_MM).toFixed(2)),
      bottomMm: Number((bottomPx * PX_TO_MM).toFixed(2)),
      leftMm: Number((leftPx * PX_TO_MM).toFixed(2)),
    };
  } else {
    const presetKey = config.marginOption === 'custom' ? 'normal' : config.marginOption;
    marginPreset = MARGIN_PRESETS[presetKey] || MARGIN_PRESETS.normal;
  }

  const pageWidthPx = isLandscape ? paperDef.heightPx : paperDef.widthPx;
  const pageHeightPx = isLandscape ? paperDef.widthPx : paperDef.heightPx;
  const pageWidthMm = isLandscape ? paperDef.heightMm : paperDef.widthMm;
  const pageHeightMm = isLandscape ? paperDef.widthMm : paperDef.heightMm;

  const contentWidthPx = Math.max(
    240,
    pageWidthPx - marginPreset.leftPx - marginPreset.rightPx
  );

  const page1HeaderHeightPx = PAGE_1_HEADER_HEIGHT_PX;
  const subsequentHeaderHeightPx = SUBSEQUENT_HEADER_HEIGHT_PX;
  const bottomMarginSafetyPx = BOTTOM_MARGIN_SAFETY_PX;
  const orphanLineBufferPx = ORPHAN_LINE_BUFFER_PX;
  const headingKeepWithNextPx = HEADING_KEEP_WITH_NEXT_PX;

  const page1UsableHeightPx = Math.max(
    180,
    pageHeightPx -
      marginPreset.topPx -
      marginPreset.bottomPx -
      page1HeaderHeightPx -
      bottomMarginSafetyPx
  );

  const subsequentUsableHeightPx = Math.max(
    220,
    pageHeightPx -
      marginPreset.topPx -
      marginPreset.bottomPx -
      subsequentHeaderHeightPx -
      bottomMarginSafetyPx
  );

  const interPageGapPx =
    bottomMarginSafetyPx +
    marginPreset.bottomPx +
    deskGapPx +
    marginPreset.topPx +
    subsequentHeaderHeightPx;

  return {
    paperSize: config.paperSize,
    orientation: config.orientation,
    marginOption: config.marginOption,
    pageWidthPx,
    pageHeightPx,
    pageWidthMm,
    pageHeightMm,
    marginsPx: {
      top: marginPreset.topPx,
      right: marginPreset.rightPx,
      bottom: marginPreset.bottomPx,
      left: marginPreset.leftPx,
    },
    marginsMm: {
      top: marginPreset.topMm,
      right: marginPreset.rightMm,
      bottom: marginPreset.bottomMm,
      left: marginPreset.leftMm,
      topMm: marginPreset.topMm,
      rightMm: marginPreset.rightMm,
      bottomMm: marginPreset.bottomMm,
      leftMm: marginPreset.leftMm,
    },
    deskGapPx,
    contentWidthPx,
    page1HeaderHeightPx,
    subsequentHeaderHeightPx,
    bottomMarginSafetyPx,
    orphanLineBufferPx,
    headingKeepWithNextPx,
    page1UsableHeightPx,
    subsequentUsableHeightPx,
    interPageGapPx,
    paperDef,
    marginPreset,
  };
}

export function getPageUsableHeightPx(layout: ComputedPageLayout, pageNumber: number): number {
  return pageNumber <= 1 ? layout.page1UsableHeightPx : layout.subsequentUsableHeightPx;
}

export function getPageSheetTopPx(
  layout: ComputedPageLayout,
  pageNumber: number,
  deskGapPx: number = layout.deskGapPx
): number {
  const safePage = Math.max(1, Math.floor(pageNumber));
  return (safePage - 1) * (layout.pageHeightPx + deskGapPx);
}

export function getPagePrintableTopPx(
  layout: ComputedPageLayout,
  pageNumber: number,
  deskGapPx: number = layout.deskGapPx
): number {
  const safePage = Math.max(1, Math.floor(pageNumber));
  const sheetTop = getPageSheetTopPx(layout, safePage, deskGapPx);
  const headerHeight = safePage === 1 ? layout.page1HeaderHeightPx : layout.subsequentHeaderHeightPx;
  return sheetTop + layout.marginsPx.top + headerHeight;
}

export function getPagePrintableBottomPx(
  layout: ComputedPageLayout,
  pageNumber: number,
  deskGapPx: number = layout.deskGapPx
): number {
  return getPagePrintableTopPx(layout, pageNumber, deskGapPx) + getPageUsableHeightPx(layout, pageNumber);
}

export function getPageStartInEditorPx(
  layout: ComputedPageLayout,
  pageNumber: number,
  deskGapPx: number = layout.deskGapPx
): number {
  const safePage = Math.max(1, Math.floor(pageNumber));
  if (safePage === 1) return 0;
  return (
    getPagePrintableTopPx(layout, safePage, deskGapPx) -
    getPagePrintableTopPx(layout, 1, deskGapPx)
  );
}

export function getPageEndInEditorPx(
  layout: ComputedPageLayout,
  pageNumber: number,
  deskGapPx: number = layout.deskGapPx
): number {
  return getPageStartInEditorPx(layout, pageNumber, deskGapPx) + getPageUsableHeightPx(layout, pageNumber);
}

export function getPageNumberAtEditorOffsetPx(
  layout: ComputedPageLayout,
  offsetFromEditorTopPx: number,
  deskGapPx: number = layout.deskGapPx
): number {
  if (!Number.isFinite(offsetFromEditorTopPx) || offsetFromEditorTopPx <= 0) {
    return 1;
  }
  const page1End = getPageEndInEditorPx(layout, 1, deskGapPx);
  if (offsetFromEditorTopPx <= page1End) {
    return 1;
  }
  const stride = layout.pageHeightPx + deskGapPx;
  const page2Start = getPageStartInEditorPx(layout, 2, deskGapPx);
  if (offsetFromEditorTopPx < page2Start) {
    return 1;
  }
  return 2 + Math.floor((offsetFromEditorTopPx - page2Start) / stride);
}

export function stripTransientPaginationArtifacts(html: string): string {
  if (!html || typeof html !== 'string') return '';

  return html
    .replace(/<hr\b[^>]*\bdata-page-break\s*=\s*["']soft["'][^>]*\/?>/gi, '')
    .replace(/<hr\b[^>]*\bclass\s*=\s*["'][^"']*\bsoft-page-break\b[^"']*["'][^>]*\/?>/gi, '')
    .replace(/<span\b[^>]*\bdata-hm-page-spacer\b[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<span\b[^>]*\bclass\s*=\s*["'][^"']*\bhm-page-flow-spacer\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/\s+data-paginated-shift="[^"]*"/gi, '')
    .replace(/\s+data-hm-paginated-margin="[^"]*"/gi, '')
    .replace(/\s+data-hm-page-start="[^"]*"/gi, '')
    .replace(/\s+data-hm-multipage="[^"]*"/gi, '')
    .replace(/\s+data-hm-cell-width="[^"]*"/gi, '');
}

export function stripSoftPageBreaksFromJson<T>(jsonNode: T): T {
  if (!jsonNode || typeof jsonNode !== 'object') return jsonNode;
  if (Array.isArray(jsonNode)) {
    return jsonNode
      .filter((child) => {
        if (
          child &&
          typeof child === 'object' &&
          (child.type === 'horizontalRule' || child.type === 'pageBreak') &&
          (child.attrs?.['data-page-break'] === 'soft' ||
            child.attrs?.breakType === 'soft' ||
            (typeof child.attrs?.class === 'string' && child.attrs.class.includes('soft-page-break')))
        ) {
          return false;
        }
        return true;
      })
      .map((child) => stripSoftPageBreaksFromJson(child)) as unknown as T;
  }

  const clone: Record<string, any> = { ...(jsonNode as Record<string, any>) };
  if (Array.isArray(clone.content)) {
    clone.content = stripSoftPageBreaksFromJson(clone.content);
  }
  return clone as T;
}

export interface FlowLineInput {
  id?: string;
  heightPx: number;
  offsetPx?: number;
}

export interface FlowSubItemInput {
  id?: string;
  heightPx: number;
  lines?: FlowLineInput[];
}

export interface FlowBlockInput {
  id: string;
  kind: 'paragraph' | 'heading' | 'list' | 'table' | 'image' | 'hard-break' | 'blockquote' | 'other';
  heightPx: number;
  marginBottomPx?: number;
  lines?: FlowLineInput[];
  subItems?: FlowSubItemInput[];
}

export interface PlannedLineBreak {
  blockId: string;
  subItemIndex?: number;
  lineIndex: number;
  fromPage: number;
  toPage: number;
  spacerHeightPx: number;
  targetEditorTopPx: number;
}

export interface PlannedSubItemShift {
  blockId: string;
  subItemIndex: number;
  fromPage: number;
  toPage: number;
  shiftPx: number;
  targetEditorTopPx: number;
}

export interface PlannedBlockPlacement {
  blockId: string;
  kind: FlowBlockInput['kind'];
  startPage: number;
  endPage: number;
  startEditorTopPx: number;
  endEditorBottomPx: number;
  blockShiftPx: number;
  subItemShifts: PlannedSubItemShift[];
  lineBreaks: PlannedLineBreak[];
}

export interface PlannedPageFlowResult {
  totalPages: number;
  placements: PlannedBlockPlacement[];
  blockShifts: Record<string, number>;
  subItemShifts: PlannedSubItemShift[];
  lineBreaks: PlannedLineBreak[];
}

export function planPageFlowBlocks(
  blocks: FlowBlockInput[],
  layout: ComputedPageLayout
): PlannedPageFlowResult {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      totalPages: 1,
      placements: [],
      blockShifts: {},
      subItemShifts: [],
      lineBreaks: [],
    };
  }

  let currentPage = 1;
  let cursorY = 0;
  const placements: PlannedBlockPlacement[] = [];
  const blockShifts: Record<string, number> = {};
  const allSubItemShifts: PlannedSubItemShift[] = [];
  const allLineBreaks: PlannedLineBreak[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const nextBlock = i + 1 < blocks.length ? blocks[i + 1] : null;
    const marginBottom = Math.max(0, block.marginBottomPx ?? 12);
    const pageStart = getPageStartInEditorPx(layout, currentPage);
    const pageEnd = getPageEndInEditorPx(layout, currentPage);
    const isAtPageTop = Math.abs(cursorY - pageStart) <= 2;

    if (block.kind === 'hard-break') {
      const startPage = currentPage;
      const startY = cursorY;
      currentPage += 1;
      const nextPageStart = getPageStartInEditorPx(layout, currentPage);
      cursorY = nextPageStart;
      placements.push({
        blockId: block.id,
        kind: block.kind,
        startPage,
        endPage: currentPage,
        startEditorTopPx: startY,
        endEditorBottomPx: startY,
        blockShiftPx: 0,
        subItemShifts: [],
        lineBreaks: [],
      });
      continue;
    }

    let blockShiftPx = 0;

    if (block.kind === 'heading' && !isAtPageTop) {
      const nextPreviewHeight =
        nextBlock && nextBlock.kind !== 'hard-break'
          ? Math.min(Math.max(28, nextBlock.heightPx || 40), layout.headingKeepWithNextPx)
          : 0;
      if (cursorY + block.heightPx + nextPreviewHeight > pageEnd) {
        currentPage += 1;
        const targetTop = getPageStartInEditorPx(layout, currentPage);
        blockShiftPx = Math.max(0, targetTop - cursorY);
        cursorY = targetTop;
      }
    }

    if (block.kind === 'image' && !isAtPageTop) {
      if (cursorY + block.heightPx > getPageEndInEditorPx(layout, currentPage)) {
        currentPage += 1;
        const targetTop = getPageStartInEditorPx(layout, currentPage);
        blockShiftPx = Math.max(0, targetTop - cursorY);
        cursorY = targetTop;
      }
    }

    if ((block.kind === 'list' || block.kind === 'table') && Array.isArray(block.subItems) && block.subItems.length > 0) {
      const firstSubHeight = Math.max(24, block.subItems[0].heightPx);
      const minRequiredForStart =
        block.kind === 'table' && block.subItems.length > 1
          ? firstSubHeight + Math.min(48, block.subItems[1].heightPx)
          : firstSubHeight;

      if (
        cursorY > getPageStartInEditorPx(layout, currentPage) + 2 &&
        cursorY + minRequiredForStart > getPageEndInEditorPx(layout, currentPage)
      ) {
        currentPage += 1;
        const targetTop = getPageStartInEditorPx(layout, currentPage);
        blockShiftPx = Math.max(0, targetTop - cursorY);
        cursorY = targetTop;
      }

      const startPage = currentPage;
      const blockStartTop = cursorY;
      const subItemShifts: PlannedSubItemShift[] = [];
      const lineBreaks: PlannedLineBreak[] = [];

      for (let s = 0; s < block.subItems.length; s++) {
        const sub = block.subItems[s];
        const curPageEnd = getPageEndInEditorPx(layout, currentPage);
        const curPageStart = getPageStartInEditorPx(layout, currentPage);

        if (Array.isArray(sub.lines) && sub.lines.length > 1 && cursorY + sub.heightPx > curPageEnd) {
          const firstLineH = Math.max(20, sub.lines[0].heightPx);
          if (cursorY > curPageStart + 2 && cursorY + firstLineH > curPageEnd) {
            const fromPage = currentPage;
            currentPage += 1;
            const targetTop = getPageStartInEditorPx(layout, currentPage);
            const shiftPx = Math.max(0, targetTop - cursorY);
            subItemShifts.push({
              blockId: block.id,
              subItemIndex: s,
              fromPage,
              toPage: currentPage,
              shiftPx,
              targetEditorTopPx: targetTop,
            });
            allSubItemShifts.push(subItemShifts[subItemShifts.length - 1]);
            cursorY = targetTop;
          }

          for (let l = 0; l < sub.lines.length; l++) {
            const lineH = Math.max(18, sub.lines[l].heightPx);
            const lineLimit = getPageEndInEditorPx(layout, currentPage);
            if (cursorY + lineH > lineLimit && cursorY > getPageStartInEditorPx(layout, currentPage) + 2) {
              const fromPage = currentPage;
              currentPage += 1;
              const targetTop = getPageStartInEditorPx(layout, currentPage);
              const spacerHeightPx = Math.max(0, targetTop - cursorY);
              const lb: PlannedLineBreak = {
                blockId: block.id,
                subItemIndex: s,
                lineIndex: l,
                fromPage,
                toPage: currentPage,
                spacerHeightPx,
                targetEditorTopPx: targetTop,
              };
              lineBreaks.push(lb);
              allLineBreaks.push(lb);
              cursorY = targetTop;
            }
            cursorY += lineH;
          }
        } else {
          if (cursorY + sub.heightPx > curPageEnd && cursorY > curPageStart + 2) {
            const fromPage = currentPage;
            currentPage += 1;
            const targetTop = getPageStartInEditorPx(layout, currentPage);
            const shiftPx = Math.max(0, targetTop - cursorY);
            const subShift: PlannedSubItemShift = {
              blockId: block.id,
              subItemIndex: s,
              fromPage,
              toPage: currentPage,
              shiftPx,
              targetEditorTopPx: targetTop,
            };
            subItemShifts.push(subShift);
            allSubItemShifts.push(subShift);
            cursorY = targetTop;
          }
          cursorY += sub.heightPx;
        }
      }

      if (blockShiftPx > 0) {
        blockShifts[block.id] = blockShiftPx;
      }

      placements.push({
        blockId: block.id,
        kind: block.kind,
        startPage,
        endPage: currentPage,
        startEditorTopPx: blockStartTop,
        endEditorBottomPx: cursorY,
        blockShiftPx,
        subItemShifts,
        lineBreaks,
      });

      cursorY += marginBottom;
      continue;
    }

    const lines =
      Array.isArray(block.lines) && block.lines.length > 0
        ? block.lines
        : block.heightPx > getPageUsableHeightPx(layout, currentPage)
        ? Array.from(
            { length: Math.max(1, Math.ceil(block.heightPx / 24)) },
            (_, idx) => ({
              id: `${block.id}-line-${idx}`,
              heightPx: idx === Math.ceil(block.heightPx / 24) - 1
                ? block.heightPx - idx * 24
                : 24,
            })
          )
        : null;

    if (lines && lines.length > 1) {
      const curPageEnd = getPageEndInEditorPx(layout, currentPage);
      const curPageStart = getPageStartInEditorPx(layout, currentPage);
      const firstLineH = Math.max(18, lines[0].heightPx);
      const minLinesToStartHeight =
        lines.length >= 2
          ? firstLineH + Math.max(18, lines[1].heightPx)
          : firstLineH;

      if (
        cursorY > curPageStart + 2 &&
        cursorY + block.heightPx > curPageEnd &&
        cursorY + minLinesToStartHeight > curPageEnd
      ) {
        currentPage += 1;
        const targetTop = getPageStartInEditorPx(layout, currentPage);
        blockShiftPx = Math.max(0, targetTop - cursorY);
        cursorY = targetTop;
      }

      const startPage = currentPage;
      const blockStartTop = cursorY;
      const lineBreaks: PlannedLineBreak[] = [];

      for (let l = 0; l < lines.length; l++) {
        const lineH = Math.max(18, lines[l].heightPx);
        const limitY = getPageEndInEditorPx(layout, currentPage);
        if (cursorY + lineH > limitY && cursorY > getPageStartInEditorPx(layout, currentPage) + 2) {
          const fromPage = currentPage;
          currentPage += 1;
          const targetTop = getPageStartInEditorPx(layout, currentPage);
          const spacerHeightPx = Math.max(0, targetTop - cursorY);
          const lb: PlannedLineBreak = {
            blockId: block.id,
            lineIndex: l,
            fromPage,
            toPage: currentPage,
            spacerHeightPx,
            targetEditorTopPx: targetTop,
          };
          lineBreaks.push(lb);
          allLineBreaks.push(lb);
          cursorY = targetTop;
        }
        cursorY += lineH;
      }

      if (blockShiftPx > 0) {
        blockShifts[block.id] = blockShiftPx;
      }

      placements.push({
        blockId: block.id,
        kind: block.kind,
        startPage,
        endPage: currentPage,
        startEditorTopPx: blockStartTop,
        endEditorBottomPx: cursorY,
        blockShiftPx,
        subItemShifts: [],
        lineBreaks,
      });

      cursorY += marginBottom;
      continue;
    }

    const curPageEnd = getPageEndInEditorPx(layout, currentPage);
    const curPageStart = getPageStartInEditorPx(layout, currentPage);
    if (cursorY + block.heightPx > curPageEnd && cursorY > curPageStart + 2) {
      currentPage += 1;
      const targetTop = getPageStartInEditorPx(layout, currentPage);
      blockShiftPx = Math.max(0, targetTop - cursorY);
      cursorY = targetTop;
    }

    const startPage = currentPage;
    const blockStartTop = cursorY;
    cursorY += block.heightPx;

    while (cursorY > getPageEndInEditorPx(layout, currentPage)) {
      currentPage += 1;
    }

    if (blockShiftPx > 0) {
      blockShifts[block.id] = blockShiftPx;
    }

    placements.push({
      blockId: block.id,
      kind: block.kind,
      startPage,
      endPage: currentPage,
      startEditorTopPx: blockStartTop,
      endEditorBottomPx: cursorY,
      blockShiftPx,
      subItemShifts: [],
      lineBreaks: [],
    });

    cursorY += marginBottom;
  }

  return {
    totalPages: Math.max(1, currentPage),
    placements,
    blockShifts,
    subItemShifts: allSubItemShifts,
    lineBreaks: allLineBreaks,
  };
}

function isHardBreakElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  const pageBreakAttr = el.getAttribute('data-page-break');
  if (pageBreakAttr === 'soft' || el.classList.contains('soft-page-break')) {
    return false;
  }
  return (
    tag === 'hr' ||
    el.classList.contains('page-break') ||
    el.classList.contains('hard-page-break') ||
    pageBreakAttr === 'true' ||
    pageBreakAttr === 'hard' ||
    el.style.pageBreakAfter === 'always' ||
    el.style.breakAfter === 'page'
  );
}

function isSoftBreakElement(el: HTMLElement): boolean {
  return (
    el.getAttribute('data-page-break') === 'soft' ||
    el.classList.contains('soft-page-break') ||
    el.classList.contains('hm-page-flow-spacer') ||
    el.hasAttribute('data-hm-page-spacer')
  );
}

function getOuterElementHeight(el: HTMLElement): number {
  if (typeof window === 'undefined') return 28;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const marginTop = parseFloat(style.marginTop || '0') || 0;
  const marginBottom = parseFloat(style.marginBottom || '0') || 0;
  return rect.height + marginTop + marginBottom;
}

interface TextTokenSegment {
  node: Text;
  start: number;
  end: number;
}

function collectTextTokens(root: HTMLElement): TextTokenSegment[] {
  const tokens: TextTokenSegment[] = [];
  if (typeof document === 'undefined') return tokens;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let current: Node | null = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const value = textNode.nodeValue || '';
    const regex = /\S+\s*/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value)) !== null) {
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

function splitRichBlockByWordHeight(
  el: HTMLElement,
  availableHeightPx: number,
  measureSandbox: HTMLElement
): [HTMLElement, HTMLElement] | null {
  if (typeof document === 'undefined' || availableHeightPx < 26) {
    return null;
  }

  const probe = el.cloneNode(true) as HTMLElement;
  measureSandbox.innerHTML = '';
  measureSandbox.appendChild(probe);

  const tokens = collectTextTokens(probe);
  if (tokens.length < 2) {
    return null;
  }

  const probeTop = probe.getBoundingClientRect().top;
  const probeStyle = window.getComputedStyle(probe);
  const marginBottom = parseFloat(probeStyle.marginBottom || '0') || 0;
  const range = document.createRange();

  let low = 0;
  let high = tokens.length - 1;
  let firstOverflowIdx = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const tok = tokens[mid];
    range.setStart(tok.node, tok.start);
    range.setEnd(tok.node, Math.min(tok.end, tok.start + 1));
    const rect = range.getBoundingClientRect();
    const bottomRel = rect.bottom - probeTop + marginBottom;

    if (bottomRel > availableHeightPx) {
      firstOverflowIdx = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  if (firstOverflowIdx <= 0) {
    return null;
  }

  range.setStart(tokens[firstOverflowIdx].node, tokens[firstOverflowIdx].start);
  range.setEnd(
    tokens[firstOverflowIdx].node,
    Math.min(tokens[firstOverflowIdx].end, tokens[firstOverflowIdx].start + 1)
  );
  const overflowLineTop = range.getBoundingClientRect().top;

  while (firstOverflowIdx > 1) {
    const prev = tokens[firstOverflowIdx - 1];
    range.setStart(prev.node, prev.start);
    range.setEnd(prev.node, Math.min(prev.end, prev.start + 1));
    const prevRect = range.getBoundingClientRect();
    if (Math.abs(prevRect.top - overflowLineTop) <= 4) {
      firstOverflowIdx -= 1;
    } else {
      break;
    }
  }

  if (firstOverflowIdx <= 0) {
    return null;
  }

  const splitToken = tokens[firstOverflowIdx];

  const headRange = document.createRange();
  headRange.setStartBefore(probe.firstChild || probe);
  headRange.setEnd(splitToken.node, splitToken.start);
  const headContents = headRange.cloneContents();

  const tailRange = document.createRange();
  tailRange.setStart(splitToken.node, splitToken.start);
  tailRange.setEndAfter(probe.lastChild || probe);
  const tailContents = tailRange.cloneContents();

  const part1 = el.cloneNode(false) as HTMLElement;
  part1.appendChild(headContents);

  const part2 = el.cloneNode(false) as HTMLElement;
  part2.appendChild(tailContents);

  if (!(part1.textContent || '').trim() || !(part2.textContent || '').trim()) {
    return null;
  }

  return [part1, part2];
}

function splitListAcrossBoundary(
  listEl: HTMLElement,
  availableHeightPx: number,
  measureSandbox: HTMLElement
): [HTMLElement, HTMLElement] | null {
  const items = Array.from(listEl.children).filter(
    (c) => c.tagName.toLowerCase() === 'li'
  ) as HTMLElement[];

  if (items.length === 0 || availableHeightPx < 28) {
    return null;
  }

  if (items.length === 1) {
    const splitSingleItem = splitRichBlockByWordHeight(
      items[0],
      availableHeightPx,
      measureSandbox
    );
    if (!splitSingleItem) return null;

    const list1 = listEl.cloneNode(false) as HTMLElement;
    const list2 = listEl.cloneNode(false) as HTMLElement;
    list1.appendChild(splitSingleItem[0]);
    list2.appendChild(splitSingleItem[1]);
    return [list1, list2];
  }

  const list1 = listEl.cloneNode(false) as HTMLElement;
  const list2 = listEl.cloneNode(false) as HTMLElement;
  measureSandbox.innerHTML = '';
  measureSandbox.appendChild(list1);

  let fittingCount = 0;
  for (let i = 0; i < items.length; i++) {
    const itemClone = items[i].cloneNode(true) as HTMLElement;
    list1.appendChild(itemClone);

    if (getOuterElementHeight(list1) > availableHeightPx) {
      list1.removeChild(itemClone);
      break;
    }
    fittingCount = i + 1;
  }

  if (fittingCount === 0) {
    const splitFirst = splitRichBlockByWordHeight(
      items[0],
      availableHeightPx,
      measureSandbox
    );
    if (!splitFirst) return null;
    list1.appendChild(splitFirst[0]);
    list2.appendChild(splitFirst[1]);
    for (let i = 1; i < items.length; i++) {
      list2.appendChild(items[i].cloneNode(true));
    }
    return [list1, list2];
  }

  if (fittingCount >= items.length) {
    return null;
  }

  const startNum = parseInt(listEl.getAttribute('start') || '1', 10);
  if (listEl.tagName.toLowerCase() === 'ol') {
    list2.setAttribute('start', String(startNum + fittingCount));
  }

  for (let i = fittingCount; i < items.length; i++) {
    list2.appendChild(items[i].cloneNode(true));
  }

  return [list1, list2];
}

function splitTableAcrossBoundary(
  tableEl: HTMLElement,
  availableHeightPx: number,
  measureSandbox: HTMLElement
): [HTMLElement, HTMLElement] | null {
  const rows = Array.from(tableEl.querySelectorAll('tr')) as HTMLElement[];
  if (rows.length <= 1 || availableHeightPx < 48) {
    return null;
  }

  const thead = tableEl.querySelector('thead');
  const headerRows = thead ? (Array.from(thead.querySelectorAll('tr')) as HTMLElement[]) : [];
  const bodyRows = rows.filter((r) => !headerRows.includes(r));

  if (bodyRows.length <= 1) {
    return null;
  }

  const table1 = tableEl.cloneNode(false) as HTMLElement;
  const table2 = tableEl.cloneNode(false) as HTMLElement;

  if (thead) {
    table1.appendChild(thead.cloneNode(true));
    table2.appendChild(thead.cloneNode(true));
  }

  const tbody1 = document.createElement('tbody');
  const tbody2 = document.createElement('tbody');
  table1.appendChild(tbody1);
  table2.appendChild(tbody2);

  measureSandbox.innerHTML = '';
  measureSandbox.appendChild(table1);

  let fittingBodyRows = 0;
  for (let i = 0; i < bodyRows.length; i++) {
    const rowClone = bodyRows[i].cloneNode(true) as HTMLElement;
    tbody1.appendChild(rowClone);

    if (getOuterElementHeight(table1) > availableHeightPx) {
      tbody1.removeChild(rowClone);
      break;
    }
    fittingBodyRows = i + 1;
  }

  if (fittingBodyRows === 0 || fittingBodyRows >= bodyRows.length) {
    return null;
  }

  for (let i = fittingBodyRows; i < bodyRows.length; i++) {
    tbody2.appendChild(bodyRows[i].cloneNode(true));
  }

  return [table1, table2];
}

export interface PaginationResult {
  pages: string[];
  totalPages: number;
  layout: ComputedPageLayout;
}

function paginateDocumentHeadless(
  cleanHtml: string,
  layout: ComputedPageLayout
): PaginationResult {
  const trimmed = cleanHtml.trim();
  if (!trimmed) {
    return { pages: [''], totalPages: 1, layout };
  }

  const charsPerLine = Math.max(28, Math.floor(layout.contentWidthPx / 8.2));
  const lineHeightPx = 23.5;

  const tokenRegex = /(<hr\b[^>]*\/?>|<(h[1-6]|p|ul|ol|table|blockquote|pre|figure|img|div)\b[^>]*>[\s\S]*?<\/\2>|<img\b[^>]*\/?>)/gi;
  const rawTokens: string[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(trimmed)) !== null) {
    if (match.index > lastIdx) {
      const between = trimmed.slice(lastIdx, match.index).trim();
      if (between) rawTokens.push(`<p>${between}</p>`);
    }
    rawTokens.push(match[0]);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < trimmed.length) {
    const tail = trimmed.slice(lastIdx).trim();
    if (tail) rawTokens.push(`<p>${tail}</p>`);
  }

  const pages: string[] = [];
  let currentPageHtml: string[] = [];
  let currentPageNumber = 1;
  let usedHeightPx = 0;

  const getCurrentMaxH = () => getPageUsableHeightPx(layout, currentPageNumber);

  const flushPage = () => {
    pages.push(currentPageHtml.join('\n'));
    currentPageHtml = [];
    currentPageNumber += 1;
    usedHeightPx = 0;
  };

  let idx = 0;
  while (idx < rawTokens.length) {
    const token = rawTokens[idx];
    const lower = token.toLowerCase();

    if (
      lower.startsWith('<hr') &&
      !lower.includes('data-page-break="soft"') &&
      !lower.includes('soft-page-break')
    ) {
      flushPage();
      idx += 1;
      continue;
    }

    const plainText = token.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const isHeading = /^<h[1-6]\b/i.test(token);
    const isTable = /^<table\b/i.test(token) || (/<table\b/i.test(token) && /^<div\b/i.test(token));
    const isList = /^<(ul|ol)\b/i.test(token);
    const isImage = /^<(img|figure)\b/i.test(token) || /<img\b/i.test(token);

    if (isHeading) {
      const headingH = /^<h1\b/i.test(token) ? 48 : /^<h2\b/i.test(token) ? 40 : 34;
      if (
        usedHeightPx > 0 &&
        usedHeightPx + headingH + layout.headingKeepWithNextPx > getCurrentMaxH()
      ) {
        flushPage();
      }
      currentPageHtml.push(token);
      usedHeightPx += headingH + 12;
      idx += 1;
      continue;
    }

    if (isImage) {
      const heightMatch = token.match(/height\s*[:=]\s*["']?(\d+)/i);
      const imgH = heightMatch ? Math.min(Number(heightMatch[1]), getCurrentMaxH()) : 220;
      if (usedHeightPx > 0 && usedHeightPx + imgH > getCurrentMaxH()) {
        flushPage();
      }
      currentPageHtml.push(token);
      usedHeightPx += imgH + 12;
      idx += 1;
      continue;
    }

    if (isTable) {
      const rowMatches = token.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
      if (rowMatches.length > 1) {
        const rowH = 38;
        const totalTableH = rowMatches.length * rowH + 16;
        if (usedHeightPx + totalTableH <= getCurrentMaxH()) {
          currentPageHtml.push(token);
          usedHeightPx += totalTableH;
          idx += 1;
          continue;
        }
        const remainingH = getCurrentMaxH() - usedHeightPx;
        const fittingRows = Math.floor((remainingH - 12) / rowH);
        if (fittingRows < 1 && usedHeightPx > 0) {
          flushPage();
          continue;
        }
        const splitIdx = Math.max(1, fittingRows);
        if (splitIdx < rowMatches.length) {
          const part1Rows = rowMatches.slice(0, splitIdx).join('');
          const part2Rows = rowMatches.slice(splitIdx).join('');
          currentPageHtml.push(`<table><tbody>${part1Rows}</tbody></table>`);
          flushPage();
          rawTokens.splice(idx, 1, `<table><tbody>${part2Rows}</tbody></table>`);
          continue;
        }
      }
    }

    if (isList) {
      const tag = /^<ol\b/i.test(token) ? 'ol' : 'ul';
      const liMatches = token.match(/<li\b[\s\S]*?<\/li>/gi) || [];
      if (liMatches.length > 1) {
        const itemHeights = liMatches.map((li) => {
          const text = li.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
          return lines * lineHeightPx + 4;
        });
        const totalListH = itemHeights.reduce((a, b) => a + b, 0) + 12;
        if (usedHeightPx + totalListH <= getCurrentMaxH()) {
          currentPageHtml.push(token);
          usedHeightPx += totalListH;
          idx += 1;
          continue;
        }
        const remainingH = getCurrentMaxH() - usedHeightPx;
        if (remainingH < itemHeights[0] && usedHeightPx > 0) {
          flushPage();
          continue;
        }
        let accH = 0;
        let splitCount = 0;
        for (let k = 0; k < itemHeights.length; k++) {
          if (accH + itemHeights[k] > remainingH && k > 0) break;
          accH += itemHeights[k];
          splitCount = k + 1;
        }
        if (splitCount > 0 && splitCount < liMatches.length) {
          currentPageHtml.push(`<${tag}>${liMatches.slice(0, splitCount).join('')}</${tag}>`);
          flushPage();
          rawTokens.splice(idx, 1, `<${tag}>${liMatches.slice(splitCount).join('')}</${tag}>`);
          continue;
        }
      }
    }

    const lineCount = Math.max(1, Math.ceil(plainText.length / charsPerLine));
    const blockH = lineCount * lineHeightPx + 12;

    if (usedHeightPx + blockH <= getCurrentMaxH()) {
      currentPageHtml.push(token);
      usedHeightPx += blockH;
      idx += 1;
      continue;
    }

    const remainingH = getCurrentMaxH() - usedHeightPx;
    const fittingLines = Math.floor((remainingH - 6) / lineHeightPx);

    if (fittingLines < 2 && usedHeightPx > 0 && blockH <= getPageUsableHeightPx(layout, currentPageNumber + 1)) {
      flushPage();
      continue;
    }

    if (fittingLines >= 1 && lineCount > fittingLines) {
      const words = plainText.split(/\s+/);
      const maxCharsFit = fittingLines * charsPerLine;
      let charAcc = 0;
      let splitWordIdx = 0;
      for (let w = 0; w < words.length; w++) {
        if (charAcc + words[w].length + 1 > maxCharsFit && w > 0) {
          break;
        }
        charAcc += words[w].length + 1;
        splitWordIdx = w + 1;
      }

      if (splitWordIdx > 0 && splitWordIdx < words.length) {
        const openTagMatch = token.match(/^<([a-z0-9]+)\b[^>]*>/i);
        const closeTagMatch = token.match(/<\/([a-z0-9]+)>\s*$/i);
        const openTag = openTagMatch ? openTagMatch[0] : '<p>';
        const closeTag = closeTagMatch ? closeTagMatch[0] : '</p>';

        const innerHtml = token
          .replace(/^<([a-z0-9]+)\b[^>]*>/i, '')
          .replace(/<\/([a-z0-9]+)>\s*$/i, '');
        const inlineWrapMatch = innerHtml.match(/^(\s*<(?:strong|em|b|i|u|span|a|mark)\b[^>]*>)([\s\S]*)(<\/(?:strong|em|b|i|u|span|a|mark)>\s*)$/i);

        const headText = words.slice(0, splitWordIdx).join(' ');
        const tailText = words.slice(splitWordIdx).join(' ');

        const headHtml = inlineWrapMatch
          ? `${openTag}${inlineWrapMatch[1]}${headText}${inlineWrapMatch[3]}${closeTag}`
          : `${openTag}${headText}${closeTag}`;
        const tailHtml = inlineWrapMatch
          ? `${openTag}${inlineWrapMatch[1]}${tailText}${inlineWrapMatch[3]}${closeTag}`
          : `${openTag}${tailText}${closeTag}`;

        currentPageHtml.push(headHtml);
        flushPage();
        rawTokens.splice(idx, 1, tailHtml);
        continue;
      }
    }

    if (usedHeightPx > 0) {
      flushPage();
      continue;
    }

    currentPageHtml.push(token);
    usedHeightPx += blockH;
    idx += 1;
  }

  if (currentPageHtml.length > 0 || pages.length === 0) {
    pages.push(currentPageHtml.join('\n'));
  }

  return {
    pages,
    totalPages: Math.max(1, pages.length),
    layout,
  };
}

export function paginateDocument(
  htmlContent: string,
  config: PageLayoutConfig
): PaginationResult {
  const layout = computePageLayout(config);
  const cleanHtml = stripTransientPaginationArtifacts(htmlContent || '');

  if (typeof document === 'undefined' || !document.body) {
    return paginateDocumentHeadless(cleanHtml, layout);
  }

  if (!cleanHtml || cleanHtml.trim() === '' || cleanHtml.trim() === '<p></p>') {
    return {
      pages: [''],
      totalPages: 1,
      layout,
    };
  }

  const sandboxWrapper = document.createElement('div');
  sandboxWrapper.setAttribute('aria-hidden', 'true');
  sandboxWrapper.style.position = 'fixed';
  sandboxWrapper.style.top = '-20000px';
  sandboxWrapper.style.left = '-20000px';
  sandboxWrapper.style.width = `${layout.contentWidthPx}px`;
  sandboxWrapper.style.visibility = 'hidden';
  sandboxWrapper.style.pointerEvents = 'none';
  sandboxWrapper.style.zIndex = '-9999';

  const sourceContainer = document.createElement('div');
  sourceContainer.className = 'ProseMirror paper-white prose max-w-none';
  sourceContainer.style.width = `${layout.contentWidthPx}px`;
  sourceContainer.style.padding = '0';
  sourceContainer.style.margin = '0';
  sourceContainer.style.boxSizing = 'border-box';
  sourceContainer.innerHTML = cleanHtml;

  const measurePageBox = document.createElement('div');
  measurePageBox.className = 'ProseMirror paper-white prose max-w-none';
  measurePageBox.style.width = `${layout.contentWidthPx}px`;
  measurePageBox.style.padding = '0';
  measurePageBox.style.margin = '0';
  measurePageBox.style.boxSizing = 'border-box';

  const splitSandbox = document.createElement('div');
  splitSandbox.className = 'ProseMirror paper-white prose max-w-none';
  splitSandbox.style.width = `${layout.contentWidthPx}px`;
  splitSandbox.style.padding = '0';
  splitSandbox.style.margin = '0';
  splitSandbox.style.boxSizing = 'border-box';

  sandboxWrapper.appendChild(sourceContainer);
  sandboxWrapper.appendChild(measurePageBox);
  sandboxWrapper.appendChild(splitSandbox);
  document.body.appendChild(sandboxWrapper);

  try {
    const totalSourceHeight = sourceContainer.getBoundingClientRect().height;
    if (totalSourceHeight === 0 && (sourceContainer.textContent || '').trim().length > 0) {
      return paginateDocumentHeadless(cleanHtml, layout);
    }

    const pages: string[] = [];
    let currentPageIndex = 0;

    const getMaxPageHeight = (pageIdx: number) =>
      pageIdx === 0 ? layout.page1UsableHeightPx : layout.subsequentUsableHeightPx;

    const flushCurrentPage = () => {
      pages.push(measurePageBox.innerHTML);
      measurePageBox.innerHTML = '';
      currentPageIndex += 1;
    };

    const rawNodes = Array.from(sourceContainer.childNodes);
    const workQueue: HTMLElement[] = [];

    for (const node of rawNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (isSoftBreakElement(el)) continue;
        workQueue.push(el.cloneNode(true) as HTMLElement);
      } else if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim()) {
        const p = document.createElement('p');
        p.textContent = node.textContent;
        workQueue.push(p);
      }
    }

    while (workQueue.length > 0) {
      const currentEl = workQueue.shift()!;
      const tag = currentEl.tagName.toLowerCase();
      const maxPageH = getMaxPageHeight(currentPageIndex);

      if (isSoftBreakElement(currentEl)) {
        continue;
      }

      if (isHardBreakElement(currentEl)) {
        flushCurrentPage();
        continue;
      }

      const currentUsedH = measurePageBox.getBoundingClientRect().height;
      const isHeading = /^h[1-6]$/.test(tag);

      measurePageBox.appendChild(currentEl);
      const newPageH = measurePageBox.getBoundingClientRect().height;
      const hasNextContent = workQueue.length > 0 && !isHardBreakElement(workQueue[0]);
      const headingReserve = isHeading && hasNextContent ? layout.headingKeepWithNextPx : 0;

      if (newPageH + headingReserve <= maxPageH) {
        continue;
      }

      measurePageBox.removeChild(currentEl);
      const remainingH = Math.max(0, maxPageH - currentUsedH);

      if (isHeading && currentUsedH > 0) {
        flushCurrentPage();
        workQueue.unshift(currentEl);
        continue;
      }

      const innerTable =
        tag === 'table'
          ? currentEl
          : (currentEl.querySelector('table') as HTMLElement | null);

      if (innerTable && remainingH >= 52) {
        const splitResult = splitTableAcrossBoundary(innerTable, remainingH, splitSandbox);
        if (splitResult) {
          measurePageBox.appendChild(splitResult[0]);
          flushCurrentPage();
          workQueue.unshift(splitResult[1]);
          continue;
        }
      }

      if (!innerTable && (tag === 'p' || tag === 'blockquote' || tag === 'div') && remainingH >= 28) {
        const splitResult = splitRichBlockByWordHeight(currentEl, remainingH, splitSandbox);
        if (splitResult) {
          measurePageBox.appendChild(splitResult[0]);
          flushCurrentPage();
          workQueue.unshift(splitResult[1]);
          continue;
        }
      }

      if ((tag === 'ul' || tag === 'ol') && remainingH >= 32) {
        const splitResult = splitListAcrossBoundary(currentEl, remainingH, splitSandbox);
        if (splitResult) {
          measurePageBox.appendChild(splitResult[0]);
          flushCurrentPage();
          workQueue.unshift(splitResult[1]);
          continue;
        }
      }

      if (measurePageBox.children.length > 0) {
        flushCurrentPage();
        workQueue.unshift(currentEl);
        continue;
      }

      if (innerTable) {
        const splitResult = splitTableAcrossBoundary(innerTable, maxPageH, splitSandbox);
        if (splitResult) {
          measurePageBox.appendChild(splitResult[0]);
          flushCurrentPage();
          workQueue.unshift(splitResult[1]);
          continue;
        }
      } else if (tag === 'p' || tag === 'blockquote' || tag === 'div') {
        const splitResult = splitRichBlockByWordHeight(currentEl, maxPageH, splitSandbox);
        if (splitResult) {
          measurePageBox.appendChild(splitResult[0]);
          flushCurrentPage();
          workQueue.unshift(splitResult[1]);
          continue;
        }
      } else if (tag === 'ul' || tag === 'ol') {
        const splitResult = splitListAcrossBoundary(currentEl, maxPageH, splitSandbox);
        if (splitResult) {
          measurePageBox.appendChild(splitResult[0]);
          flushCurrentPage();
          workQueue.unshift(splitResult[1]);
          continue;
        }
      }

      measurePageBox.appendChild(currentEl);
      flushCurrentPage();
    }

    if (measurePageBox.children.length > 0 || pages.length === 0) {
      pages.push(measurePageBox.innerHTML);
    }

    return {
      pages,
      totalPages: Math.max(1, pages.length),
      layout,
    };
  } finally {
    if (sandboxWrapper.parentNode) {
      sandboxWrapper.parentNode.removeChild(sandboxWrapper);
    }
  }
}

export function splitHtmlIntoMeasuredPages(
  htmlContent: string,
  paperSize: PaperSizeOption = 'a4',
  orientation: OrientationOption = 'portrait',
  marginOption: MarginOption = 'normal',
  customMarginsPx?: CustomMarginsPx
): string[] {
  const res = paginateDocument(htmlContent, {
    paperSize,
    orientation,
    marginOption,
    customMarginsPx,
  });
  return res.pages;
}

export function calculateExactPageCount(
  htmlContent: string,
  paperSize: PaperSizeOption = 'a4',
  orientation: OrientationOption = 'portrait',
  marginOption: MarginOption = 'normal',
  customMarginsPx?: CustomMarginsPx
): number {
  const res = paginateDocument(htmlContent, {
    paperSize,
    orientation,
    marginOption,
    customMarginsPx,
  });
  return res.totalPages;
}
