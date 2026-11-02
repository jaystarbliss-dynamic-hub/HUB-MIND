package com.example.hubmind.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.viewinterop.AndroidView
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.hubmind.data.model.ChatMessage
import com.example.hubmind.data.model.JessLiveState
import com.example.hubmind.data.model.MessageSender
import com.example.hubmind.ui.components.HubMindTopBar
import com.example.hubmind.ui.components.JessOrbView
import com.example.hubmind.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun JessHomeScreen(
    viewModel: JessHomeViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()

    // Auto-scroll when new messages arrive
    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.size - 1)
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = Color.Transparent,
        topBar = {
            HubMindTopBar(
                targetDevice = state.targetDevice,
                onSwitchDeviceClick = viewModel::switchTargetDevice
            )
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Slate950)
        ) {
            // Decorative Unicorn Studio lighting layer. It is deliberately non-interactive.
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        setBackgroundColor(android.graphics.Color.TRANSPARENT)
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.loadsImagesAutomatically = true
                        settings.mediaPlaybackRequiresUserGesture = true
                        isVerticalScrollBarEnabled = false
                        isHorizontalScrollBarEnabled = false
                        isFocusable = false
                        isFocusableInTouchMode = false
                        isClickable = false
                        setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null)
                        webViewClient = WebViewClient()
                        setOnTouchListener { _, _ -> true }
                        val backgroundHtml = """
                            <!doctype html>
                            <html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
                            <style>
                              html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#080b12;}
                              canvas{display:block;width:100%;height:100%;pointer-events:none;}
                            </style></head><body>
                            <canvas id="c"></canvas>
                            <script>
                            (function(){
                              var canvas = document.getElementById('c');
                              var ctx = canvas.getContext('2d');
                              var w, h;
                              function resize(){ w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
                              resize(); window.addEventListener('resize', resize);
                              function getVP() { return { x: w / 2, y: h * 0.44 }; }
                              var count = 8;
                              function getPaths() {
                                var paths = []; var vp = getVP();
                                for (var side = -1; side <= 1; side += 2) {
                                  if (side === 0) continue;
                                  for (var i = 0; i < count; i++) {
                                    var norm = (i + 1) / count;
                                    var startX = vp.x + side * (w * 0.08 + norm * w * 0.45);
                                    var startY = h + 40;
                                    var step1Y = h * (0.82 - i * 0.025); var step1X = startX;
                                    var step2X = vp.x + side * (w * 0.04 + norm * w * 0.28); var step2Y = step1Y;
                                    var step3Y = h * (0.64 - i * 0.02); var step3X = step2X;
                                    var step4X = vp.x + side * (w * 0.015 + norm * w * 0.12); var step4Y = step3Y;
                                    var apexX = vp.x + side * (norm * 2); var apexY = vp.y;
                                    var pts = [{x: startX, y: startY},{x: step1X, y: step1Y},{x: step2X, y: step2Y},{x: step3X, y: step3Y},{x: step4X, y: step4Y},{x: apexX, y: apexY}];
                                    var totalLen = 0; var segs = [];
                                    for (var p = 0; p < pts.length - 1; p++) {
                                      var dx = pts[p+1].x - pts[p].x; var dy = pts[p+1].y - pts[p].y;
                                      var len = Math.hypot(dx, dy); segs.push(len); totalLen += len;
                                    }
                                    paths.push({ points: pts, totalLen: totalLen, segs: segs });
                                  }
                                }
                                return paths;
                              }
                              var paths = getPaths(); var particles = [];
                              var colors = ['#75e4d2', '#5eead4', '#6de0c9', '#10b981', '#34d399'];
                              for (var i = 0; i < 10; i++) {
                                particles.push({
                                  pathIndex: Math.floor(Math.random() * paths.length),
                                  progress: Math.random(), speed: 0.0014 + Math.random() * 0.002,
                                  size: 2.2 + Math.random() * 1.6, color: colors[i % colors.length], trail: []
                                });
                              }
                              function getPt(path, prog) {
                                var target = prog * path.totalLen; var accum = 0;
                                for (var i = 0; i < path.segs.length; i++) {
                                  var segLen = path.segs[i];
                                  if (accum + segLen >= target || i === path.segs.length - 1) {
                                    var segProg = segLen > 0 ? (target - accum) / segLen : 0;
                                    var p1 = path.points[i]; var p2 = path.points[i+1];
                                    return { x: p1.x + (p2.x - p1.x)*segProg, y: p1.y + (p2.y - p1.y)*segProg };
                                  }
                                  accum += segLen;
                                }
                                return path.points[path.points.length - 1];
                              }
                              var t = 0;
                              function loop() {
                                t += 0.025; ctx.clearRect(0, 0, w, h);
                                var bg = ctx.createRadialGradient(w/2, h*0.44, 10, w/2, h/2, Math.max(w,h)*0.85);
                                bg.addColorStop(0, '#0a131c'); bg.addColorStop(0.5, '#070b12'); bg.addColorStop(1, '#04060a');
                                ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
                                var vp = getVP(); paths = getPaths(); ctx.lineWidth = 1.2;
                                for (var k = 0; k < paths.length; k++) {
                                  var path = paths[k]; ctx.beginPath(); ctx.moveTo(path.points[0].x, path.points[0].y);
                                  for (var i = 1; i < path.points.length; i++) { ctx.lineTo(path.points[i].x, path.points[i].y); }
                                  var grad = ctx.createLinearGradient(path.points[0].x, path.points[0].y, vp.x, vp.y);
                                  grad.addColorStop(0, 'rgba(16, 185, 129, 0.35)'); grad.addColorStop(0.5, 'rgba(94, 215, 193, 0.25)'); grad.addColorStop(1, 'rgba(117, 228, 210, 0.65)');
                                  ctx.strokeStyle = grad; ctx.stroke();
                                  for (var idx = 1; idx < path.points.length - 1; idx++) {
                                    var pt = path.points[idx]; ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
                                    ctx.fillStyle = 'rgba(117, 228, 210, 0.5)'; ctx.fill();
                                  }
                                }
                                for (var p = 0; p < particles.length; p++) {
                                  var ptc = particles[p]; ptc.progress += ptc.speed;
                                  if (ptc.progress >= 1) { ptc.progress = 0; ptc.pathIndex = Math.floor(Math.random() * paths.length); ptc.trail = []; }
                                  var curPath = paths[ptc.pathIndex % paths.length]; var pos = getPt(curPath, ptc.progress);
                                  ptc.trail.unshift({ x: pos.x, y: pos.y }); if (ptc.trail.length > 7) ptc.trail.pop();
                                  for (var tr = ptc.trail.length - 1; tr >= 0; tr--) {
                                    var trPt = ptc.trail[tr]; ctx.beginPath(); ctx.arc(trPt.x, trPt.y, ptc.size * (1 - tr/ptc.trail.length * 0.35), 0, Math.PI * 2);
                                    ctx.fillStyle = ptc.color; ctx.globalAlpha = (1 - tr/ptc.trail.length) * 0.5; ctx.fill();
                                  }
                                  ctx.globalAlpha = 1.0; ctx.beginPath(); ctx.arc(pos.x, pos.y, ptc.size * 0.8, 0, Math.PI * 2); ctx.fillStyle = '#f0fdfa'; ctx.fill();
                                }
                                var r = 32 + Math.sin(t) * 6; var fl = ctx.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, r * 2);
                                fl.addColorStop(0, 'rgba(240, 253, 250, 0.95)'); fl.addColorStop(0.3, 'rgba(117, 228, 210, 0.8)'); fl.addColorStop(0.7, 'rgba(16, 185, 129, 0.35)'); fl.addColorStop(1, 'transparent');
                                ctx.beginPath(); ctx.arc(vp.x, vp.y, r * 2, 0, Math.PI * 2); ctx.fillStyle = fl; ctx.fill();
                                requestAnimationFrame(loop);
                              }
                              loop();
                            })();
                            </script>
                            </body></html>
                        """.trimIndent()
                        loadDataWithBaseURL(
                            "https://cdn.jsdelivr.net/",
                            backgroundHtml,
                            "text/html",
                            "UTF-8",
                            null
                        )
                    }
                },
                update = { }
            )

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
            ) {
            // Interactive Jess Hero Area (Orb + State Label)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                JessOrbView(
                    state = state.liveState,
                    size = 120.dp,
                    onClick = viewModel::toggleMic
                )

                Spacer(modifier = Modifier.height(8.dp))

                val stateLabel = when (state.liveState) {
                    JessLiveState.LISTENING -> "Jess is Listening..."
                    JessLiveState.THINKING -> "Thinking..."
                    JessLiveState.SPEAKING -> "Speaking..."
                    JessLiveState.ERROR -> "Action Failed"
                    JessLiveState.MUTED -> "Microphone Muted"
                    else -> "Jess · Ready for Commands"
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(
                                when (state.liveState) {
                                    JessLiveState.LISTENING -> Cyan400
                                    JessLiveState.THINKING -> Amber400
                                    JessLiveState.SPEAKING -> Green400
                                    else -> Teal400
                                }
                            )
                    )
                    Text(
                        text = stateLabel,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = when (state.liveState) {
                            JessLiveState.LISTENING -> Cyan400
                            JessLiveState.THINKING -> Amber400
                            JessLiveState.SPEAKING -> Green400
                            else -> Slate300
                        }
                    )
                }
            }

            // Quick Scenario Chips
            LazyRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                val chips = listOf(
                    "Launch VS Code on PC" to "Launch Visual Studio Code on my Windows workstation",
                    "Query PC Diagnostics" to "Check system info and diagnostics on my PC",
                    "Take PC Screenshot" to "Take a screenshot of my Windows desktop",
                    "Check Studio Tasks" to "What studio operations tasks are pending today?"
                )
                items(chips) { (label, prompt) ->
                    Surface(
                        modifier = Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .clickable { viewModel.sendPrompt(prompt) },
                        color = Slate900,
                        border = androidx.compose.foundation.BorderStroke(1.dp, Slate800)
                    ) {
                        Text(
                            text = label,
                            style = MaterialTheme.typography.labelSmall,
                            color = Teal400,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            // Chat Message List
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(state.messages) { message ->
                    ChatMessageItem(message = message)
                }
            }

            // Input Bar
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .imePadding(),
                color = Slate950,
                tonalElevation = 6.dp,
                border = androidx.compose.foundation.BorderStroke(1.dp, Slate900)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    // Voice Mic Button
                    IconButton(
                        onClick = viewModel::toggleMic,
                        modifier = Modifier
                            .size(46.dp)
                            .clip(CircleShape)
                            .background(if (state.isMicActive) Cyan400 else Slate900)
                            .border(1.dp, if (state.isMicActive) Cyan400 else Slate700, CircleShape)
                            .testTag("mic_button")
                    ) {
                        Icon(
                            imageVector = if (state.isMicActive) Icons.Filled.Mic else Icons.Filled.MicNone,
                            contentDescription = "Microphone Toggle",
                            tint = if (state.isMicActive) Slate950 else Slate300
                        )
                    }

                    // Text Field
                    OutlinedTextField(
                        value = state.currentInput,
                        onValueChange = viewModel::onInputChange,
                        placeholder = { Text("Ask Jess or command Windows PC...", color = Slate500, fontSize = 13.sp) },
                        singleLine = true,
                        modifier = Modifier
                            .weight(1f)
                            .testTag("chat_input_field"),
                        shape = RoundedCornerShape(24.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Teal400,
                            unfocusedBorderColor = Slate800,
                            focusedTextColor = Slate100,
                            unfocusedTextColor = Slate200,
                            focusedContainerColor = Slate900,
                            unfocusedContainerColor = Slate900
                        )
                    )

                    // Send Button
                    IconButton(
                        onClick = { viewModel.sendPrompt() },
                        enabled = state.currentInput.isNotBlank() && !state.isSending,
                        modifier = Modifier
                            .size(46.dp)
                            .clip(CircleShape)
                            .background(if (state.currentInput.isNotBlank()) Teal500 else Slate900)
                            .testTag("send_message_button")
                    ) {
                        Icon(
                            imageVector = Icons.Filled.ArrowUpward,
                            contentDescription = "Send Message",
                            tint = if (state.currentInput.isNotBlank()) Slate950 else Slate600
                        )
                    }
                }
            }
            }
        }
    }
}

