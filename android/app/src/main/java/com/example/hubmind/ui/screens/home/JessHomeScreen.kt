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
                              html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;}
                              #hubmind-unicorn-bg{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;}
                              canvas{pointer-events:none!important;}
                            </style></head><body>
                            <div id="hubmind-unicorn-bg" data-us-project="1AfwBht7npSsvDW0cDU5" data-us-production="true"></div>
                            <script src="https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.4.3/dist/unicornStudio.umd.js"></script>
                            <script>window.addEventListener('load',function(){if(window.UnicornStudio&&window.UnicornStudio.init){window.UnicornStudio.init();}});</script>
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
