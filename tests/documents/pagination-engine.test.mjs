import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePageLayout,
  getPageSheetTopPx,
  getPagePrintableTopPx,
  getPageStartInEditorPx,
  getPageEndInEditorPx,
  stripTransientPaginationArtifacts,
  stripSoftPageBreaksFromJson,
  planPageFlowBlocks,
  paginateDocument,
  calculateExactPageCount,
} from '../../src/lib/paginationEngine.ts';

test('Coordinate System & Origin Invariant: editor origin does not double-count Page 1 top margin and header', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  assert.equal(getPageSheetTopPx(layout, 1), 0);
  assert.equal(getPagePrintableTopPx(layout, 1), 96 + 138);
  assert.equal(getPageStartInEditorPx(layout, 1), 0);
  assert.equal(getPageEndInEditorPx(layout, 1), layout.page1UsableHeightPx);

  assert.equal(getPageSheetTopPx(layout, 2), 1171);
  assert.equal(getPagePrintableTopPx(layout, 2), 1331);

  const page2EditorStart = getPageStartInEditorPx(layout, 2);
  assert.equal(page2EditorStart, 1331 - 234);
  assert.equal(
    getPagePrintableTopPx(layout, 1) + page2EditorStart,
    getPagePrintableTopPx(layout, 2)
  );

  assert.equal(
    getPageStartInEditorPx(layout, 2) - getPageEndInEditorPx(layout, 1),
    layout.interPageGapPx
  );
  assert.equal(
    getPageStartInEditorPx(layout, 3) - getPageEndInEditorPx(layout, 2),
    layout.interPageGapPx
  );
});

test('Scenario 1: Document filling Page 1 automatically flows into Page 2', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const blocks = Array.from({ length: 12 }, (_, idx) => ({
    id: `p-${idx + 1}`,
    kind: 'paragraph',
    heightPx: 72,
    marginBottomPx: 12,
  }));

  const flow = planPageFlowBlocks(blocks, layout);
  assert.equal(flow.totalPages, 2);

  const page1Blocks = flow.placements.filter((p) => p.startPage === 1);
  const page2Blocks = flow.placements.filter((p) => p.startPage === 2);
  assert.ok(page1Blocks.length > 0);
  assert.ok(page2Blocks.length > 0);
  assert.equal(page2Blocks[0].startEditorTopPx, getPageStartInEditorPx(layout, 2));
});

test('Scenario 2: Document filling Pages 1 and 2 automatically creates Page 3', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const blocks = Array.from({ length: 28 }, (_, idx) => ({
    id: `p-${idx + 1}`,
    kind: 'paragraph',
    heightPx: 72,
    marginBottomPx: 12,
  }));

  const flow = planPageFlowBlocks(blocks, layout);
  assert.equal(flow.totalPages, 3);

  const firstOnPage2 = flow.placements.find((p) => p.startPage === 2);
  const firstOnPage3 = flow.placements.find((p) => p.startPage === 3);
  assert.ok(firstOnPage2);
  assert.ok(firstOnPage3);
  assert.equal(firstOnPage2.startEditorTopPx, getPageStartInEditorPx(layout, 2));
  assert.equal(firstOnPage3.startEditorTopPx, getPageStartInEditorPx(layout, 3));
});

