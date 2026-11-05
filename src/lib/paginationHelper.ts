/**
 * Hub-Mind Document Editor Pagination Helper
 *
 * Delegates all geometry, usable height, and page-count calculations to the
 * single authoritative engine in `src/lib/paginationEngine.ts`.
 */

import { Editor, Node, mergeAttributes } from '@tiptap/react';
import {
  PaperSizeOption,
  OrientationOption,
  MarginOption,
  CustomMarginsPx,
  computePageLayout,
  getPageStartInEditorPx,
  getPageEndInEditorPx,
  getPageNumberAtEditorOffsetPx,
  getPageUsableHeightPx,
  calculateExactPageCount,
  stripTransientPaginationArtifacts,
} from './paginationEngine';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: (breakType?: 'hard' | 'soft') => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      breakType: {
        default: 'hard',
        parseHTML: (element) => element.getAttribute('data-page-break') || 'hard',
        renderHTML: (attributes) => ({
          'data-page-break': attributes.breakType || 'hard',
          class:
            attributes.breakType === 'soft'
              ? 'page-break soft-page-break'
              : 'page-break hard-page-break',
        }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'hr[data-page-break]' },
      { tag: 'hr.page-break' },
      { tag: 'div.page-break' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['hr', mergeAttributes(HTMLAttributes)];
  },

  addCommands() {
    return {
      setPageBreak:
        (breakType: 'hard' | 'soft' = 'hard') =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: { breakType },
            })
            .run();
        },
    };
  },
});

export interface A4BoundaryMetrics {
  pageWidthPx: number;
  pageHeightPx: number;
  marginTopPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  marginRightPx: number;
  page1HeaderHeightPx: number;
  subsequentHeaderHeightPx: number;
  safetyBufferPx: number;
  page1UsableHeightPx: number;
  subsequentUsableHeightPx: number;
  interPageGapPx: number;
}

export interface PaginationBoundaryStatus {
  totalDocumentHeightPx: number;
  pageCount: number;
  activePageIndex: number;
  activePageUsedHeightPx: number;
  activePageMaxHeightPx: number;
  activePageRemainingPx: number;
  isApproachingBoundary: boolean;
  isOverflowingBoundary: boolean;
  hasSoftBreaks: boolean;
}

export function getA4BoundaryMetrics(
  paperSize: PaperSizeOption = 'a4',
  orientation: OrientationOption = 'portrait',
  marginOption: MarginOption = 'normal',
  customMarginsPx?: CustomMarginsPx
): A4BoundaryMetrics {
  const layout = computePageLayout({
    paperSize,
    orientation,
    marginOption,
    customMarginsPx,
  });

  return {
    pageWidthPx: layout.pageWidthPx,
    pageHeightPx: layout.pageHeightPx,
    marginTopPx: layout.marginsPx.top,
    marginBottomPx: layout.marginsPx.bottom,
    marginLeftPx: layout.marginsPx.left,
    marginRightPx: layout.marginsPx.right,
    page1HeaderHeightPx: layout.page1HeaderHeightPx,
    subsequentHeaderHeightPx: layout.subsequentHeaderHeightPx,
    safetyBufferPx: layout.bottomMarginSafetyPx,
    page1UsableHeightPx: layout.page1UsableHeightPx,
    subsequentUsableHeightPx: layout.subsequentUsableHeightPx,
    interPageGapPx: layout.interPageGapPx,
  };
}

export function calculateDocumentHeight(editorElement: HTMLElement | null): number {
  if (!editorElement) return 0;

  const proseMirrorRoot =
    (editorElement.querySelector('.ProseMirror') as HTMLElement) || editorElement;

  const rect = proseMirrorRoot.getBoundingClientRect();
  const activeScale =
    proseMirrorRoot.offsetWidth > 0
      ? rect.width / proseMirrorRoot.offsetWidth
      : 1;
  const safeScale = activeScale > 0.05 ? activeScale : 1;

  const children = Array.from(proseMirrorRoot.children) as HTMLElement[];
  if (children.length === 0) {
    return Math.round(rect.height / safeScale);
  }

  const firstRect = children[0].getBoundingClientRect();
  const lastRect = children[children.length - 1].getBoundingClientRect();
  const spanHeight = (lastRect.bottom - firstRect.top) / safeScale;

  return Math.max(Math.round(spanHeight), Math.round(proseMirrorRoot.offsetHeight));
}

export function insertHardPageBreak(editor: Editor | null): boolean {
  if (!editor || editor.isDestroyed) return false;

  try {
    editor.chain().focus().setPageBreak('hard').run();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hubmind:reflow-pagination'));
    }
    return true;
  } catch {
    return editor.chain().focus().setHorizontalRule().run();
  }
}

