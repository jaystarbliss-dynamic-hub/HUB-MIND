package com.example.hubmind.agent

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RadialGradient
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import com.example.hubmind.MainActivity
import android.view.View
import android.view.WindowManager
import kotlin.math.min
import kotlin.math.sin

/**
 * Transparent, touchable, system-wide Jess orb. It does not own a model or
 * microphone: taps are sent to HubMindJessNativeEvents and handled by the
 * existing workspace LiveAudioClient.
 */
class JessOrbOverlayManager(context: Context) {
    private val appContext = context.applicationContext
    private val windowManager = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val handler = Handler(Looper.getMainLooper())
    private val orbView = JessOrbView(appContext) { HubMindJessNativeEvents.dispatch(it) }
    private var attached = false
    private var overlayParams: WindowManager.LayoutParams? = null
    private var overlaySizePx = dp(82)
    private var dragStartRawX = 0f
    private var dragStartRawY = 0f
    private var dragStartX = 0
    private var dragStartY = 0
    private var hasMoved = false
    private val touchSlop = ViewConfiguration.get(appContext).scaledTouchSlop

    val hasPermission: Boolean
        get() = Settings.canDrawOverlays(appContext)

    fun show() {
        handler.post {
            if (attached || !hasPermission) return@post
            val size = overlaySizePx
            val params = WindowManager.LayoutParams(
                size,
                size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
                x = overlayParams?.x ?: dp(10)
                y = overlayParams?.y ?: 0
                title = "Hub-Mind Jess"
            }
            overlayParams = params
            installTouchHandler(params, size)
            runCatching {
                windowManager.addView(orbView, params)
                attached = true
            }
        }
    }