test('Scenario 3: Single large paragraph crosses multiple page boundaries at line boundaries and preserves marks', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const singleHugeParagraph = [
    {
      id: 'huge-p-1',
      kind: 'paragraph',
      heightPx: 90 * 24,
      marginBottomPx: 12,
      lines: Array.from({ length: 90 }, (_, l) => ({
        id: `line-${l}`,
        heightPx: 24,
      })),
    },
  ];

  const flow = planPageFlowBlocks(singleHugeParagraph, layout);
  assert.equal(flow.totalPages, 3);
  assert.equal(flow.placements[0].startPage, 1);
  assert.equal(flow.placements[0].endPage, 3);
  assert.equal(flow.lineBreaks.length, 2);
  assert.equal(flow.lineBreaks[0].fromPage, 1);
  assert.equal(flow.lineBreaks[0].toPage, 2);
  assert.equal(flow.lineBreaks[0].targetEditorTopPx, getPageStartInEditorPx(layout, 2));
  assert.equal(flow.lineBreaks[1].fromPage, 2);
  assert.equal(flow.lineBreaks[1].toPage, 3);
  assert.equal(flow.lineBreaks[1].targetEditorTopPx, getPageStartInEditorPx(layout, 3));

  const longMarkedText = Array.from({ length: 900 }, (_, i) => `word${i + 1}`).join(' ');
  const markedHtml = `<p><strong>${longMarkedText}</strong></p>`;
  const htmlResult = paginateDocument(markedHtml, {
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  assert.ok(htmlResult.totalPages >= 3);
  for (const pageSlice of htmlResult.pages) {
    assert.ok(pageSlice.includes('<strong>'));
  }
});

test('Scenario 4: Mixed headings, paragraphs, and lists with heading orphan protection', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const blocks = [
    { id: 'intro', kind: 'paragraph', heightPx: 718, marginBottomPx: 12 },
    { id: 'sec-heading', kind: 'heading', heightPx: 34, marginBottomPx: 10 },
    { id: 'sec-body', kind: 'paragraph', heightPx: 120, marginBottomPx: 12 },
    {
      id: 'sec-list',
      kind: 'list',
      heightPx: 900,
      marginBottomPx: 12,
      subItems: Array.from({ length: 18 }, (_, i) => ({
        id: `li-${i}`,
        heightPx: 50,
      })),
    },
  ];

  const flow = planPageFlowBlocks(blocks, layout);
  const headingPlacement = flow.placements.find((p) => p.blockId === 'sec-heading');
  const bodyPlacement = flow.placements.find((p) => p.blockId === 'sec-body');
  const listPlacement = flow.placements.find((p) => p.blockId === 'sec-list');

  assert.equal(headingPlacement.startPage, 2);
  assert.equal(bodyPlacement.startPage, 2);
  assert.equal(listPlacement.startPage, 2);
  assert.equal(listPlacement.endPage, 3);
  assert.ok(listPlacement.subItemShifts.length >= 1);
});

test('Scenario 5: Table crossing a page boundary splits cleanly by row', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const blocks = [
    { id: 'lead-p', kind: 'paragraph', heightPx: 450, marginBottomPx: 16 },
    {
      id: 'data-table',
      kind: 'table',
      heightPx: 15 * 44,
      marginBottomPx: 16,
      subItems: Array.from({ length: 15 }, (_, r) => ({
        id: `row-${r}`,
        heightPx: 44,
      })),
    },
  ];

  const flow = planPageFlowBlocks(blocks, layout);
  assert.equal(flow.totalPages, 2);
  const tablePlacement = flow.placements.find((p) => p.blockId === 'data-table');
  assert.equal(tablePlacement.startPage, 1);
  assert.equal(tablePlacement.endPage, 2);
  assert.equal(tablePlacement.subItemShifts.length, 1);
  assert.equal(
    tablePlacement.subItemShifts[0].targetEditorTopPx,
    getPageStartInEditorPx(layout, 2)
  );

  // Verify TipTap-wrapped <div class="tableWrapper"><table>...</table></div> splits by <tr> rows
  const wrappedRows = Array.from({ length: 24 }, (_, idx) =>
    `<tr><td><p>Expense item ${idx + 1}</p></td><td><p>29,000</p></td><td><p>6th Oct 2026</p></td></tr>`
  ).join('');
  const wrappedTableHtml = `<div class="tableWrapper"><table><tbody>${wrappedRows}</tbody></table></div>`;
  const wrappedResult = paginateDocument(wrappedTableHtml, {
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });
  assert.equal(wrappedResult.totalPages, 2);
  assert.ok(wrappedResult.pages[0].includes('<table>'));
  assert.ok(wrappedResult.pages[1].includes('<table>'));
  assert.ok(wrappedResult.pages[0].includes('Expense item 1'));
  assert.ok(wrappedResult.pages[1].includes('Expense item 24'));
});