export function removeSoftPageBreaks(editor: Editor | null): number {
  if (!editor || editor.isDestroyed) return 0;

  const { state, view } = editor;
  const { tr } = state;
  let removedCount = 0;

  const positionsToRemove: { from: number; to: number }[] = [];

  state.doc.descendants((node, pos) => {
    if (
      (node.type.name === 'horizontalRule' || node.type.name === 'pageBreak') &&
      (node.attrs?.['data-page-break'] === 'soft' ||
        node.attrs?.breakType === 'soft' ||
        (typeof node.attrs?.class === 'string' &&
          node.attrs.class.includes('soft-page-break')))
    ) {
      positionsToRemove.push({ from: pos, to: pos + node.nodeSize });
    }
  });

  if (positionsToRemove.length === 0) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hubmind:reflow-pagination'));
    }
    return 0;
  }

  for (let i = positionsToRemove.length - 1; i >= 0; i--) {
    const { from, to } = positionsToRemove[i];
    tr.delete(from, to);
    removedCount++;
  }

  if (tr.docChanged) {
    tr.setMeta('addToHistory', false);
    view.dispatch(tr);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hubmind:reflow-pagination'));
  }

  return removedCount;
}

export function autoPaginateDocument(
  editor: Editor | null,
  editorHostElement: HTMLElement | null,
  paperSize: PaperSizeOption = 'a4',
  orientation: OrientationOption = 'portrait',
  marginOption: MarginOption = 'normal',
  customMarginsPx?: CustomMarginsPx
): PaginationBoundaryStatus {
  const layout = computePageLayout({
    paperSize,
    orientation,
    marginOption,
    customMarginsPx,
  });

  if (!editor || editor.isDestroyed || !editorHostElement) {
    return {
      totalDocumentHeightPx: 0,
      pageCount: 1,
      activePageIndex: 1,
      activePageUsedHeightPx: 0,
      activePageMaxHeightPx: layout.page1UsableHeightPx,
      activePageRemainingPx: layout.page1UsableHeightPx,
      isApproachingBoundary: false,
      isOverflowingBoundary: false,
      hasSoftBreaks: false,
    };
  }

  const proseMirrorRoot =
    (editorHostElement.querySelector('.ProseMirror') as HTMLElement) ||
    editorHostElement;

  const legacySoftBreaks = proseMirrorRoot.querySelectorAll(
    'hr[data-page-break="soft"], hr.soft-page-break'
  );
  if (legacySoftBreaks.length > 0) {
    removeSoftPageBreaks(editor);
  }

  const proseRect = proseMirrorRoot.getBoundingClientRect();
  const activeScale =
    proseMirrorRoot.offsetWidth > 0
      ? proseRect.width / proseMirrorRoot.offsetWidth
      : 1;
  const safeScale = activeScale > 0.05 ? activeScale : 1;

  const children = Array.from(proseMirrorRoot.children) as HTMLElement[];
  let maxBottomRelToEditor = 0;

  for (const child of children) {
    const cRect = child.getBoundingClientRect();
    const bottomRel = (cRect.bottom - proseRect.top) / safeScale;
    if (bottomRel > maxBottomRelToEditor) {
      maxBottomRelToEditor = bottomRel;
    }
  }

  const domPageCount = getPageNumberAtEditorOffsetPx(layout, Math.max(0, maxBottomRelToEditor - 2));
  const cleanHtml = stripTransientPaginationArtifacts(editor.getHTML());
  const enginePageCount = calculateExactPageCount(
    cleanHtml,
    paperSize,
    orientation,
    marginOption,
    customMarginsPx
  );
  const pageCount = Math.max(1, domPageCount, enginePageCount);

  const activePageIndex = pageCount;
  const activePageStart = getPageStartInEditorPx(layout, activePageIndex);
  const activePageEnd = getPageEndInEditorPx(layout, activePageIndex);
  const activePageMaxHeightPx = getPageUsableHeightPx(layout, activePageIndex);

  const activePageUsedHeightPx = Math.max(
    0,
    Math.min(activePageMaxHeightPx, Math.round(maxBottomRelToEditor - activePageStart))
  );
  const activePageRemainingPx = Math.max(
    0,
    Math.round(activePageEnd - maxBottomRelToEditor)
  );

  const hasFlowSpacers =
    proseMirrorRoot.querySelectorAll('.hm-page-flow-spacer, [data-hm-paginated-margin]').length > 0;

  return {
    totalDocumentHeightPx: Math.max(0, Math.round(maxBottomRelToEditor)),
    pageCount,
    activePageIndex,
    activePageUsedHeightPx,
    activePageMaxHeightPx,
    activePageRemainingPx,
    isApproachingBoundary: activePageRemainingPx <= 85 && activePageRemainingPx > 0,
    isOverflowingBoundary: maxBottomRelToEditor > activePageEnd,
    hasSoftBreaks: hasFlowSpacers,
  };
}

export function insertAutoSoftPageBreaks(
  editor: Editor | null,
  editorHostElement: HTMLElement | null,
  paperSize: PaperSizeOption = 'a4',
  orientation: OrientationOption = 'portrait',
  marginOption: MarginOption = 'normal',
  customMarginsPx?: CustomMarginsPx
): { breaksInserted: number; pageCount: number } {
  if (!editor || editor.isDestroyed || !editorHostElement) {
    return { breaksInserted: 0, pageCount: 1 };
  }

  removeSoftPageBreaks(editor);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hubmind:reflow-pagination'));
  }

  const status = autoPaginateDocument(
    editor,
    editorHostElement,
    paperSize,
    orientation,
    marginOption,
    customMarginsPx
  );

  return {
    breaksInserted: Math.max(0, status.pageCount - 1),
    pageCount: status.pageCount,
  };
}