    private fun installTouchHandler(params: WindowManager.LayoutParams, size: Int) {
        orbView.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    dragStartRawX = event.rawX
                    dragStartRawY = event.rawY
                    dragStartX = params.x
                    dragStartY = params.y
                    hasMoved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaX = event.rawX - dragStartRawX
                    val deltaY = event.rawY - dragStartRawY
                    if (!hasMoved && (kotlin.math.abs(deltaX) > touchSlop || kotlin.math.abs(deltaY) > touchSlop)) {
                        hasMoved = true
                    }
                    if (hasMoved) {
                        val metrics = appContext.resources.displayMetrics
                        val maxX = (metrics.widthPixels - size).coerceAtLeast(0)
                        val verticalReach = ((metrics.heightPixels - size) / 2).coerceAtLeast(0)
                        params.x = (dragStartX - deltaX.toInt()).coerceIn(0, maxX)
                        params.y = (dragStartY + deltaY.toInt()).coerceIn(-verticalReach, verticalReach)
                        runCatching { windowManager.updateViewLayout(view, params) }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!hasMoved) {
                        if (event.eventTime - event.downTime >= LONG_PRESS_MS) {
                            onOverlayGesture("stop")
                        } else {
                            view.performClick()
                        }
                    }
                    hasMoved = false
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    hasMoved = false
                    true
                }
                else -> true
            }
        }
    }

    private fun onOverlayGesture(gesture: String) {
        // Bring the existing app/WebView to the foreground; the gesture is
        // queued in-process and consumed by its single Jess assistant.
        runCatching {
            appContext.startActivity(
                Intent(appContext, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                }
            )
        }
        HubMindJessNativeEvents.dispatch(gesture)
    }

    fun update(state: String, inputLevel: Float, outputLevel: Float, connected: Boolean) {
        handler.post {
            orbView.updateVisualState(
                state.takeIf { it in ALLOWED_STATES } ?: "idle",
                inputLevel.coerceIn(0f, 1f),
                outputLevel.coerceIn(0f, 1f),
                connected
            )
        }
    }

    fun hide() {
        handler.post {
            if (!attached) return@post
            runCatching { windowManager.removeView(orbView) }
            attached = false
            overlayParams = overlayParams?.also {
                // Retain the user's position across foreground/background transitions.
                it.x = overlayParams?.x ?: it.x
                it.y = overlayParams?.y ?: it.y
            }
        }
    }

    fun close() {
        hide()
    }

    private fun dp(value: Int): Int =
        (value * appContext.resources.displayMetrics.density).toInt()

    private class JessOrbView(
        context: Context,
        private val onGesture: (String) -> Unit
    ) : View(context) {
        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = dp(1.6f)
        }
        private val corePaint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val frameHandler = Handler(Looper.getMainLooper())
        private var frame = 0
        private var orbState = "idle"
        private var input = 0f
        private var output = 0f
        private var connected = false
        private var phase = 0f

        private val renderFrame = object : Runnable {
            override fun run() {
                phase += 0.07f
                invalidate()
                frameHandler.postDelayed(this, 42L)
            }
        }

        init {
            isClickable = true
            isFocusable = false
            setOnClickListener { onGesture("toggle") }
            contentDescription = "Jess floating assistant. Drag to reposition. Tap to activate or mute. Press and hold to stop."
        }

        fun updateVisualState(state: String, inputLevel: Float, outputLevel: Float, isConnected: Boolean) {
            orbState = state
            input = inputLevel
            output = outputLevel
            connected = isConnected
            invalidate()
        }

        override fun onAttachedToWindow() {
            super.onAttachedToWindow()
            frameHandler.removeCallbacks(renderFrame)
            frameHandler.post(renderFrame)
        }

        override fun onDetachedFromWindow() {
            frameHandler.removeCallbacks(renderFrame)
            super.onDetachedFromWindow()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            val cy = height / 2f
            val radius = min(width, height) * 0.245f
            val intensity = when (orbState) {
                "speaking" -> (0.18f + output * 0.45f).coerceAtMost(0.75f)
                "listening" -> (0.16f + input * 0.42f).coerceAtMost(0.72f)
                "thinking" -> 0.42f + sin(phase * 2f) * 0.08f
                "error", "interrupted" -> 0.22f
                else -> 0.17f + sin(phase) * 0.025f
            }
            val haloRadius = radius * (2.55f + intensity * 0.7f)
            val centerColor = when (orbState) {
                "error", "interrupted" -> 0x55f43f5e
                "speaking" -> 0x55eab308
                "thinking" -> 0x557c3aed
                else -> 0x5542d7c7
            }
            fillPaint.shader = RadialGradient(
                cx, cy, haloRadius,
                intArrayOf(centerColor, 0x1002cfc5, 0x00000000),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP
            )
            canvas.drawCircle(cx, cy, haloRadius, fillPaint)
            fillPaint.shader = null

            val rings = if (connected) 3 else 2
            for (index in 0 until rings) {
                val expansion = 1f + index * 0.23f + intensity * 0.08f
                ringPaint.alpha = (105 - index * 22).coerceIn(25, 105)
                ringPaint.color = when (orbState) {
                    "error", "interrupted" -> 0xfffb7185.toInt()
                    "speaking" -> 0xfffacc15.toInt()
                    "thinking" -> 0xffc084fc.toInt()
                    else -> 0xff5eead4.toInt()
                }
                ringPaint.strokeWidth = dp(if (orbState == "speaking") 2f else 1.5f)
                canvas.drawCircle(cx, cy, radius * expansion, ringPaint)
            }

            val coreRadius = radius * (0.73f + intensity * 0.18f)
            corePaint.shader = RadialGradient(
                cx - radius * 0.16f,
                cy - radius * 0.22f,
                coreRadius * 1.35f,
                intArrayOf(0xfff0fdfa.toInt(), 0xff5eead4.toInt(), 0xff0f766e.toInt()),
                null,
                Shader.TileMode.CLAMP
            )
            canvas.drawCircle(cx, cy, coreRadius, corePaint)
            corePaint.shader = null

            val highlight = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = 0x99ffffff.toInt()
            }
            canvas.drawCircle(cx - coreRadius * 0.24f, cy - coreRadius * 0.29f, coreRadius * 0.13f, highlight)
        }

        private fun dp(value: Float): Float = value * resources.displayMetrics.density
    }

    companion object {
        private const val LONG_PRESS_MS = 650L
        private val ALLOWED_STATES = setOf(
            "idle", "listening", "thinking", "speaking", "interrupted", "muted", "error"
        )
    }
}