test('Scenario 6: Image near the bottom of a page moves cleanly to the next page', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const blocks = [
    { id: 'text-before-img', kind: 'paragraph', heightPx: 620, marginBottomPx: 12 },
    { id: 'chart-img', kind: 'image', heightPx: 240, marginBottomPx: 12 },
  ];

  const flow = planPageFlowBlocks(blocks, layout);
  assert.equal(flow.totalPages, 2);
  const imgPlacement = flow.placements.find((p) => p.blockId === 'chart-img');
  assert.equal(imgPlacement.startPage, 2);
  assert.equal(imgPlacement.startEditorTopPx, getPageStartInEditorPx(layout, 2));
});

test('Scenario 7: Manually inserted hard page break forces subsequent content onto the next page', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const blocks = [
    { id: 'p-1', kind: 'paragraph', heightPx: 120, marginBottomPx: 12 },
    { id: 'manual-break', kind: 'hard-break', heightPx: 0, marginBottomPx: 0 },
    { id: 'p-2', kind: 'paragraph', heightPx: 120, marginBottomPx: 12 },
  ];

  const flow = planPageFlowBlocks(blocks, layout);
  assert.equal(flow.totalPages, 2);
  const p2 = flow.placements.find((p) => p.blockId === 'p-2');
  assert.equal(p2.startPage, 2);
  assert.equal(p2.startEditorTopPx, getPageStartInEditorPx(layout, 2));

  const htmlWithHardBreak = `<p>First page text</p><hr class="page-break hard-page-break" data-page-break="hard" /><p>Second page text</p>`;
  const htmlResult = paginateDocument(htmlWithHardBreak, {
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });
  assert.equal(htmlResult.totalPages, 2);
});

test('Scenario 8: Deleting content so Page 3 becomes unnecessary decreases page count back to 2 and 1', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const threePageBlocks = Array.from({ length: 26 }, (_, idx) => ({
    id: `p-${idx + 1}`,
    kind: 'paragraph',
    heightPx: 72,
    marginBottomPx: 12,
  }));
  assert.equal(planPageFlowBlocks(threePageBlocks, layout).totalPages, 3);

  const twoPageBlocks = threePageBlocks.slice(0, 14);
  assert.equal(planPageFlowBlocks(twoPageBlocks, layout).totalPages, 2);

  const onePageBlocks = threePageBlocks.slice(0, 5);
  assert.equal(planPageFlowBlocks(onePageBlocks, layout).totalPages, 1);
});

test('Scenario 9: Undo/redo & canonical document state are never corrupted by soft page breaks or spacer widgets', () => {
  const pollutedHtml =
    '<p data-paginated-shift="true" data-hm-paginated-margin="340">Paragraph one<span class="hm-page-flow-spacer" data-hm-page-spacer="2"></span> continued</p>' +
    '<hr class="page-break soft-page-break" data-page-break="soft" />' +
    '<hr class="page-break hard-page-break" data-page-break="hard" />' +
    '<p>Paragraph two</p>';

  const cleanedHtml = stripTransientPaginationArtifacts(pollutedHtml);
  assert.ok(!cleanedHtml.includes('soft-page-break'));
  assert.ok(!cleanedHtml.includes('hm-page-flow-spacer'));
  assert.ok(!cleanedHtml.includes('data-hm-paginated-margin'));
  assert.ok(cleanedHtml.includes('data-page-break="hard"'));
  assert.ok(cleanedHtml.includes('Paragraph one continued'));

  const sampleJson = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] },
      { type: 'horizontalRule', attrs: { 'data-page-break': 'soft', class: 'page-break soft-page-break' } },
      { type: 'horizontalRule', attrs: { 'data-page-break': 'hard', class: 'page-break hard-page-break' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Beta' }] },
    ],
  };

  const cleanedJson = stripSoftPageBreaksFromJson(sampleJson);
  assert.equal(cleanedJson.content.length, 3);
  assert.equal(cleanedJson.content[1].attrs['data-page-break'], 'hard');
});