@Composable
fun ChatMessageItem(
    message: ChatMessage,
    modifier: Modifier = Modifier
) {
    val isUser = message.sender == MessageSender.USER

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 310.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (isUser) 16.dp else 4.dp,
                        bottomEnd = if (isUser) 4.dp else 16.dp
                    )
                )
                .background(if (isUser) Slate800 else Slate900)
                .border(
                    width = 1.dp,
                    color = if (isUser) Slate700 else Teal500.copy(alpha = 0.3f),
                    shape = RoundedCornerShape(16.dp)
                )
                .padding(14.dp)
        ) {
            Text(
                text = message.text,
                style = MaterialTheme.typography.bodyMedium,
                color = if (isUser) Slate100 else Slate200,
                lineHeight = 20.sp
            )

            // Attached Tool Execution Badge if present
            message.toolCallName?.let { tool ->
                Spacer(modifier = Modifier.height(8.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = Slate950,
                    border = androidx.compose.foundation.BorderStroke(1.dp, Slate800)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Terminal,
                            contentDescription = null,
                            tint = Teal400,
                            modifier = Modifier.size(14.dp)
                        )
                        Text(
                            text = tool,
                            style = MaterialTheme.typography.labelSmall,
                            color = Teal400,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                        if (message.executionStatus == "done_verified") {
                            Icon(
                                imageVector = Icons.Filled.CheckCircle,
                                contentDescription = "Verified Execution",
                                tint = Green400,
                                modifier = Modifier.size(13.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}
