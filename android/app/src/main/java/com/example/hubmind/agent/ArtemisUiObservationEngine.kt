/*
 * Portions adapted from Google ARTEMIS (https://github.com/google/artemis)
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.example.hubmind.agent

data class IndexedUiElement(
    val index: Int,
    val nodeId: String,
    val viewIdResourceName: String?,
    val className: String?,
    val packageName: String?,
    val text: String?,
    val contentDescription: String?,
    val isClickable: Boolean,
    val isEditable: Boolean,
    val isScrollable: Boolean,
    val bounds: NodeBounds
) {
    val area: Int
        get() = maxOf(1, bounds.right - bounds.left) * maxOf(1, bounds.bottom - bounds.top)

    val label: String
        get() = text?.takeIf { it.isNotBlank() }
            ?: contentDescription?.takeIf { it.isNotBlank() }
            ?: viewIdResourceName?.substringAfterLast('/')
            ?: className?.substringAfterLast('.')
            ?: "Element"
}

/**
 * Native Kotlin adaptation of Google ARTEMIS's UI filtering (`ui_filter.py`) and
 * smallest-area hit-testing (`element_hit_test.py`) for Hub-Mind's Android accessibility engine.
 */
object ArtemisUiObservationEngine {

    private const val DEFAULT_MIN_ELEMENT_SIZE_PX = 4

    fun intersectsScreen(bounds: NodeBounds, screenWidth: Int, screenHeight: Int): Boolean {
        return !(bounds.right <= 0 || bounds.bottom <= 0 || bounds.left >= screenWidth || bounds.top >= screenHeight)
    }

    fun meetsMinSize(bounds: NodeBounds, minSizePx: Int = DEFAULT_MIN_ELEMENT_SIZE_PX): Boolean {
        val width = bounds.right - bounds.left
        val height = bounds.bottom - bounds.top
        return width > minSizePx && height > minSizePx
    }

    fun clipBounds(bounds: NodeBounds, ancestor: NodeBounds): NodeBounds? {
        val left = maxOf(bounds.left, ancestor.left)
        val top = maxOf(bounds.top, ancestor.top)
        val right = minOf(bounds.right, ancestor.right)
        val bottom = minOf(bounds.bottom, ancestor.bottom)
        if (left >= right || top >= bottom) return null
        return NodeBounds(left = left, top = top, right = right, bottom = bottom)
    }

    /**
     * Flattens and filters a raw [UiNodeInfo] accessibility tree into a compact,
     * indexed list of visible/actionable UI elements suitable for Jess reasoning and targeting.
     */
    fun extractIndexedElements(
        root: UiNodeInfo,
        screenWidth: Int = 1440,
        screenHeight: Int = 3200,
        minSizePx: Int = DEFAULT_MIN_ELEMENT_SIZE_PX
    ): List<IndexedUiElement> {
        val results = mutableListOf<IndexedUiElement>()
        val screenBounds = NodeBounds(0, 0, screenWidth, screenHeight)
        var counter = 1

        fun traverse(node: UiNodeInfo, parentClip: NodeBounds) {
            val rawBounds = node.boundsInScreen
            val effectiveClip = if (rawBounds.right > rawBounds.left && rawBounds.bottom > rawBounds.top) {
                clipBounds(rawBounds, parentClip) ?: parentClip
            } else {
                parentClip
            }

            val hasMeaningfulLabel = !node.text.isNullOrBlank() || !node.contentDescription.isNullOrBlank()
            val isInteractive = node.isClickable || node.isEditable || node.isScrollable
            val isValidBounds = intersectsScreen(rawBounds, screenWidth, screenHeight) &&
                meetsMinSize(rawBounds, minSizePx)

            if ((isInteractive || hasMeaningfulLabel) && isValidBounds) {
                val clipped = clipBounds(rawBounds, screenBounds) ?: rawBounds
                results.add(
                    IndexedUiElement(
                        index = counter++,
                        nodeId = node.id,
                        viewIdResourceName = node.viewIdResourceName,
                        className = node.className,
                        packageName = node.packageName,
                        text = node.text,
                        contentDescription = node.contentDescription,
                        isClickable = node.isClickable,
                        isEditable = node.isEditable,
                        isScrollable = node.isScrollable,
                        bounds = clipped
                    )
                )
            }

            for (child in node.children) {
                traverse(child, effectiveClip)
            }
        }

        traverse(root, screenBounds)
        return results
    }

    /**
     * Finds the smallest indexed element whose bounds contain pixel point (x, y).
     * Mirrors ARTEMIS's `find_element_at_point` hit-testing logic.
     */
    fun findElementAtPoint(elements: List<IndexedUiElement>, x: Int, y: Int): IndexedUiElement? {
        var best: IndexedUiElement? = null
        var bestArea = Int.MAX_VALUE
        for (el in elements) {
            val b = el.bounds
            if (x in b.left..b.right && y in b.top..b.bottom) {
                val area = el.area
                if (area < bestArea) {
                    bestArea = area
                    best = el
                }
            }
        }
        return best
    }

    /**
     * Formats the indexed elements as a compact summary for Jess tool output.
     */
    fun formatElementIndexSummary(elements: List<IndexedUiElement>, maxItems: Int = 40): String {
        if (elements.isEmpty()) return "No visible interactive elements detected."
        return elements.take(maxItems).joinToString("\n") { el ->
            val flags = buildList {
                if (el.isClickable) add("clickable")
                if (el.isEditable) add("editable")
                if (el.isScrollable) add("scrollable")
            }.joinToString(",")
            "[${el.index}] ${el.label} (${el.className?.substringAfterLast('.') ?: "View"}) " +
                "bounds=[${el.bounds.left},${el.bounds.top}][${el.bounds.right},${el.bounds.bottom}] " +
                "center=(${el.bounds.centerX},${el.bounds.centerY})" +
                (if (flags.isNotEmpty()) " [$flags]" else "")
        }
    }
}