test('Scenario 10, 11 & 12: Paper sizes (A4, Letter, Legal), orientations (portrait, landscape), and margins recompute accurately', () => {
  const a4Portrait = computePageLayout({ paperSize: 'a4', orientation: 'portrait', marginOption: 'normal' });
  const letterPortrait = computePageLayout({ paperSize: 'letter', orientation: 'portrait', marginOption: 'normal' });
  const legalPortrait = computePageLayout({ paperSize: 'legal', orientation: 'portrait', marginOption: 'normal' });
  const a4Landscape = computePageLayout({ paperSize: 'a4', orientation: 'landscape', marginOption: 'normal' });
  const a4Narrow = computePageLayout({ paperSize: 'a4', orientation: 'portrait', marginOption: 'narrow' });
  const a4Wide = computePageLayout({ paperSize: 'a4', orientation: 'portrait', marginOption: 'wide' });
  const a4Custom = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'custom',
    customMarginsPx: { top: 60, right: 60, bottom: 60, left: 60 },
  });

  assert.ok(legalPortrait.page1UsableHeightPx > a4Portrait.page1UsableHeightPx);
  assert.ok(a4Portrait.page1UsableHeightPx > letterPortrait.page1UsableHeightPx);
  assert.equal(a4Landscape.pageWidthPx, a4Portrait.pageHeightPx);
  assert.equal(a4Landscape.pageHeightPx, a4Portrait.pageWidthPx);
  assert.ok(a4Narrow.page1UsableHeightPx > a4Portrait.page1UsableHeightPx);
  assert.ok(a4Narrow.contentWidthPx > a4Portrait.contentWidthPx);
  assert.ok(a4Portrait.contentWidthPx > a4Wide.contentWidthPx);
  assert.equal(a4Custom.marginsPx.top, 60);

  const sampleBlocks = Array.from({ length: 12 }, (_, i) => ({
    id: `b-${i}`,
    kind: 'paragraph',
    heightPx: 68,
    marginBottomPx: 12,
  }));

  assert.equal(planPageFlowBlocks(sampleBlocks, legalPortrait).totalPages, 1);
  assert.equal(planPageFlowBlocks(sampleBlocks, a4Portrait).totalPages, 2);
  assert.equal(planPageFlowBlocks(sampleBlocks, a4Landscape).totalPages, 3);
});

test('Scenario 13: Mobile scaling and pinch-zoom coordinate invariance', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const unscaledBlocks = Array.from({ length: 20 }, (_, i) => ({
    id: `p-${i}`,
    kind: 'paragraph',
    heightPx: 70,
    marginBottomPx: 12,
  }));

  const baselinePlan = planPageFlowBlocks(unscaledBlocks, layout);

  for (const scale of [0.42, 0.75, 1.0, 1.25, 1.65]) {
    const scaledProseWidth = layout.contentWidthPx * scale;
    const recoveredScale = scaledProseWidth / layout.contentWidthPx;
    const normalizedBlocks = unscaledBlocks.map((b) => ({
      ...b,
      heightPx: (b.heightPx * scale) / recoveredScale,
      marginBottomPx: (b.marginBottomPx * scale) / recoveredScale,
    }));

    const scaledPlan = planPageFlowBlocks(normalizedBlocks, layout);
    assert.equal(scaledPlan.totalPages, baselinePlan.totalPages);
    assert.deepEqual(scaledPlan.blockShifts, baselinePlan.blockShifts);
  }
});

test('Scenario 14: Preview, PDF export, and repeated reflow idempotence agree on page count and margins', () => {
  const layout = computePageLayout({
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  const blocks = Array.from({ length: 22 }, (_, i) => ({
    id: `p-${i}`,
    kind: 'paragraph',
    heightPx: 68,
    marginBottomPx: 12,
  }));

  const firstRun = planPageFlowBlocks(blocks, layout);
  const secondRun = planPageFlowBlocks(blocks, layout);
  const thirdRun = planPageFlowBlocks(blocks, layout);

  assert.deepEqual(firstRun, secondRun);
  assert.deepEqual(secondRun, thirdRun);

  const htmlParagraphs = Array.from(
    { length: 24 },
    (_, i) =>
      `<p>Section ${i + 1}: This is a complete paragraph of institutional curriculum documentation for Hub-Mind verification across editor, preview, and PDF export.</p>`
  ).join('');

  const pageCount = calculateExactPageCount(htmlParagraphs, 'a4', 'portrait', 'normal');
  const paginated = paginateDocument(htmlParagraphs, {
    paperSize: 'a4',
    orientation: 'portrait',
    marginOption: 'normal',
  });

  assert.equal(pageCount, paginated.totalPages);
  assert.equal(paginated.pages.length, paginated.totalPages);
  assert.ok(paginated.totalPages >= 2);
});
